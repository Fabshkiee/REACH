import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

process.env.REACH_DATA_DIR = mkdtempSync(join(tmpdir(), "reach-b-outcome-"));

import { clearActionRegistry, defineAction } from "../executor/registry.js";
import { ScriptedPlannerBackend } from "./mock.js";
import { decideApproval } from "../mcp/tools.js";
import {
  cancelTask,
  claimLoopSlot,
  createTask,
  getTask,
  releaseLoopSlot,
  setTaskStatus,
} from "../tasks/taskStore.js";
import { runPlannerLoop, resumeLoop, setPlannerBackendFactory } from "./loop.js";

function testDefs() {
  clearActionRegistry();
  defineAction({
    name: "test.step",
    actionClass: "observe",
    description: "scripted observation",
    schema: z.object({ label: z.string().optional() }),
    timeoutMs: 5000,
    verify: () => "observed",
    handler: async (args) => ({ saw: args["label"] ?? "x" }),
  });
  defineAction({
    name: "test.doomed",
    actionClass: "delete",
    description: "scripted consequential",
    schema: z.object({}),
    timeoutMs: 5000,
    verify: () => "doomed executed",
    handler: async () => ({ deleted: "old.txt" }),
  });
}

beforeEach(() => {
  testDefs();
  setPlannerBackendFactory(undefined);
});

describe("reach.finish structured outcomes", () => {
  it("complete cites verified work and preserves evidence ids", async () => {
    // finish needs the real actionId: run the step, pause via ask_user to
    // inspect the trace, then answer + finish with the real id.
    const probe = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "test.step", args: { label: "one" } }] },
      { toolCalls: [{ name: "reach.ask_user", args: { question: "pause for id?" } }] },
    ]);
    const t = createTask("finish complete goal");
    await runPlannerLoop(t.id, { backend: probe });
    assert.equal(getTask(t.id)?.status, "awaiting_input");
    const actId = getTask(t.id)?.trace?.[0]?.actionId;
    assert.ok(actId, "step should leave a trace actionId");
    // Answer, then finish with the real id.
    const finisher = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "reach.finish", args: { kind: "complete", summary: "Saw it.", evidenceActionIds: [actId] } }] },
    ]);
    setPlannerBackendFactory(() => finisher);
    await resumeLoop(t.id, `User answered "pause for id?": "go"`);
    const after = getTask(t.id)!;
    assert.equal(after.status, "completed");
    assert.equal(after.outcome?.kind, "complete");
    assert.deepEqual(after.outcome?.evidenceActionIds, [actId]);
  });

  it("complete with bogus evidence is rejected and the loop recovers via text", async () => {
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "test.step", args: {} }] },
      { toolCalls: [{ name: "reach.finish", args: { kind: "complete", evidenceActionIds: ["act_nonexistent"] } }] },
      { text: "Step verified and done." },
    ]);
    const t = createTask("finish bogus recovery goal");
    await runPlannerLoop(t.id, { backend: mock });
    const after = getTask(t.id)!;
    assert.equal(after.status, "completed");
    assert.equal(after.outcome?.kind, "complete");
    assert.ok((after.plan ?? []).some((p) => p.includes("reach.finish rejected")));
  });

  it("complete with empty evidence is rejected (no narrated success)", async () => {
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "reach.finish", args: { kind: "complete", summary: "trust me" } }] },
      { text: "CANNOT: nothing offered matches." },
    ]);
    const t = createTask("finish empty evidence goal");
    await runPlannerLoop(t.id, { backend: mock });
    const after = getTask(t.id)!;
    assert.equal(after.status, "failed");
    assert.equal(after.outcome?.kind, "cannot");
    assert.deepEqual(after.outcome?.evidenceActionIds ?? [], []);
  });

  it("partial preserves evidence and remaining work", async () => {
    const probe = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "test.step", args: {} }] },
      { toolCalls: [{ name: "reach.ask_user", args: { question: "pause?" } }] },
    ]);
    const t = createTask("finish partial goal");
    await runPlannerLoop(t.id, { backend: probe });
    const actId = getTask(t.id)?.trace?.[0]?.actionId;
    assert.ok(actId);
    setPlannerBackendFactory(
      () =>
        new ScriptedPlannerBackend([
          { toolCalls: [{ name: "reach.finish", args: { kind: "partial", summary: "Half done.", evidenceActionIds: [actId], remaining: ["second half"] } }] },
        ]),
    );
    await resumeLoop(t.id, `User answered "pause?": "go"`);
    const after = getTask(t.id)!;
    assert.equal(after.status, "completed");
    assert.equal(after.outcome?.kind, "partial");
    assert.deepEqual(after.outcome?.evidenceActionIds, [actId]);
    assert.deepEqual(after.outcome?.remaining, ["second half"]);
  });

  it("unverified and failed kinds map to the right status", async () => {
    const probe = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "test.step", args: {} }] },
      { toolCalls: [{ name: "reach.ask_user", args: { question: "pause?" } }] },
    ]);
    const t = createTask("finish unverified goal");
    await runPlannerLoop(t.id, { backend: probe });
    const actId = getTask(t.id)?.trace?.[0]?.actionId;
    assert.ok(actId);
    setPlannerBackendFactory(
      () =>
        new ScriptedPlannerBackend([
          { toolCalls: [{ name: "reach.finish", args: { kind: "unverified", reason: "could not re-read state", evidenceActionIds: [actId] } }] },
        ]),
    );
    await resumeLoop(t.id, `User answered "pause?": "go"`);
    const after = getTask(t.id)!;
    assert.equal(after.status, "completed");
    assert.equal(after.outcome?.kind, "unverified");

    const t2 = createTask("finish failed goal");
    await runPlannerLoop(t2.id, {
      backend: new ScriptedPlannerBackend([
        { toolCalls: [{ name: "reach.finish", args: { kind: "failed", reason: "downstream exploded" } }] },
      ]),
    });
    const after2 = getTask(t2.id)!;
    assert.equal(after2.status, "failed");
    assert.equal(after2.outcome?.kind, "failed");
    assert.match(after2.error ?? "", /downstream exploded/);
  });

  it("CANNOT text after partial work preserves evidence as cannot", async () => {
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "test.step", args: {} }] },
      { text: "CANNOT: the second half needs a missing integration." },
    ]);
    const t = createTask("cannot after partial goal");
    await runPlannerLoop(t.id, { backend: mock });
    const after = getTask(t.id)!;
    assert.equal(after.status, "failed");
    assert.equal(after.outcome?.kind, "cannot");
    assert.equal(after.outcome?.evidenceActionIds?.length, 1);
    assert.match(after.error ?? "", /missing integration/);
  });
});

