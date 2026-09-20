import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

process.env.REACH_DATA_DIR = mkdtempSync(join(tmpdir(), "reach-a1-exec-"));

import { createTask, getTask } from "../tasks/taskStore.js";
import { decideApproval } from "../mcp/tools.js";
import { proposeAction } from "./executor.js";
import { clearActionRegistry, defineAction } from "./registry.js";

function task(goal = "scripted test goal") {
  return createTask(goal);
}

afterEach(() => clearActionRegistry());

describe("executor", () => {
  it("runs allowed actions and audits the trace", async () => {
    defineAction({
      name: "test.echo",
      actionClass: "read",
      description: "echo",
      schema: z.object({ text: z.string() }),
      timeoutMs: 5000,
      verify: (r) => `echoed ${(r as { text: string }).text}`,
      handler: async (args) => ({ text: args["text"] }),
    });
    const t = task();
    const home = (await import("../policy/engine.js")).defaultPolicyContext().userRoot;
    const r = await proposeAction(t.id, {
      actionClass: "read",
      name: "test.echo",
      target: join(home, "x.txt"),
      args: { text: "hi" },
    });
    assert.equal(r.outcome, "ran");
    assert.equal(r.verified, true);
    const after = getTask(t.id)!;
    assert.equal(after.status, "running");
    assert.equal(after.trace?.length, 1);
    assert.equal(after.trace?.[0]?.policyVerdict, "allow");
    assert.equal(after.trace?.[0]?.verified, true);
  });

  it("pauses confirm-class actions with an approval", async () => {
    defineAction({
      name: "test.shred",
      actionClass: "delete",
      description: "shred",
      schema: z.object({}),
      timeoutMs: 5000,
      handler: async () => {
        throw new Error("must never run without approval");
      },
    });
    const t = task();
    const r = await proposeAction(t.id, { actionClass: "delete", name: "test.shred", target: "old.txt", args: {} });
    assert.equal(r.outcome, "paused");
    assert.ok(r.approvalId);
    const after = getTask(t.id)!;
    assert.equal(after.status, "awaiting_approval");
    assert.ok(after.pendingApproval);
    assert.equal(after.trace?.[0]?.policyVerdict, "confirm");
  });

  it("deny verdicts fail the task with reason", async () => {
    defineAction({
      name: "test.peek",
      actionClass: "read",
      description: "peek",
      schema: z.object({}),
      timeoutMs: 5000,
      handler: async () => ({}) ,
    });
    const t = task();
    const r = await proposeAction(t.id, {
      actionClass: "read",
      name: "test.peek",
      target: "C:\\Windows\\System32\\evil.dll",
      args: {},
    });
    assert.equal(r.outcome, "denied");
    assert.equal(getTask(t.id)?.status, "failed");
    assert.match(getTask(t.id)?.error ?? "", /outside user-owned space|system/);
  });

  it("rejects unknown actions and bad args without running", async () => {
    const t = task();
    const r1 = await proposeAction(t.id, { actionClass: "read", name: "nope.missing", args: {} });
    assert.equal(r1.outcome, "rejected");
    defineAction({
      name: "test.strict",
      actionClass: "read",
      description: "strict",
      schema: z.object({ need: z.string() }),
      timeoutMs: 5000,
      handler: async () => ({}),
    });
    const r2 = await proposeAction(t.id, { actionClass: "read", name: "test.strict", args: {} });
    assert.equal(r2.outcome, "rejected");
  });

  it("ask pauses for input", async () => {
    const t = task();
    const r = await proposeAction(t.id, {
      actionClass: "ask",
      name: "reach.ask",
      args: { question: "Which file did you mean?", options: ["a", "b"] },
    });
    assert.equal(r.outcome, "paused");
    const after = getTask(t.id)!;
    assert.equal(after.status, "awaiting_input");
    assert.equal(after.pendingInput?.question, "Which file did you mean?");
  });

  it("timeouts fail the action", async () => {
    defineAction({
      name: "test.hang",
      actionClass: "read",
      description: "hang",
      schema: z.object({}),
      timeoutMs: 5000,
      handler: async () => new Promise(() => {}),
    });
    const t = task();
    const home = (await import("../policy/engine.js")).defaultPolicyContext().userRoot;
    const r = await proposeAction(t.id, { actionClass: "read", name: "test.hang", target: join(home, "x"), args: {}, timeoutMs: 60 });
    assert.equal(r.outcome, "denied");
    assert.match(r.error ?? "", /timed out/);
  });

  it("failed verification fails the task", async () => {
    defineAction({
      name: "test.liar",
      actionClass: "read",
      description: "liar",
      schema: z.object({}),
      timeoutMs: 5000,
      verify: () => false,
      handler: async () => ({}),
    });
    const t = task();
    const home = (await import("../policy/engine.js")).defaultPolicyContext().userRoot;
    const r = await proposeAction(t.id, { actionClass: "read", name: "test.liar", target: join(home, "x"), args: {} });
    assert.equal(r.outcome, "denied");
    assert.equal(getTask(t.id)?.trace?.[0]?.verified, false);
  });

  it("approve resumes the loop, deny fails with quote (via real decide_approval)", async () => {
    const { ScriptedPlannerBackend } = await import("../planner/mock.js");
    const { setPlannerBackendFactory } = await import("../planner/loop.js");
    defineAction({
      name: "test.nuke",
      actionClass: "delete",
      description: "nuke",
      schema: z.object({}),
      timeoutMs: 5000,
      handler: async () => ({}),
    });
    const t1 = task();
    const p1 = await proposeAction(t1.id, { actionClass: "delete", name: "test.nuke", target: "old.txt", args: {} });
    // Resume with a mock planner that declares the resumed work done.
    setPlannerBackendFactory(() => new ScriptedPlannerBackend([{ text: "Resumed and finished." }]));
    try {
      const ok = decideApproval({ approvalId: p1.approvalId!, decision: "approve" }, "test");
      assert.equal(ok.ok, true);
      const start = Date.now();
      for (;;) {
        const s = getTask(t1.id)?.status;
        if (s === "completed" || s === "failed") break;
        if (Date.now() - start > 8000) throw new Error(`approve-resume stalled at ${s}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(getTask(t1.id)?.status, "completed");
    } finally {
      setPlannerBackendFactory(undefined);
    }

    const t2 = task();
    const p2 = await proposeAction(t2.id, { actionClass: "delete", name: "test.nuke", target: "old.txt", args: {} });
    decideApproval({ approvalId: p2.approvalId!, decision: "deny" }, "test");
    const after = getTask(t2.id)!;
    assert.equal(after.status, "failed");
    assert.match(after.error ?? "", /not approved/);
  });
});

describe("structural guarantees", () => {
  it("no RCE-shaped action names exist in the framework", async () => {
    const { listActionDefs } = await import("./registry.js");
    for (const def of listActionDefs()) {
      assert.ok(!/^(run|exec|shell|eval|code|command)/i.test(def.name), def.name);
    }
  });

  it("executor never resolves approvals (planner cannot self-approve)", () => {
    // Creating approvals is the executor's job; RESOLVING them is the user's.
    // This test pins the split: executor source must never call resolveApproval.
    const src = readFileSync(new URL("./executor.ts", import.meta.url), "utf8");
    assert.ok(!src.includes("resolveApproval"), "executor must not resolve approvals");
    assert.ok(!src.includes("decideApproval"), "executor must not decide approvals");
  });

  it("policy has no exec/shell/eval action class", async () => {
    const mod = await import("../policy/types.js");
    for (const c of mod.ACTION_CLASSES as readonly string[]) {
      assert.ok(!/exec|shell|eval|^run$/i.test(c), c);
    }
  });
});
