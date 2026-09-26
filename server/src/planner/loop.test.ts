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
    const t = createTask("scripted multi-step goal");
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "test.step", args: { label: "one" } }] },
      { toolCalls: [{ name: "test.step", args: { label: "two" } }] },
      {
        toolCalls: [
          {
            name: "reach.finish",
            args: () => ({
              kind: "complete",
              summary: "Both observations done.",
              evidenceActionIds: (getTask(t.id)?.trace ?? []).filter((r) => r.ok && r.verified).map((r) => r.actionId),
            }),
          },
        ],
      },
    ]);
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(await pollDone(t.id), "completed");
    const after = getTask(t.id)!;
    assert.equal(after.trace?.length, 2);
    assert.ok((after.plan?.length ?? 0) >= 2);
    assert.equal(mock.calls.length, 3);
  });

  it("recovers from unknown tools and finishes", async () => {
    const t = createTask("scripted recovery goal");
    const mock = new ScriptedPlannerBackend(
      [
        { toolCalls: [{ name: "nope.missing", args: {} }] },
        { toolCalls: [{ name: "test.step", args: {} }] },
        {
          toolCalls: [
            {
              name: "reach.finish",
              args: () => ({
                kind: "complete",
                summary: "Recovered.",
                evidenceActionIds: (getTask(t.id)?.trace ?? []).filter((r) => r.ok && r.verified).map((r) => r.actionId),
              }),
            },
          ],
        },
      ],
      { strict: false },
    );
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
    await resumeLoop(t.id, `User answered "Which file?": "the invoice"`);
    assert.equal(await pollDone(t.id), "completed");
  });

  it("fails fast when the model cannot ground the goal", async () => {
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "reach.finish", args: { kind: "cannot", reason: "no capability matches." } }] },
    ]);
    const t = createTask("fsdf unplannable gibberish");
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(await pollDone(t.id), "failed");
    // Honest cannot: status failed, outcome carries the reason + empty evidence.
    assert.equal(getTask(t.id)?.outcome?.kind, "cannot");
    assert.match(getTask(t.id)?.error ?? "", /no capability matches/);
  });

  it("plain-text finish is rejected and redirected to reach.finish", async () => {
    const t = createTask("scripted plain-text rejection");
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "test.step", args: {} }] },
      { text: "I finished everything!" },
      {
        toolCalls: [
          {
            name: "reach.finish",
            args: () => ({
              kind: "complete",
              summary: "Properly finished.",
              evidenceActionIds: (getTask(t.id)?.trace ?? []).filter((r) => r.ok && r.verified).map((r) => r.actionId),
            }),
          },
        ],
      },
    ]);
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(await pollDone(t.id), "completed");
    const task = getTask(t.id)!;
    assert.ok(task.plan?.some((p) => p.includes("rejected plain-text turn — directed to reach.finish")));
    assert.equal(mock.calls.length, 3);
  });

  it("every goal goes through the loop (uniform engine)", async () => {
    let createdTaskId = "";
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
                  summary: "Done via loop.",
                  evidenceActionIds: (getTask(createdTaskId)?.trace ?? []).filter((r) => r.ok && r.verified).map((r) => r.actionId),
                }),
              },
            ],
          },
        ]),
    );
    const { taskId } = executeOnMyDevices({ task: "any goal at all, even unclassifiable zzz" });
    createdTaskId = taskId;
    assert.equal(await pollDone(taskId), "completed");
    assert.ok((getTask(taskId)?.trace?.length ?? 0) >= 1);
  });

  it("grounding rules: apps.launch of browser names and unknown utilities is rejected", async () => {
    defineAction({
      name: "apps.launch",
      actionClass: "launch",
      description: "Launch desktop utility",
      schema: z.object({ app: z.string() }),
      timeoutMs: 5000,
      verify: () => "launched",
      handler: async (args) => ({ launched: args["app"] }),
    });

    const t = createTask("grounding rejection test");
    const mock = new ScriptedPlannerBackend([
      // Browser name rejected
      { toolCalls: [{ name: "apps.launch", args: { app: "chrome" } }] },
      // Browser name with .exe rejected
      { toolCalls: [{ name: "apps.launch", args: { app: "msedge.exe" } }] },
      // Unknown utility rejected
      { toolCalls: [{ name: "apps.launch", args: { app: "some_malicious_bin" } }] },
      // Finish with grounded cannot
      {
        toolCalls: [
          {
            name: "reach.finish",
            args: {
              kind: "cannot",
              reason: "apps.launch cannot be used for browsers or unknown utilities",
            },
          },
        ],
      },
    ], { strict: false });
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(await pollDone(t.id), "failed");
    const task = getTask(t.id)!;
    assert.ok(task.plan?.some((p) => p.includes('rejected apps.launch for browser "chrome"')));
    assert.ok(task.plan?.some((p) => p.includes('rejected apps.launch for browser "msedge.exe"')));
    assert.ok(task.plan?.some((p) => p.includes('rejected apps.launch for unknown utility "some_malicious_bin"')));
    // Assert user feedback messages in history (call index 3 before finish)
    const history = mock.calls[3].history;
    const historyText = JSON.stringify(history);
    assert.ok(historyText.includes("Web browsing must use web.* or browser.* tools"));
    assert.ok(historyText.includes("apps.launch is restricted to known desktop utilities"));
    assert.equal(task.outcome?.kind, "cannot");
  });

  it("step-exhaustion auto-continuation past 8 turns re-seeds with compact trace summary", async () => {
    const t = createTask("step exhaustion auto-continuation test");
    // Script 10 turns: 8 test.step in horizon 1, then 1 test.step + 1 reach.finish in horizon 2
    const turns = [
      { toolCalls: [{ name: "test.step", args: { label: "step 1" } }] },
      { toolCalls: [{ name: "test.step", args: { label: "step 2" } }] },
      { toolCalls: [{ name: "test.step", args: { label: "step 3" } }] },
      { toolCalls: [{ name: "test.step", args: { label: "step 4" } }] },
      { toolCalls: [{ name: "test.step", args: { label: "step 5" } }] },
      { toolCalls: [{ name: "test.step", args: { label: "step 6" } }] },
      { toolCalls: [{ name: "test.step", args: { label: "step 7" } }] },
      { toolCalls: [{ name: "test.step", args: { label: "step 8" } }] },
      // Turn 9: first turn of horizon 2
      { toolCalls: [{ name: "test.step", args: { label: "step 9" } }] },
      // Turn 10: finish citing verified actions
      {
        toolCalls: [
          {
            name: "reach.finish",
            args: () => ({
              kind: "complete",
              summary: "Completed across multiple step horizons.",
              evidenceActionIds: (getTask(t.id)?.trace ?? []).filter((r) => r.ok && r.verified).map((r) => r.actionId),
            }),
          },
        ],
      },
    ];
    const mock = new ScriptedPlannerBackend(turns);
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(await pollDone(t.id), "completed");
    const task = getTask(t.id)!;
    assert.equal(mock.calls.length, 10);
    // Verified auto-continuation in plan
    assert.ok(task.plan?.some((p) => p.includes("step horizon reached (8 turns) — auto-continuing with verified trace summary")));
    // Verified auto-continuation in task events
    assert.ok((task.events ?? []).some((e) => e.kind === "action_finished" && (e.summary ?? "").includes("auto-continuing")));
    // Verified re-seeded history in turn 9 (call index 8)
    const turn9History = mock.calls[8].history;
    assert.equal(turn9History[0].role, "user");
    assert.equal(turn9History[0].text, task.goal);
    assert.equal(turn9History[1].role, "assistant");
    assert.ok(turn9History[1].text?.includes("Step horizon checkpoint: completed 8 turns"));
    assert.equal(turn9History[2].role, "user");
    assert.ok(turn9History[2].text?.includes("Budget checkpoint: 8 turns completed. Verified progress so far"));
    assert.equal(task.outcome?.kind, "complete");
    assert.equal(task.outcome?.evidenceActionIds.length, 9);
  });

  it("CANNOT plain-text turn is rejected and directed to reach.finish cannot", async () => {
    const t = createTask("cannot plain text rejection");
    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "test.step", args: {} }] },
      { text: "CANNOT: missing third-party API integration." },
      {
        toolCalls: [
          {
            name: "reach.finish",
            args: () => ({
              kind: "cannot",
              reason: "missing third-party API integration.",
              evidenceActionIds: (getTask(t.id)?.trace ?? []).filter((r) => r.ok && r.verified).map((r) => r.actionId),
            }),
          },
        ],
      },
    ]);
    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(await pollDone(t.id), "failed");
    const task = getTask(t.id)!;
    assert.ok(task.plan?.some((p) => p.includes("rejected plain-text turn — directed to reach.finish")));
    assert.equal(task.outcome?.kind, "cannot");
  });

  it("two-tier planning: reach.checkpoint_milestone logs milestone event and advances sub-goal", async () => {
    defineAction({
      name: "test.step1",
      actionClass: "observe",
      description: "Perform sub-goal step 1",
      schema: z.object({}),
      timeoutMs: 5000,
      verify: () => "verified step 1",
      handler: async () => ({ step: 1 }),
    });

    defineAction({
      name: "test.step2",
      actionClass: "observe",
      description: "Perform sub-goal step 2",
      schema: z.object({}),
      timeoutMs: 5000,
      verify: () => "verified step 2",
      handler: async () => ({ step: 2 }),
    });

    const t = createTask("composite goal test");

    const mock = new ScriptedPlannerBackend([
      { toolCalls: [{ name: "test.step1", args: {} }] },
      {
        toolCalls: [
          {
            name: "reach.checkpoint_milestone",
            args: { completed: "Gathered all required data", next: "Generate final report" },
          },
        ],
      },
      { toolCalls: [{ name: "test.step2", args: {} }] },
      {
        toolCalls: [
          {
            name: "reach.checkpoint_milestone",
            args: { completed: "Generated final report" },
          },
        ],
      },
      {
        toolCalls: [
          {
            name: "reach.finish",
            args: () => {
              const trace = getTask(t.id)?.trace ?? [];
              const verified = trace.filter((r) => r.ok && r.verified).map((r) => r.actionId);
              return {
                kind: "complete",
                summary: "All milestones accomplished.",
                evidenceActionIds: verified,
              };
            },
          },
        ],
      },
    ]);

    await runPlannerLoop(t.id, { backend: mock });
    assert.equal(await pollDone(t.id), "completed");
    const task = getTask(t.id)!;
    assert.ok(task.plan?.some((p) => p.includes('milestone "Gathered all required data" (next: Generate final report)')));
    assert.ok(task.plan?.some((p) => p.includes('milestone "Generated final report"')));

    const milestoneEvents = (task.events ?? []).filter((e) => e.kind === "milestone_completed");
    assert.equal(milestoneEvents.length, 2);
    assert.ok(milestoneEvents[0]?.summary.includes("Gathered all required data"));
    assert.ok(milestoneEvents[1]?.summary.includes("Generated final report"));
    assert.equal(task.outcome?.kind, "complete");
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
