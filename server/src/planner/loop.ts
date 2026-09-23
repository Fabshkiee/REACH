import { randomUUID } from "node:crypto";
import { BedrockPlannerBackend } from "./bedrock.js";
import { requireBedrockConfig } from "../config.js";
import { proposeAction } from "../executor/executor.js";
import { getActionDef } from "../executor/registry.js";
import { policyContextForAvailable } from "../policy/context.js";
import { defaultPolicyContext } from "../policy/engine.js";
import { claimLoopSlot, getTask, isTerminalStatus, releaseLoopSlot, setTaskStatus, appendTaskEvent } from "../tasks/taskStore.js";
import { failureFeedback, recoveryHintFor } from "../executor/recovery.js";
import type { ActionRecord, TaskOutcome, TaskStatus } from "../tasks/types.js";
import type { HistoryEntry, PlannerBackend } from "./backend.js";
import { FINISH_TOOL_NAME, toolsForPlanner, type FinishArgs } from "./tools.js";

const MAX_STEPS = Number(process.env.PLANNER_MAX_STEPS ?? 8);

const SYSTEM = [
  "You are the REACH planner: given a user goal, achieve it by calling the offered tools, one per turn.",
  "Rules:",
  "- Call exactly ONE tool per turn. Never invent tool names — only call tools from the offered set.",
  "- If the target of an action is genuinely ambiguous (which file? which device?), call reach.ask_user instead of guessing.",
  "- Some actions pause for user approval; you will be told when that happens. Continue after approval arrives.",
  "- When no more actions are needed, call reach.finish with kind + evidence: complete (cite verified actionIds), partial (cite prior evidence + remaining work), cannot (missing capabilities + reason), unverified (reason), or failed (reason). Narration without cited evidence is rejected.",
  "- Plain-text replies are legacy only: a summary means done, starting with CANNOT: means unachievable. Both are validated against the trace like reach.finish.",
  "- Failures teach: a FAILED result may carry a Recovery hint naming the next move — use it instead of guessing.",
  "- Recover, then ask, then concede: after a failure, retry with a changed approach (at most 2 autonomous recoveries: different args, narrower scope, or sibling tool). If still stuck or the choice changes the outcome, call reach.ask_user with concrete options. Only then reach.finish cannot, preserving partial evidence.",
  "- Directories are listed with files.list (names + sizes); files.read pages large files via offsetChars. Never verify a directory as a file.",
  "- Keep reasoning brief. Temperature is 0; be decisive.",
].join("\n");

type BackendFactory = () => PlannerBackend;
let factoryOverride: BackendFactory | undefined;

/** Tests inject a scripted backend; production uses Bedrock from env. */
export function setPlannerBackendFactory(fn: BackendFactory | undefined): void {
  factoryOverride = fn;
}

function backendFromEnv(): PlannerBackend {
  const { region, modelId } = requireBedrockConfig();
  return new BedrockPlannerBackend(region, modelId);
}

function activeBackend(explicit?: PlannerBackend): PlannerBackend {
  if (explicit) return explicit;
  if (factoryOverride) return factoryOverride();
  return backendFromEnv();
}

function traceSummary(taskId: string): string {
  const task = getTask(taskId);
  const lines = (task?.trace ?? []).map((r) => {
    const what = `${r.name}${r.target ? ` on "${r.target}"` : ""}`;
    const how = r.policyVerdict === "allow" ? "ran" : r.policyVerdict;
    return `- ${what} [${how}]${r.ok === false ? ` FAILED: ${r.resultSummary ?? ""}` : ""}${r.resultSummary && r.ok ? `: ${r.resultSummary.slice(0, 200)}` : ""}`;
  });
  return lines.length > 0 ? lines.join("\n") : "(no actions yet)";
}

/** Trace records that count as real work: ok, not a question, not a pause marker. */
function succeededRecords(taskId: string): ActionRecord[] {
  return (getTask(taskId)?.trace ?? []).filter(
    (r) =>
      r.ok === true &&
      r.actionClass !== "ask" &&
      !String(r.resultSummary ?? "").startsWith("paused for approval"),
  );
}

function verifiedRecords(taskId: string): ActionRecord[] {
  return succeededRecords(taskId).filter((r) => r.verified === true);
}

