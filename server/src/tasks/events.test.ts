import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

process.env.REACH_DATA_DIR = mkdtempSync(join(tmpdir(), "reach-c-events-"));

import { clearActionRegistry, defineAction } from "../executor/registry.js";
import { ScriptedPlannerBackend } from "../planner/mock.js";
import { answerInput, decideApproval, getTaskStatus } from "../mcp/tools.js";
import {
  MAX_TASK_EVENTS,
  appendTaskEvent,
  cancelTask,
  createTask,
  getTask,
} from "./taskStore.js";
import { runPlannerLoop, setPlannerBackendFactory } from "../planner/loop.js";

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

async function pollDone(taskId: string, timeoutMs = 8000): Promise<string> {
  const start = Date.now();
  for (;;) {
    const t = getTask(taskId);
    if (!t) throw new Error("task vanished");
    if (t.status === "completed" || t.status === "failed" || t.status === "cancelled") return t.status;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting, status=${t.status}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("task event trail", () => {
  it("creation seeds goal_received", () => {
    const t = createTask("event seed goal");
    const events = getTask(t.id)?.events ?? [];
    assert.equal(events.length, 1);
    assert.equal(events[0]?.kind, "goal_received");
    assert.ok(events[0]?.eventId);
    assert.ok(events[0]?.at);
  });

  it("a run emits action_finished + outcome_set in order", async () => {
    const t = createTask("event run goal");
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "test.step", args: { label: "one" } }] },
      {
        toolCalls: [
          {
            name: "reach.finish",
            args: () => ({
              kind: "complete",
              summary: "Done.",
              evidenceActionIds: (getTask(t.id)?.trace ?? []).filter((r) => r.ok && r.verified).map((r) => r.actionId),
            }),
          },
        ],
      },
    ]);
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(await pollDone(t.id), "completed");
    const kinds = (getTask(t.id)?.events ?? []).map((e) => e.kind);
    assert.deepEqual(kinds, ["goal_received", "action_finished", "outcome_set"]);
    const finished = getTask(t.id)?.events?.[1];
    assert.equal(finished?.status, "succeeded");
    assert.equal(finished?.capabilityId, "test.step");
    assert.deepEqual(finished?.evidenceActionIds?.length, 1);
    const outcome = getTask(t.id)?.events?.[2];
    assert.equal(outcome?.status, "succeeded");
  });

  it("failed actions emit failed action_finished, never success", async () => {
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "test.step", args: { label: 123 } }] },
      { toolCalls: [{ name: "reach.finish", args: { kind: "failed", reason: "bad args everywhere." } }] },
    ]);
    const t = createTask("event failure goal");
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(await pollDone(t.id), "failed");
    const events = getTask(t.id)?.events ?? [];
    assert.equal(events[1]?.kind, "action_finished");
    assert.equal(events[1]?.status, "failed");
    assert.equal(events[2]?.kind, "outcome_set");
    assert.equal(events[2]?.status, "failed");
  });

  it("approval flow emits requested + decided with full-detail args", async () => {
    const mock1 = new ScriptedPlannerBackend([{ toolCalls: [{ name: "test.doomed", args: {} }] }]);
    const t = createTask("event approval goal");
    await runPlannerLoop(t.id, { backend: mock1 });
    assert.equal(getTask(t.id)?.status, "awaiting_approval");
    const requested = (getTask(t.id)?.events ?? []).find((e) => e.kind === "approval_requested");
    assert.ok(requested);
    assert.equal(requested?.status, "awaiting_approval");
    assert.equal(requested?.capabilityId, "test.doomed");

    const status = getTaskStatus({ taskId: t.id }) as { pendingApproval?: { args?: unknown } };
    assert.deepEqual(status.pendingApproval?.args ?? null, {});

    setPlannerBackendFactory(
      () =>
        new ScriptedPlannerBackend([
          {
            toolCalls: [
              {
                name: "reach.finish",
                args: () => ({
                  kind: "complete",
                  summary: "Approved work finished.",
                  evidenceActionIds: (getTask(t.id)?.trace ?? []).filter((r) => r.ok && r.verified).map((r) => r.actionId),
                }),
              },
            ],
          },
        ]),
    );
    const approvalId = getTask(t.id)?.pendingApproval?.id;
    assert.ok(approvalId);
    const res = await decideApproval({ approvalId: approvalId!, decision: "approve" }, "test");
    assert.equal(res.ok, true);
    assert.equal(await pollDone(t.id), "completed");
    const kinds = (getTask(t.id)?.events ?? []).map((e) => e.kind);
    assert.ok(kinds.includes("approval_decided"));
    assert.equal(kinds[kinds.length - 1], "outcome_set");
  });

  it("questions emit requested + answered around the answer", async () => {
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "reach.ask_user", args: { question: "Which file?" } }] },
    ]);
    const t = createTask("event question goal");
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(getTask(t.id)?.status, "awaiting_input");
    assert.ok((getTask(t.id)?.events ?? []).some((e) => e.kind === "clarification_requested"));

    setPlannerBackendFactory(
      () =>
        new ScriptedPlannerBackend([
          { toolCalls: [{ name: "test.step", args: {} }] },
          {
            toolCalls: [
              {
                name: "reach.finish",
                args: () => ({
                  kind: "complete",
                  summary: "Answered and done.",
                  evidenceActionIds: (getTask(t.id)?.trace ?? []).filter((r) => r.ok && r.verified).map((r) => r.actionId),
                }),
              },
            ],
          },
        ]),
    );
    const ans = answerInput(t.id, "the invoice");
    assert.equal(ans.ok, true);
    assert.equal(await pollDone(t.id), "completed");
    const kinds = (getTask(t.id)?.events ?? []).map((e) => e.kind);
    assert.ok(kinds.includes("clarification_answered"));
    assert.equal(kinds[kinds.length - 1], "outcome_set");
  });

  it("answerInput validates without touching state", () => {
    const t = createTask("answer validation goal");
    assert.deepEqual(answerInput("task_nope_missing", "hi").ok, false);
    const bad = answerInput(t.id, "   ");
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.code, "invalid");
    const notWaiting = answerInput(t.id, "hello?");
    assert.equal(notWaiting.ok, false);
    if (!notWaiting.ok) assert.equal(notWaiting.code, "not_waiting");
    assert.equal(getTask(t.id)?.events?.length, 1);
  });

  it("cancel emits task_cancelled and status exposes the trail", () => {
    const t = createTask("event cancel goal");
    cancelTask(t.id, "stop it");
    const status = getTaskStatus({ taskId: t.id }) as { status: string; events?: Array<{ kind: string }> };
    assert.equal(status.status, "cancelled");
    const kinds = (status.events ?? []).map((e) => e.kind);
    assert.deepEqual(kinds, ["goal_received", "task_cancelled"]);
  });

  it("the trail caps at MAX_TASK_EVENTS keeping goal_received", () => {
    const t = createTask("event cap goal");
    for (let i = 0; i < MAX_TASK_EVENTS + 50; i++) {
      appendTaskEvent(t.id, { kind: "action_finished", summary: `filler ${i}` });
    }
    const events = getTask(t.id)?.events ?? [];
    assert.equal(events.length, MAX_TASK_EVENTS);
    assert.equal(events[0]?.kind, "goal_received");
    assert.equal(events[events.length - 1]?.summary, `filler ${MAX_TASK_EVENTS + 49}`);
  });

  it("event summaries are bounded", () => {
    const t = createTask("x".repeat(5000));
    assert.ok((getTask(t.id)?.events?.[0]?.summary.length ?? 0) <= 301);
    appendTaskEvent(t.id, { kind: "action_finished", summary: "y".repeat(5000) });
    assert.ok((getTask(t.id)?.events?.[1]?.summary.length ?? 0) <= 301);
  });
});
