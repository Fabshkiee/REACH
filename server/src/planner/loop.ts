import { BedrockPlannerBackend } from "./bedrock.js";
import { requireBedrockConfig } from "../config.js";
import { proposeAction } from "../executor/executor.js";
import { getActionDef } from "../executor/registry.js";
import { policyContextForAvailable } from "../policy/context.js";
import { defaultPolicyContext } from "../policy/engine.js";
import { getTask, setTaskStatus } from "../tasks/taskStore.js";
import type { HistoryEntry, PlannerBackend } from "./backend.js";
import { toolsForPlanner } from "./tools.js";

const MAX_STEPS = Number(process.env.PLANNER_MAX_STEPS ?? 8);

const SYSTEM = [
  "You are the REACH planner: given a user goal, achieve it by calling the offered tools, one per turn.",
  "Rules:",
  "- Call exactly ONE tool per turn. Never invent tool names — only call tools from the offered set.",
  "- If the target of an action is genuinely ambiguous (which file? which device?), call reach.ask_user instead of guessing.",
  "- Some actions pause for user approval; you will be told when that happens. Continue after approval arrives.",
  "- When the goal is achieved, reply with plain text only (no tool call): a one-paragraph summary of what was done and where results live.",
  "- If the goal cannot be achieved with the offered tools, reply with plain text only, starting with CANNOT: followed by the reason.",
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

/**
 * Run (or resume) the ReAct loop for a task. Entry points:
 * - fresh goals via execute_on_my_devices,
 * - continuations via decide_approval (approval granted) and /tasks/:id/input.
 * Every terminal path sets a terminal task status — the loop never strands tasks.
 */
export async function runPlannerLoop(
  taskId: string,
  opts: { backend?: PlannerBackend; resumeNote?: string } = {},
): Promise<void> {
  const task = getTask(taskId);
  if (!task) return;

  let backend: PlannerBackend;
  try {
    backend = activeBackend(opts.backend);
  } catch (err) {
    setTaskStatus(taskId, "failed", {
      error: err instanceof Error ? err.message : "planner backend unavailable",
    });
    return;
  }

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
  let inTokens = task.usage?.inputTokens ?? 0;
  let outTokens = task.usage?.outputTokens ?? 0;
  let callCount = task.usage?.calls ?? 0;
  const saveUsage = () => setTaskStatus(taskId, getTask(taskId)?.status ?? "running", { usage: { inputTokens: inTokens, outputTokens: outTokens, calls: callCount } });

  setTaskStatus(taskId, "running", { plan });
  const stepBase = plan.length;

  for (let step = 1; step <= MAX_STEPS; step++) {
    let turn;
    try {
      const res = await backend.converse({ system: SYSTEM, history, tools, maxTokens: 2000 });
      turn = res.turn;
      inTokens += res.usage.inputTokens;
      outTokens += res.usage.outputTokens;
      callCount += 1;
    } catch (err) {
      setTaskStatus(taskId, "failed", {
        error: `planner backend failed at step ${stepBase + step}: ${err instanceof Error ? err.message : err}`,
        plan,
      });
      saveUsage();
      return;
    }

    // Text-only turn: the model declares the outcome.
    if (turn.toolCalls.length === 0) {
      const text = turn.text.trim();
      const acted = (getTask(taskId)?.trace?.length ?? 0) > 0;
      if (!acted) {
        // No grounding whatsoever — fail fast with the model's own reason,
        // never a hallucinated success. Preserves v1 fail-fast honesty.
        setTaskStatus(taskId, "failed", {
          error: text ? `planner could not ground the goal: ${text.slice(0, 500)}` : "planner stalled with no actions",
          plan,
        });
      } else {
        setTaskStatus(taskId, "completed", {
          plan,
          evidence: { deviceId: "reach-core", capabilityId: "planner-loop", note: text.slice(0, 500) || "done" },
        });
      }
      saveUsage();
      return;
    }

    // One action per turn; extras are reported, never silently run.
    const [first, ...rest] = turn.toolCalls;
    if (!first) {
      setTaskStatus(taskId, "failed", { error: "planner returned an empty tool call", plan });
      saveUsage();
      return;
    }
    history.push({ role: "assistant", text: turn.text, toolCalls: [first] });
    if (rest.length > 0) {
      plan.push(`step ${stepBase + step}: ignored ${rest.length} extra tool call(s) — one action per turn`);
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
      plan.push(`${label} → paused (awaiting user)`);
      setTaskStatus(taskId, getTask(taskId)?.status ?? task.status, { plan });
      saveUsage();
      return; // resumeLoop continues after approval/answer
    } else {
      plan.push(`${label} → FAILED: ${(proposed.error ?? "").slice(0, 200)}`);
      history.push({
        role: "user",
        toolResults: [{ toolCallId: first.id, content: `FAILED: ${proposed.error ?? "unknown error"}. Adjust the plan or finish with a CANNOT summary.` }],
      });
    }
    setTaskStatus(taskId, "running", { plan });
    saveUsage();
  }

  setTaskStatus(taskId, "failed", {
    error: `planner exceeded ${MAX_STEPS} steps without finishing; last plan: ${(plan.slice(-3).join(" | ") || "none").slice(0, 300)}`,
    plan,
  });
  saveUsage();
}

/** Continue a paused task after approval/answer. No-op on terminal tasks. */
export async function resumeLoop(taskId: string, note: string, backend?: PlannerBackend): Promise<void> {
  const task = getTask(taskId);
  if (!task || task.status === "completed" || task.status === "failed") return;
  setTaskStatus(taskId, "running");
  await runPlannerLoop(taskId, { backend, resumeNote: note });
}
