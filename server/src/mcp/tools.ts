import { z } from "zod";
import { getApproval, resolveApproval } from "../approvals/store.js";
import { proposeAction } from "../executor/executor.js";
import { defaultPolicyContext } from "../policy/engine.js";
import type { ActionClass } from "../policy/types.js";
import { resumeLoop, runPlannerLoop } from "../planner/loop.js";
import { createTask, getTask, listRecentTasks, setTaskStatus } from "../tasks/taskStore.js";

const MEANINGLESS = /^(undefined|null|nan|none|n\/a)$/i;

export const ExecuteOnMyDevicesSchema = z.object({
  task: z
    .string()
    .trim()
    .min(3)
    .max(2000)
    .refine((t) => !MEANINGLESS.test(t), { message: "task must be a real goal, not a placeholder" })
    .describe("Natural-language user goal, e.g. create a homework document on my laptop."),
});

export const GetTaskStatusSchema = z.object({
  taskId: z.string().min(1),
});

export type ExecuteOnMyDevicesInput = z.infer<typeof ExecuteOnMyDevicesSchema>;
export type GetTaskStatusInput = z.infer<typeof GetTaskStatusSchema>;

export const DecideApprovalSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(["approve", "deny"]),
});

export type DecideApprovalInput = z.infer<typeof DecideApprovalSchema>;

/**
 * Accept a goal, persist it as queued, and start the planner loop in the
 * background. EVERY goal — no exceptions, no special cases — goes through the
 * same observe-plan-act-verify engine.
 * ALWAYS returns a taskId immediately (<500ms) — never blocks on device work.
 */
export function executeOnMyDevices(input: ExecuteOnMyDevicesInput): { taskId: string } {
  const parsed = ExecuteOnMyDevicesSchema.parse(input);
  const task = createTask(parsed.task);
  void runPlannerLoop(task.id).catch((err) => {
    setTaskStatus(task.id, "failed", {
      error: `planner crashed: ${err instanceof Error ? err.message : err}`,
    });
  });
  return { taskId: task.id };
}

export function getTaskStatus(input: GetTaskStatusInput) {
  const parsed = GetTaskStatusSchema.parse(input);
  const task = getTask(parsed.taskId);
  if (!task) return { status: "failed" as const, error: `unknown task ${parsed.taskId}` };
  // Lazy expiry: an approval that died while paused fails the task with the
  // reason inline — otherwise clients would poll a dead pause forever.
  if (task.status === "awaiting_approval") {
    const expired = !task.pendingApproval || Date.parse(task.pendingApproval.expiresAt) <= Date.now();
    if (expired) {
      setTaskStatus(parsed.taskId, "failed", {
        pendingApproval: undefined,
        error: "approval expired before a decision — resend the goal to try again",
      });
      return { status: "failed" as const, error: "approval expired before a decision — resend the goal to try again" };
    }
  }
  const out: Record<string, unknown> = { status: task.status, id: task.id };
  if (task.plan) out.plan = task.plan;
  if (task.trace) out.trace = task.trace;
  if (task.usage) out.usage = task.usage;
  if (task.evidence) out.evidence = task.evidence;
  if (task.error) out.error = task.error;
  if (task.status === "awaiting_approval" && task.pendingApproval) {
    out.pendingApproval = {
      id: task.pendingApproval.id,
      actionName: task.pendingApproval.actionName,
      actionClass: task.pendingApproval.actionClass,
      target: task.pendingApproval.target,
      consequence: task.pendingApproval.consequence,
      expiresAt: task.pendingApproval.expiresAt,
    };
  }
  if (task.status === "awaiting_input" && task.pendingInput) {
    out.pendingInput = {
      question: task.pendingInput.question,
      options: task.pendingInput.options,
    };
  }
  return out;
}

/**
 * Resolve one approval. Single-use by construction: unknown, expired, or
 * already-resolved IDs fail closed. Approving unblocks the task back to
 * `running` (the executor/planner resumes it); denying fails the task with
 * the quoted action. `decidedBy` records the trusted channel — the planner
 * can never be the decider (no code path accepts planner identity here).
 */
export async function decideApproval(input: DecideApprovalInput, decidedBy: string) {
  const parsed = DecideApprovalSchema.parse(input);
  const resolved = resolveApproval(parsed.approvalId, parsed.decision, decidedBy);
  if (!resolved) {
    return { ok: false as const, error: `approval ${parsed.approvalId} is unknown, expired, or already resolved` };
  }
  if (parsed.decision === "approve") {
    // Approval means EXECUTE, not "ask me again": run the approved action now
    // through the executor (which still enforces schema + deny rules), then
    // resume the loop with the outcome. The old flow re-proposed and re-paused.
    let execNote: string;
    try {
      const exec = await proposeAction(
        resolved.taskId,
        {
          actionClass: resolved.actionClass as ActionClass,
          name: resolved.actionName,
          args: resolved.args,
          target: resolved.target,
          timeoutMs: 60_000,
        },
        defaultPolicyContext(),
        { preApproved: resolved.id },
      );
      execNote =
        exec.outcome === "ran"
          ? `Approved action ${resolved.actionName} executed and verified.`
          : `Approved action ${resolved.actionName} did not complete: ${exec.error ?? exec.outcome}.`;
    } catch (err) {
      execNote = `Approved action ${resolved.actionName} crashed on execution: ${err instanceof Error ? err.message : err}.`;
      setTaskStatus(resolved.taskId, "failed", { pendingApproval: undefined, error: execNote });
      return { ok: true as const, taskId: resolved.taskId, resumed: false };
    }
    setTaskStatus(resolved.taskId, "running", { pendingApproval: undefined });
    void resumeLoop(resolved.taskId, execNote).catch((err) => {
      setTaskStatus(resolved.taskId, "failed", {
        error: `planner resume crashed: ${err instanceof Error ? err.message : err}`,
      });
    });
    return { ok: true as const, taskId: resolved.taskId, resumed: true };
  }
  setTaskStatus(resolved.taskId, "failed", {
    pendingApproval: undefined,
    error: `denied by user: ${resolved.actionName}${resolved.target ? ` on "${resolved.target}"` : ""} was not approved`,
  });
  return { ok: true as const, taskId: resolved.taskId, resumed: false };
}

/** Look up a pending approval without resolving it (for status displays). */
export function peekApproval(approvalId: string) {
  const apr = getApproval(approvalId);
  if (!apr || apr.status !== "pending") return undefined;
  return {
    id: apr.id,
    taskId: apr.taskId,
    actionName: apr.actionName,
    actionClass: apr.actionClass,
    target: apr.target,
    consequence: apr.consequence,
    expiresAt: apr.expiresAt,
  };
}

export function listTasks(limit?: number) {
  return listRecentTasks(limit).map((t) => ({
    id: t.id,
    goal: t.goal,
    status: t.status,
    updatedAt: t.updatedAt,
  }));
}
