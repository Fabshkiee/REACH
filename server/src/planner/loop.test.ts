import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

process.env.REACH_DATA_DIR = mkdtempSync(join(tmpdir(), "reach-a3-loop-"));

import { clearActionRegistry, defineAction } from "../executor/registry.js";
import { ScriptedPlannerBackend } from "./mock.js";
import { getTask, createTask } from "../tasks/taskStore.js";
import { decideApproval, executeOnMyDevices } from "../mcp/tools.js";
import { resumeLoop, runPlannerLoop, setPlannerBackendFactory } from "./loop.js";

const HERE = dirname(fileURLToPath(import.meta.url));

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

async function pollDone(taskId: string, timeoutMs = 8000): Promise<string> {
  const start = Date.now();
  for (;;) {
    const t = getTask(taskId);
    if (!t) throw new Error("task vanished");
    if (t.status === "completed" || t.status === "failed") return t.status;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting, status=${t.status}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeEach(() => {
  testDefs();
  setPlannerBackendFactory(undefined);
});
afterEach(() => {
  setPlannerBackendFactory(undefined);
});

describe("planner loop", () => {
  it("runs multi-step plans to completion with trace", async () => {
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "test.step", args: { label: "one" } }] },
      { toolCalls: [{ name: "test.step", args: { label: "two" } }] },
      { text: "Both observations done." },
    ]);
    const t = createTask("scripted multi-step goal");
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(await pollDone(t.id), "completed");
    const after = getTask(t.id)!;
    assert.equal(after.trace?.length, 2);
    assert.ok((after.plan?.length ?? 0) >= 2);
    assert.equal(mock.calls.length, 3);
  });

  it("recovers from unknown tools and finishes", async () => {
    const mock = new ScriptedPlannerBackend(
      [
        { toolCalls: [{ name: "nope.missing", args: {} }] },
        { toolCalls: [{ name: "test.step", args: {} }] },
        { text: "Recovered." },
      ],
      { strict: false },
    );
    const t = createTask("scripted recovery goal");
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(await pollDone(t.id), "completed");
    assert.ok((getTask(t.id)?.plan ?? []).some((p) => p.includes('rejected unknown tool "nope.missing"')));
  });

  it("pauses on confirm-class actions and resumes after approval", async () => {
    const mock1 = new ScriptedPlannerBackend([{ toolCalls: [{ name: "test.doomed", args: {} }] }]);
    const t = createTask("scripted approval goal");
    await runPlannerLoop(t.id, { backend: mock1 });
    const paused = getTask(t.id)!;
    assert.equal(paused.status, "awaiting_approval");
    assert.ok(paused.pendingApproval);
    const approvalId = paused.pendingApproval!.id;

    setPlannerBackendFactory(
      () =>
        new ScriptedPlannerBackend([{ text: "Approved work finished." }]),
    );
    const res = await decideApproval({ approvalId, decision: "approve" }, "test");
    assert.equal(res.ok, true);
    assert.equal(await pollDone(t.id), "completed");
  });

  it("pauses for ask_user and resumes with the answer", async () => {
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "reach.ask_user", args: { question: "Which file?" } }] },
    ]);
    const t = createTask("scripted clarify goal");
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(getTask(t.id)?.status, "awaiting_input");
    // Resume with a mock that ACTS before declaring done: a text-only finish
    // with zero executed actions is (correctly) a failure, not a completion.
    setPlannerBackendFactory(() => new ScriptedPlannerBackend([{ toolCalls: [{ name: "test.step", args: {} }] }, { text: "Answered and done." }]));
    await resumeLoop(t.id, `User answered "Which file?": "the invoice"`);
    assert.equal(await pollDone(t.id), "completed");
  });

  it("fails fast when the model cannot ground the goal", async () => {
    const mock = new ScriptedPlannerBackend([{ text: "CANNOT: no capability matches." }]);
    const t = createTask("fsdf unplannable gibberish");
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(await pollDone(t.id), "failed");
    assert.match(getTask(t.id)?.error ?? "", /could not ground/);
  });

  it("text-only finish without executed work fails (no narrated success)", async () => {
    // A pause record alone is not grounding: the model must DO something
    // before declaring done, or the finish is a hallucinated success.
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "reach.ask_user", args: { question: "Q?" } }] },
      { text: "All done!" },
    ]);
    const t = createTask("scripted narration trap");
    await runPlannerLoop(t.id, { backend: mock });
    setPlannerBackendFactory(() => new ScriptedPlannerBackend([{ text: "All done!" }]));
    await resumeLoop(t.id, `User answered "Q?": "a"`);
    assert.equal(await pollDone(t.id), "failed");
    assert.match(getTask(t.id)?.error ?? "", /could not ground/);
  });

  it("every goal goes through the loop (uniform engine)", async () => {
    setPlannerBackendFactory(
      () =>
        new ScriptedPlannerBackend([
          { toolCalls: [{ name: "test.step", args: {} }] },
          { text: "Done via loop." },
        ]),
    );
    const { taskId } = executeOnMyDevices({ task: "any goal at all, even unclassifiable zzz" });
    assert.equal(await pollDone(taskId), "completed");
    assert.ok((getTask(taskId)?.trace?.length ?? 0) >= 1);
  });
});

describe("no goal-string routing (structural)", () => {
  it("no non-test source routes on goal text", () => {
    const srcDir = join(HERE, "..");
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!p.endsWith(".ts") || p.endsWith(".test.ts")) continue;
        const s = readFileSync(p, "utf8");
        if (/\brouteTask\b|DOC_REQUEST|deriveDocTitle/.test(s)) bad.push(p);
        if (/tasks\/runner/.test(s)) bad.push(p + " (runner import)");
      }
    };
    walk(srcDir);
    assert.deepEqual(bad, []);
  });
});