function budgetOf(taskId: string): { maxPlannerCalls: number; maxElapsedMs: number; maxActions: number } {
  const task = getTask(taskId);
  return {
    maxPlannerCalls: task?.budget?.maxPlannerCalls ?? 24,
    maxElapsedMs: task?.budget?.maxElapsedMs ?? 10 * 60_000,
    maxActions: task?.budget?.maxActions ?? 40,
  };
}

function asStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string").slice(0, 50) : [];
}

/**
 * Validate a reach.finish claim against the trace. Returns a terminal
 * status+patch when the claim is grounded, or an error string to feed back
 * to the model when it is not (narration without evidence is never terminal).
 */
function validateFinish(taskId: string, raw: Record<string, unknown>): { terminal: { status: TaskStatus; patch: Record<string, unknown> } } | { invalid: string } {
  const args = raw as unknown as FinishArgs;
  const kind = args.kind;
  if (kind !== "complete" && kind !== "partial" && kind !== "unverified" && kind !== "failed" && kind !== "cannot") {
    return { invalid: `reach.finish needs kind one of complete|partial|unverified|failed|cannot, got ${JSON.stringify(kind) ?? "missing"}.` };
  }
  const trace = getTask(taskId)?.trace ?? [];
  const byId = new Map(trace.map((r) => [r.actionId, r]));
  const cited = asStringArray(args.evidenceActionIds);
  const bad = cited.filter((id) => {
    const r = byId.get(id);
    return !r || r.ok !== true;
  });
  const summary = typeof args.summary === "string" ? args.summary.slice(0, 500) : "";
  const reason = typeof args.reason === "string" ? args.reason.slice(0, 500) : "";
  const missingCapabilities = asStringArray(args.missingCapabilities);
  const remaining = asStringArray(args.remaining);

  if (kind === "complete") {
    if (cited.length === 0) return { invalid: "reach.finish complete needs evidenceActionIds citing verified trace actions." };
    if (bad.length > 0) return { invalid: `reach.finish complete cites unknown/failed actions: ${bad.join(", ")}. Cite only successful trace actionIds.` };
    const unverified = cited.filter((id) => byId.get(id)?.verified !== true);
    if (unverified.length > 0) {
      return { invalid: `reach.finish complete cites unverified actions: ${unverified.join(", ")}. Use kind unverified, or wait for verification.` };
    }
    const outcome: TaskOutcome = { kind: "complete", summary: summary || "done", evidenceActionIds: cited };
    return {
      terminal: {
        status: "completed",
        patch: {
          outcome,
          evidence: { deviceId: "reach-core", capabilityId: "planner-loop", note: outcome.summary },
        },
      },
    };
  }
  if (kind === "partial") {
    if (cited.length === 0) return { invalid: "reach.finish partial needs evidenceActionIds for the work that succeeded." };
    if (bad.length > 0) return { invalid: `reach.finish partial cites unknown/failed actions: ${bad.join(", ")}.` };
    const outcome: TaskOutcome = {
      kind: "partial",
      summary: summary || "partially done",
      evidenceActionIds: cited,
      remaining,
    };
    return {
      terminal: {
        status: "completed",
        patch: {
          outcome,
          evidence: { deviceId: "reach-core", capabilityId: "planner-loop", note: outcome.summary },
        },
      },
    };
  }
  if (kind === "unverified") {
    if (cited.length === 0) return { invalid: "reach.finish unverified needs evidenceActionIds for the unconfirmed work." };
    if (bad.length > 0) return { invalid: `reach.finish unverified cites unknown/failed actions: ${bad.join(", ")}.` };
    const outcome: TaskOutcome = {
      kind: "unverified",
      summary: summary || undefined,
      reason: reason || "effect could not be independently verified",
      evidenceActionIds: cited,
    };
    return {
      terminal: {
        status: "completed",
        patch: {
          outcome,
          evidence: { deviceId: "reach-core", capabilityId: "planner-loop", note: summary || outcome.reason },
        },
      },
    };
  }
  // failed | cannot: evidence optional (may be empty when nothing ran).
  if (bad.length > 0) return { invalid: `reach.finish ${kind} cites unknown/failed actions: ${bad.join(", ")}.` };
  const outcome: TaskOutcome = {
    kind,
    reason: reason || summary || (kind === "cannot" ? "goal cannot be achieved with available capabilities" : "task failed"),
    evidenceActionIds: cited,
    ...(kind === "cannot" && missingCapabilities.length > 0 ? { missingCapabilities } : {}),
  };
  return { terminal: { status: "failed", patch: { outcome, error: outcome.reason } } };
}

