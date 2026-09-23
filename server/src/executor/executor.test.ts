import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

process.env.REACH_DATA_DIR = mkdtempSync(join(tmpdir(), "reach-a1-exec-"));

import { createTask, getTask } from "../tasks/taskStore.js";
import { decideApproval, answerInput } from "../mcp/tools.js";
import { proposeAction, questionNamesAnswer, normalizeQuestion } from "./executor.js";
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
      verify: () => "shredded (test only — handler throws before running)",
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
      verify: () => "peeked (test)",
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
      verify: () => "strict ok (test)",
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
      verify: () => "hung (test — timeout fires first)",
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
      verify: () => "nuked (test)",
      handler: async () => ({}),
    });
    const t1 = task();
    const p1 = await proposeAction(t1.id, { actionClass: "delete", name: "test.nuke", target: "old.txt", args: {} });
    // Resume with a mock planner that declares the resumed work done via reach.finish.
    setPlannerBackendFactory(
      () =>
        new ScriptedPlannerBackend([
          {
            toolCalls: [
              {
                name: "reach.finish",
                args: () => ({
                  kind: "complete",
                  summary: "Resumed and finished.",
                  evidenceActionIds: (getTask(t1.id)?.trace ?? []).filter((r) => r.ok && r.verified).map((r) => r.actionId),
                }),
              },
            ],
          },
        ]),
    );
    try {
      const ok = await decideApproval({ approvalId: p1.approvalId!, decision: "approve" }, "test");
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
    void decideApproval({ approvalId: p2.approvalId!, decision: "deny" }, "test");
    const after = getTask(t2.id)!;
    assert.equal(after.status, "failed");
    assert.match(after.error ?? "", /not approved/);
  });

  it("a second confirm while an approval is pending is denied, never overwrites", async () => {
    const { ScriptedPlannerBackend: Mock } = await import("../planner/mock.js");
    const { setPlannerBackendFactory: setFactory } = await import("../planner/loop.js");
    defineAction({
      name: "test.nuke2",
      actionClass: "delete",
      description: "nuke2",
      schema: z.object({}),
      timeoutMs: 5000,
      verify: () => "nuked2 (test)",
      handler: async () => ({}),
    });
    const t = task();
    const p1 = await proposeAction(t.id, { actionClass: "delete", name: "test.nuke2", target: "old.txt", args: {} });
    assert.equal(p1.outcome, "paused");
    assert.ok(p1.approvalId);
    // Second proposal for the same task: denied, original pause untouched.
    // (softFail mirrors planner-driven use, where denial feeds recovery —
    // standalone denials fail fast by executor convention.)
    const p2 = await proposeAction(t.id, { actionClass: "delete", name: "test.nuke2", target: "other.txt", args: {} }, undefined, { softFail: true });
    assert.equal(p2.outcome, "denied");
    assert.match(p2.error ?? "", /still pending/);
    assert.equal(getTask(t.id)?.status, "awaiting_approval");
    assert.equal(getTask(t.id)?.pendingApproval?.id, p1.approvalId);
    // After resolving, the resumed loop can pause anew with a fresh id
    // (replacement works; only concurrent overwrite is denied).
    setFactory(() => new Mock([{ toolCalls: [{ name: "test.nuke2", args: {} }] }]));
    try {
      const ok = await decideApproval({ approvalId: p1.approvalId!, decision: "approve" }, "test");
      assert.equal(ok.ok, true);
      const start = Date.now();
      for (;;) {
        const s = getTask(t.id);
        if (s?.status === "awaiting_approval" && s?.pendingApproval?.id !== p1.approvalId) break;
        if (s && (s.status === "completed" || s.status === "failed" || s.status === "cancelled")) {
          throw new Error(`expected a fresh pause, task ended as ${s.status}`);
        }
        if (Date.now() - start > 8000) throw new Error(`approve-resume stalled at ${getTask(t.id)?.status}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.notEqual(getTask(t.id)?.pendingApproval?.id, p1.approvalId);
    } finally {
      setFactory(undefined);
    }
    // Ended tasks reject proposals instead of resurrecting.
    const done = task();
    const { setTaskStatus } = await import("../tasks/taskStore.js");
    setTaskStatus(done.id, "completed", { outcome: { kind: "complete", summary: "done", evidenceActionIds: [] } });
    const late = await proposeAction(done.id, { actionClass: "read", name: "test.echo", target: "x", args: { text: "hi" } });
    assert.equal(late.outcome, "rejected");
    assert.match(late.error ?? "", /already completed/);
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

describe("reach.ask_user guardrails", () => {
  it("normalizes questions and detects answer names", () => {
    assert.equal(normalizeQuestion("Which file, exactly, should I open?"), "which file exactly should i open");
    assert.equal(normalizeQuestion("  HELLO   WORLD!  "), "hello world");
    assert.equal(questionNamesAnswer("should i check budget xlsx", "budget.xlsx"), true);
    assert.equal(questionNamesAnswer("is this invoice", "invoice"), true);
    assert.equal(questionNamesAnswer("reinvoicing the client", "invoice"), false);
    assert.equal(questionNamesAnswer("noticed something", "no"), false);
  });

  it("first question pauses task with awaiting_input and initializes askedQuestions with questionCount = 1", async () => {
    const t = task("clarification test task 1");
    const r = await proposeAction(t.id, {
      actionClass: "ask",
      name: "reach.ask_user",
      args: { question: "Which file should I read?", options: ["a.txt", "b.txt"] },
    });
    assert.equal(r.outcome, "paused");
    const after = getTask(t.id)!;
    assert.equal(after.status, "awaiting_input");
    assert.equal(after.pendingInput?.question, "Which file should I read?");
    assert.equal(after.pendingInput?.questionCount, 1);
    assert.equal(after.askedQuestions?.length, 1);
    assert.equal(after.askedQuestions?.[0]?.normalized, "which file should i read");
  });

  it("duplicate question is rejected and leaves task running without overwriting", async () => {
    const t = task("clarification test task 2");
    await proposeAction(t.id, {
      actionClass: "ask",
      name: "reach.ask_user",
      args: { question: "Which file should I read?" },
    });
    // Duplicate question with different casing and punctuation
    const dup = await proposeAction(
      t.id,
      {
        actionClass: "ask",
        name: "reach.ask_user",
        args: { question: "  WHICH FILE SHOULD I READ?!  " },
      },
      undefined,
      { softFail: true },
    );
    assert.equal(dup.outcome, "rejected");
    assert.match(dup.error ?? "", /Duplicate question already asked/);

    // Substring duplicate
    const subDup = await proposeAction(
      t.id,
      {
        actionClass: "ask",
        name: "reach.ask_user",
        args: { question: "Which file should I read right now?" },
      },
      undefined,
      { softFail: true },
    );
    assert.equal(subDup.outcome, "rejected");
    assert.match(subDup.error ?? "", /Duplicate question already asked/);
  });

  it("answering question records answer and question naming prior answer is rejected", async () => {
    const { setPlannerBackendFactory } = await import("../planner/loop.js");
    setPlannerBackendFactory(() => ({
      backendName: "idle-mock",
      converse: () => new Promise(() => {}),
    }));
    try {
      const t = task("clarification test task 3");
      await proposeAction(t.id, {
        actionClass: "ask",
        name: "reach.ask_user",
        args: { question: "Which document should I process?" },
      });
      const ans = answerInput(t.id, "budget.xlsx");
      assert.equal(ans.ok, true);
      assert.equal(getTask(t.id)?.status, "running");
      assert.equal(getTask(t.id)?.askedQuestions?.[0]?.answer, "budget.xlsx");

      // Repeat question naming the prior answer
      const repeat = await proposeAction(
        t.id,
        {
          actionClass: "ask",
          name: "reach.ask_user",
          args: { question: "Should I open the budget.xlsx file?" },
        },
        undefined,
        { softFail: true },
      );
      assert.equal(repeat.outcome, "rejected");
      assert.match(repeat.error ?? "", /Question already answered/);
      assert.match(repeat.error ?? "", /budget\.xlsx/);
    } finally {
      setPlannerBackendFactory(undefined);
    }
  });

  it("hard cap of 3 questions per task rejects subsequent asks", async () => {
    const { setPlannerBackendFactory } = await import("../planner/loop.js");
    setPlannerBackendFactory(() => ({
      backendName: "idle-mock",
      converse: () => new Promise(() => {}),
    }));
    try {
      const t = task("clarification test task 4");
      // Question 1
      const q1 = await proposeAction(t.id, {
        actionClass: "ask",
        name: "reach.ask_user",
        args: { question: "First question: which folder?" },
      });
      assert.equal(q1.outcome, "paused");
      answerInput(t.id, "Documents");

      // Question 2
      const q2 = await proposeAction(t.id, {
        actionClass: "ask",
        name: "reach.ask_user",
        args: { question: "Second question: which format?" },
      });
      assert.equal(q2.outcome, "paused");
      assert.equal(getTask(t.id)?.pendingInput?.questionCount, 2);
      answerInput(t.id, "PDF");

      // Question 3
      const q3 = await proposeAction(t.id, {
        actionClass: "ask",
        name: "reach.ask_user",
        args: { question: "Third question: should I compress it?" },
      });
      assert.equal(q3.outcome, "paused");
      assert.equal(getTask(t.id)?.pendingInput?.questionCount, 3);
      answerInput(t.id, "No");

      // Question 4: exceeds cap of 3
      const q4 = await proposeAction(
        t.id,
        {
          actionClass: "ask",
          name: "reach.ask_user",
          args: { question: "Fourth question: where should I send it?" },
        },
        undefined,
        { softFail: true },
      );
      assert.equal(q4.outcome, "rejected");
      assert.match(q4.error ?? "", /Question budget exhausted \(3\/3 questions already asked for this task\)/);
      assert.equal(getTask(t.id)?.askedQuestions?.length, 3);
    } finally {
      setPlannerBackendFactory(undefined);
    }
  });
});