describe("budgets, single-flight, cancel", () => {
  it("call budget exhausts with an explainable failure, not success", async () => {
    const t = createTask("budget goal with plenty of steps");
    setTaskStatus(t.id, "queued", { budget: { maxPlannerCalls: 1, maxElapsedMs: 600_000, maxActions: 40 } });
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "test.step", args: {} }] },
      { toolCalls: [{ name: "test.step", args: {} }] },
      { toolCalls: [{ name: "test.step", args: {} }] },
      { text: "Done." },
    ]);
    await runPlannerLoop(t.id, { backend: mock });
    const after = getTask(t.id)!;
    assert.equal(after.status, "failed");
    assert.equal(after.outcome?.kind, "failed");
    assert.match(after.error ?? "", /budget exhausted/);
    assert.equal(after.usage?.calls, 1);
    assert.equal(after.trace?.length, 1);
  });

  it("elapsed budget exhausts before any model call", async () => {
    const t = createTask("stale goal");
    setTaskStatus(t.id, "queued", {
      createdAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      budget: { maxPlannerCalls: 24, maxElapsedMs: 60_000, maxActions: 40 },
    });
    const mock = new ScriptedPlannerBackend([{ toolCalls: [{ name: "test.step", args: {} }] }]);
    await runPlannerLoop(t.id, { backend: mock });
    const after = getTask(t.id)!;
    assert.equal(after.status, "failed");
    assert.match(after.error ?? "", /time budget/);
    assert.equal(mock.calls.length, 0);
  });

  it("a held loop slot makes a duplicate invocation a no-op", async () => {
    const t = createTask("single-flight goal");
    assert.equal(claimLoopSlot(t.id, "foreign-holder"), true);
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "test.step", args: {} }] },
      { text: "Done." },
    ]);
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(getTask(t.id)?.status, "queued");
    assert.equal(getTask(t.id)?.trace, undefined);
    assert.equal(mock.calls.length, 0);
    releaseLoopSlot(t.id, "foreign-holder");
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(getTask(t.id)?.status, "completed");
  });

  it("cancelled tasks are left alone by the loop", async () => {
    const t = createTask("cancelled goal");
    cancelTask(t.id);
    assert.equal(getTask(t.id)?.status, "cancelled");
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "test.step", args: {} }] },
      { text: "Done." },
    ]);
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(getTask(t.id)?.status, "cancelled");
    assert.equal(getTask(t.id)?.trace, undefined);
    assert.equal(mock.calls.length, 0);
  });

  it("cancel clears the pause and approval cannot resurrect the task", async () => {
    const mock1 = new ScriptedPlannerBackend([{ toolCalls: [{ name: "test.doomed", args: {} }] }]);
    const t = createTask("cancel paused goal");
    await runPlannerLoop(t.id, { backend: mock1 });
    assert.equal(getTask(t.id)?.status, "awaiting_approval");
    const approvalId = getTask(t.id)?.pendingApproval?.id;
    assert.ok(approvalId);
    cancelTask(t.id, "user changed mind");
    assert.equal(getTask(t.id)?.status, "cancelled");
    assert.equal(getTask(t.id)?.pendingApproval, undefined);
    const res = await decideApproval({ approvalId: approvalId!, decision: "approve" }, "test");
    assert.equal(res.ok, false);
    assert.match(String((res as { error?: string }).error ?? ""), /already cancelled/);
    assert.equal(getTask(t.id)?.status, "cancelled");
  });

  it("consecutive failures flow into ask_user instead of blind quitting", async () => {
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "test.step", args: { label: 123 } }] },
      { toolCalls: [{ name: "test.step", args: { label: 456 } }] },
      { toolCalls: [{ name: "reach.ask_user", args: { question: "Which label did you mean?" } }] },
    ]);
    const t = createTask("recovery then ask goal");
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(getTask(t.id)?.status, "awaiting_input");
    const kinds = (getTask(t.id)?.events ?? []).map((e) => e.kind);
    assert.ok(kinds.includes("clarification_requested"));
    // Two failures recorded, no terminal outcome — the loop asked, not quit.
    assert.equal((getTask(t.id)?.trace ?? []).filter((r) => r.ok === false).length, 2);
    assert.equal(getTask(t.id)?.outcome, undefined);
  });
});