/**
 * Run (or resume) the ReAct loop for a task. Entry points:
 * - fresh goals via execute_on_my_devices,
 * - continuations via decide_approval (approval granted) and /tasks/:id/input.
 * Every terminal path sets a terminal task status — the loop never strands tasks.
 * Single-flight: a duplicate invocation for the same task exits silently.
 */
export async function runPlannerLoop(
  taskId: string,
  opts: { backend?: PlannerBackend; resumeNote?: string } = {},
): Promise<void> {
  const task = getTask(taskId);
  if (!task || isTerminalStatus(task.status)) return;

  let backend: PlannerBackend;
  try {
    backend = activeBackend(opts.backend);
  } catch (err) {
    setTaskStatus(taskId, "failed", {
      outcome: { kind: "failed", reason: err instanceof Error ? err.message : "planner backend unavailable", evidenceActionIds: [] },
      error: err instanceof Error ? err.message : "planner backend unavailable",
    });
    return;
  }

  // Single-flight: exactly one loop per task. A concurrent resume/approve is a
  // no-op — it must never spawn a second loop or overwrite terminal state.
  const slot = randomUUID();
  if (!claimLoopSlot(taskId, slot)) return;

  const policyCtx = { ...defaultPolicyContext(), ...policyContextForAvailable() };
  const tools = toolsForPlanner();
  const history: HistoryEntry[] = [{ role: "user", text: task.goal }];
  if (opts.resumeNote) {
    history.push({
      role: "user",
      text: `Context from earlier in this task (audit-trace summary, not verbatim):\n${traceSummary(taskId)}\n${opts.resumeNote}`,
    });
  }
  const plan: string[] = [...(task.plan ?? [])];
  // Consecutive FAILED turns (reset by ok/paused): after MAX_AUTONOMOUS_RECOVERIES
  // the feedback orders ask_user over another blind retry.
  let consecutiveFailures = 0;
  let inTokens = task.usage?.inputTokens ?? 0;
  let outTokens = task.usage?.outputTokens ?? 0;
  let callCount = task.usage?.calls ?? 0;
  const saveUsage = () => setTaskStatus(taskId, getTask(taskId)?.status ?? "running", { usage: { inputTokens: inTokens, outputTokens: outTokens, calls: callCount } });
  /** Terminal or pause exit: persist, account usage, release the loop slot. */
  const exit = (status: TaskStatus, patch: Record<string, unknown> = {}) => {
    setTaskStatus(taskId, status, patch);
    const outcome = patch["outcome"] as TaskOutcome | undefined;
    if (outcome && (status === "completed" || status === "failed")) {
      appendTaskEvent(taskId, {
        kind: "outcome_set",
        status: outcome.kind === "complete" || outcome.kind === "partial" ? "succeeded" : outcome.kind === "unverified" ? "unverified" : "failed",
        summary: (outcome.summary || outcome.reason || outcome.kind).slice(0, 300),
        evidenceActionIds: outcome.evidenceActionIds,
      });
    }
    saveUsage();
    releaseLoopSlot(taskId, slot);
  };
  const budget = budgetOf(taskId);
  const startedMs = Date.parse(task.createdAt);

  setTaskStatus(taskId, "running", { plan });
  const stepBase = plan.length;

  for (let step = 1; step <= MAX_STEPS; step++) {
    // Cooperative cancel + terminal check at every step boundary.
    const live = getTask(taskId);
    if (!live || isTerminalStatus(live.status)) {
      releaseLoopSlot(taskId, slot);
      return;
    }
    // Cumulative task-wide budgets (survive approval/input resumes via usage).
    if (callCount >= budget.maxPlannerCalls) {
      const ids = succeededRecords(taskId).map((r) => r.actionId);
      exit("failed", {
        plan,
        outcome: {
          kind: "failed",
          reason: `planner budget exhausted: ${callCount} model calls (max ${budget.maxPlannerCalls})`,
          evidenceActionIds: ids,
        } satisfies TaskOutcome,
        error: `planner budget exhausted: ${callCount} model calls (max ${budget.maxPlannerCalls})`,
      });
      return;
    }
    if (Date.now() - startedMs >= budget.maxElapsedMs) {
      const ids = succeededRecords(taskId).map((r) => r.actionId);
      exit("failed", {
        plan,
        outcome: {
          kind: "failed",
          reason: `planner time budget exhausted (${Math.round(budget.maxElapsedMs / 1000)}s elapsed)`,
          evidenceActionIds: ids,
        } satisfies TaskOutcome,
        error: `planner time budget exhausted (${Math.round(budget.maxElapsedMs / 1000)}s elapsed)`,
      });
      return;
    }

    let turn;
    try {
      const res = await backend.converse({ system: SYSTEM, history, tools, maxTokens: 2000 });
      turn = res.turn;
      inTokens += res.usage.inputTokens;
      outTokens += res.usage.outputTokens;
      callCount += 1;
    } catch (err) {
      exit("failed", {
        outcome: { kind: "failed", reason: `planner backend failed at step ${stepBase + step}: ${err instanceof Error ? err.message : err}`, evidenceActionIds: succeededRecords(taskId).map((r) => r.actionId) } satisfies TaskOutcome,
        error: `planner backend failed at step ${stepBase + step}: ${err instanceof Error ? err.message : err}`,
        plan,
      });
      return;
    }

    // Text-only turn: legacy finish, validated against the trace like reach.finish.
    if (turn.toolCalls.length === 0) {
      const text = turn.text.trim();
      const succeeded = succeededRecords(taskId);
      if (text.toUpperCase().startsWith("CANNOT:")) {
        const reason = text.slice("CANNOT:".length).trim().slice(0, 500) || text.slice(0, 500);
        // A CANNOT after partial work preserves that evidence — it never
        // overwrites the trace as completed.
        exit("failed", {
          plan,
          outcome: { kind: "cannot", reason, evidenceActionIds: succeeded.map((r) => r.actionId) } satisfies TaskOutcome,
          error: reason,
        });
        return;
      }
      if (succeeded.length === 0) {
        // No grounding whatsoever — fail fast with the model's own reason,
        // never a hallucinated success. Preserves v1 fail-fast honesty.
        exit("failed", {
          outcome: { kind: "failed", reason: text ? `planner could not ground the goal: ${text.slice(0, 500)}` : "planner stalled with no actions", evidenceActionIds: [] } satisfies TaskOutcome,
          error: text ? `planner could not ground the goal: ${text.slice(0, 500)}` : "planner stalled with no actions",
          plan,
        });
        return;
      }
      const verified = verifiedRecords(taskId);
      if (verified.length === succeeded.length) {
        exit("completed", {
          plan,
          outcome: { kind: "complete", summary: text.slice(0, 500) || "done", evidenceActionIds: verified.map((r) => r.actionId) } satisfies TaskOutcome,
          evidence: { deviceId: "reach-core", capabilityId: "planner-loop", note: text.slice(0, 500) || "done" },
        });
        return;
      }
      exit("completed", {
        plan,
        outcome: {
          kind: "unverified",
          summary: text.slice(0, 500) || undefined,
          reason: `${succeeded.length - verified.length} of ${succeeded.length} actions lack independent verification`,
          evidenceActionIds: verified.map((r) => r.actionId),
        } satisfies TaskOutcome,
        evidence: { deviceId: "reach-core", capabilityId: "planner-loop", note: text.slice(0, 500) || "done (unverified)" },
      });
      return;
    }

    // One action per turn; extras are reported, never silently run.
    const [first, ...rest] = turn.toolCalls;
    if (!first) {
      exit("failed", {
        outcome: { kind: "failed", reason: "planner returned an empty tool call", evidenceActionIds: succeededRecords(taskId).map((r) => r.actionId) } satisfies TaskOutcome,
        error: "planner returned an empty tool call",
        plan,
      });
      return;
    }
    history.push({ role: "assistant", text: turn.text, toolCalls: [first] });
    if (rest.length > 0) {
      plan.push(`step ${stepBase + step}: ignored ${rest.length} extra tool call(s) — one action per turn`);
    }

    // Structured finish: validated server-side, never dispatched to the executor.
    if (first.name === FINISH_TOOL_NAME) {
      const checked = validateFinish(taskId, first.args);
      if ("terminal" in checked) {
        plan.push(`step ${stepBase + step}: reach.finish ${String((first.args as unknown as FinishArgs).kind)} accepted`);
        exit(checked.terminal.status, { ...checked.terminal.patch, plan });
        return;
      }
      plan.push(`step ${stepBase + step}: reach.finish rejected — ${checked.invalid.slice(0, 200)}`);
      history.push({
        role: "user",
        toolResults: [{ toolCallId: first.id, content: `ERROR: ${checked.invalid} Continue with verified actions or a grounded cannot.` }],
      });
      setTaskStatus(taskId, "running", { plan });
      saveUsage();
      continue;
    }

    const def = getActionDef(first.name);
    if (!def && first.name !== "reach.ask_user") {
      history.push({
        role: "user",
        toolResults: [{ toolCallId: first.id, content: `ERROR: no registered capability named "${first.name}". Use only the offered tools.` }],
      });
      plan.push(`step ${stepBase + step}: rejected unknown tool "${first.name}"`);
      setTaskStatus(taskId, "running", { plan });
      continue;
    }
    const actionClass = def?.actionClass ?? "ask";
    const timeoutMs = def?.timeoutMs ?? 30_000;
    const target = def?.targetOf?.(first.args);

    // Action-count budget before dispatching side effects.
    if ((getTask(taskId)?.trace?.length ?? 0) >= budget.maxActions) {
      exit("failed", {
        plan,
        outcome: {
          kind: "failed",
          reason: `action budget exhausted (${budget.maxActions} actions)`,
          evidenceActionIds: succeededRecords(taskId).map((r) => r.actionId),
        } satisfies TaskOutcome,
        error: `action budget exhausted (${budget.maxActions} actions)`,
      });
      return;
    }

    const proposed = await proposeAction(
      taskId,
      {
        actionClass,
        name: first.name,
        args: first.args,
        target,
        timeoutMs,
      },
      policyCtx,
      { softFail: true },
    );
    const label = `step ${stepBase + step}: ${first.name}${proposed.actionId ? ` (${proposed.actionId})` : ""}`;
    if (proposed.outcome === "ran") {
      consecutiveFailures = 0;
      plan.push(`${label} → ok`);
      history.push({
        role: "user",
        // 8k chars ≈ 2k tokens: enough for page snapshots, bounded for an
        // 8-step loop against Nova's 1M context.
        toolResults: [
          {
            toolCallId: first.id,
            content: `OK: ${JSON.stringify(proposed.data).slice(0, 8000)}${proposed.verified === false ? " (UNVERIFIED)" : " (verified)"}`,
          },
        ],
      });
    } else if (proposed.outcome === "paused") {
      consecutiveFailures = 0;
      plan.push(`${label} → paused (awaiting user)`);
      setTaskStatus(taskId, getTask(taskId)?.status ?? task.status, { plan });
      saveUsage();
      releaseLoopSlot(taskId, slot);
      return; // resumeLoop continues after approval/answer
    } else {
      consecutiveFailures += 1;
      plan.push(`${label} → FAILED: ${(proposed.error ?? "").slice(0, 200)}`);
      history.push({
        role: "user",
        toolResults: [
          {
            toolCallId: first.id,
            content: failureFeedback({
              error: proposed.error ?? "unknown error",
              hint: recoveryHintFor(actionClass, proposed.error ?? ""),
              consecutiveFailures,
            }),
          },
        ],
      });
    }
    setTaskStatus(taskId, "running", { plan });
    saveUsage();
  }

  exit("failed", {
    outcome: {
      kind: "failed",
      reason: `planner exceeded ${MAX_STEPS} steps without finishing; last plan: ${(plan.slice(-3).join(" | ") || "none").slice(0, 300)}`,
      evidenceActionIds: succeededRecords(taskId).map((r) => r.actionId),
    } satisfies TaskOutcome,
    error: `planner exceeded ${MAX_STEPS} steps without finishing; last plan: ${(plan.slice(-3).join(" | ") || "none").slice(0, 300)}`,
    plan,
  });
}

/** Continue a paused task after approval/answer. No-op on terminal tasks. */
export async function resumeLoop(taskId: string, note: string, backend?: PlannerBackend): Promise<void> {
  const task = getTask(taskId);
  if (!task || isTerminalStatus(task.status)) return;
  await runPlannerLoop(taskId, { backend, resumeNote: note });
}
