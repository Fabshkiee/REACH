import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createApproval } from "../approvals/store.js";
import { classify, defaultPolicyContext } from "../policy/engine.js";
import { parseProposedAction, type ProposedAction } from "../policy/types.js";
import { dataDir } from "../store/jsonFile.js";
import { appendActionRecord, getTask, setTaskStatus } from "../tasks/taskStore.js";
import type { ActionRecord } from "../tasks/types.js";
import { getActionDef } from "./registry.js";
import type { PolicyContext } from "../policy/types.js";

export type ProposeOutcome = "ran" | "paused" | "denied" | "rejected";

export interface ProposeResult {
  outcome: ProposeOutcome;
  taskId: string;
  actionId?: string;
  approvalId?: string;
  data?: unknown;
  verified?: boolean;
  error?: string;
}

function audit(taskId: string, record: ActionRecord): void {
  appendActionRecord(taskId, record);
  try {
    appendFileSync(join(dataDir(), "audit.jsonl"), JSON.stringify({ taskId, ...record }) + "\n");
  } catch (err) {
    console.error(`[executor] audit log failed: ${err instanceof Error ? err.message : err}`);
  }
}

function baseRecord(action: ProposedAction, verdict: ActionRecord["policyVerdict"], reason: string): ActionRecord {
  return {
    actionId: action.id,
    actionClass: action.actionClass,
    name: action.name,
    target: action.target,
    policyVerdict: verdict,
    policyReason: reason,
    startedAt: new Date().toISOString(),
  };
}

const AskSchema = {
  parse(raw: unknown): { question: string; options?: string[] } {
    const r = raw as { question?: unknown; options?: unknown };
    if (typeof r.question !== "string" || !r.question.trim() || r.question.length > 2000) {
      throw new Error("ask_user needs {question} (1–2000 chars)");
    }
    if (r.options !== undefined && (!Array.isArray(r.options) || !r.options.every((o) => typeof o === "string"))) {
      throw new Error("ask_user options must be string[]");
    }
    return { question: r.question.trim(), options: r.options as string[] | undefined };
  },
};

/**
 * Propose one action for a task: validate → policy → run / pause / fail.
 * Handler-agnostic: real primitives register in A2; A1 proves the loop with
 * injected scripted handlers. The task stays `running` after an allowed run —
 * completion is the planner's call (A3), not the executor's.
 */
export async function proposeAction(
  taskId: string,
  raw: unknown,
  policyCtx: PolicyContext = defaultPolicyContext(),
  opts: { softFail?: boolean } = {},
): Promise<ProposeResult> {
  const task = getTask(taskId);
  if (!task) return { outcome: "rejected", taskId, error: `unknown task ${taskId}` };
  // Soft failures (planner-driven): audit everything but leave the task alone —
  // the loop decides recovery. Hard failures (standalone/scripted use) fail fast.
  const fail = (patch: { error: string }): void => {
    if (!opts.softFail) setTaskStatus(taskId, "failed", patch);
  };

  let action: ProposedAction;
  try {
    action = parseProposedAction(`act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, raw);
  } catch (err) {
    const record = baseRecord(
      { id: "unparsed", actionClass: "observe", name: String((raw as { name?: unknown })?.name ?? "?"), args: {}, timeoutMs: 0 },
      "deny",
      "deny.malformed-action",
    );
    record.endedAt = new Date().toISOString();
    record.ok = false;
    record.resultSummary = err instanceof Error ? err.message : "malformed action";
    audit(taskId, record);
    fail({ error: `malformed action: ${record.resultSummary}` });
    return { outcome: "rejected", taskId, error: record.resultSummary };
  }

  // ask_user is framework-level: no registry entry, pauses for user text.
  if (action.actionClass === "ask") {
    try {
      const { question, options } = AskSchema.parse(action.args);
      const record = baseRecord(action, "allow", "allow.ask-user");
      record.endedAt = new Date().toISOString();
      record.ok = true;
      record.resultSummary = `asked: ${question.slice(0, 120)}`;
      audit(taskId, record);
      setTaskStatus(taskId, "awaiting_input", {
        pendingInput: { taskId, question, options, createdAt: new Date().toISOString() },
      });
      return { outcome: "paused", taskId, actionId: action.id };
    } catch (err) {
      fail({ error: err instanceof Error ? err.message : "bad ask_user" });
      return { outcome: "rejected", taskId, actionId: action.id, error: err instanceof Error ? err.message : "bad ask_user" };
    }
  }

  const def = getActionDef(action.name);
  if (!def) {
    const record = baseRecord(action, "deny", "deny.unknown-action");
    record.endedAt = new Date().toISOString();
    record.ok = false;
    record.resultSummary = `no registered capability named "${action.name}"`;
    audit(taskId, record);
    fail({ error: record.resultSummary });
    return { outcome: "rejected", taskId, actionId: action.id, error: record.resultSummary };
  }
  if (def.actionClass !== action.actionClass) {
    const record = baseRecord(action, "deny", "deny.class-mismatch");
    record.endedAt = new Date().toISOString();
    record.ok = false;
    record.resultSummary = `"${action.name}" is class ${def.actionClass}, proposed as ${action.actionClass}`;
    audit(taskId, record);
    fail({ error: record.resultSummary });
    return { outcome: "rejected", taskId, actionId: action.id, error: record.resultSummary };
  }

  let args: Record<string, unknown>;
  try {
    args = def.schema.parse(action.args) as Record<string, unknown>;
  } catch (err) {
    const record = baseRecord(action, "deny", "deny.bad-args");
    record.endedAt = new Date().toISOString();
    record.ok = false;
    record.resultSummary = err instanceof Error ? err.message.slice(0, 300) : "argument validation failed";
    audit(taskId, record);
    fail({ error: `invalid args for ${action.name}: ${record.resultSummary}` });
    return { outcome: "rejected", taskId, actionId: action.id, error: record.resultSummary };
  }

  const decision = classify({ ...action, args }, policyCtx);
  if (decision.verdict === "deny") {
    const record = baseRecord(action, "deny", decision.reason);
    record.endedAt = new Date().toISOString();
    record.ok = false;
    record.resultSummary = decision.message;
    audit(taskId, record);
    fail({ error: decision.message });
    return { outcome: "denied", taskId, actionId: action.id, error: decision.message };
  }

  if (decision.verdict === "confirm") {
    const approval = createApproval({
      taskId,
      actionName: action.name,
      actionClass: action.actionClass,
      target: action.target,
      consequence: decision.message,
      args,
    });
    const record = baseRecord(action, "confirm", decision.reason);
    record.endedAt = new Date().toISOString();
    record.ok = true;
    record.approvalId = approval.id;
    record.resultSummary = `paused for approval ${approval.id}: ${decision.message}`;
    audit(taskId, record);
    setTaskStatus(taskId, "awaiting_approval", {
      pendingApproval: {
        id: approval.id,
        taskId,
        actionName: action.name,
        actionClass: action.actionClass,
        target: action.target,
        consequence: decision.message,
        args,
        createdAt: approval.createdAt,
        expiresAt: approval.expiresAt,
      },
    });
    return { outcome: "paused", taskId, actionId: action.id, approvalId: approval.id };
  }

  // Allowed: run with timeout, verify, audit.
  setTaskStatus(taskId, "running");
  const record = baseRecord(action, "allow", decision.reason);
  const ctrl = new AbortController();
  const timeout = Math.min(action.timeoutMs, def.timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutGate = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new Error(`timed out after ${timeout}ms`));
    }, timeout);
    timer.unref?.();
  });
  try {
    const data = await Promise.race([
      def.handler(args, { taskId, actionId: action.id, policyCtx, signal: ctrl.signal }),
      timeoutGate,
    ]);
    clearTimeout(timer);
    let verified = true;
    let summary = truncate(data);
    if (def.verify) {
      try {
        const v = def.verify(data);
        if (v === false) throw new Error("verification returned false");
        summary = typeof v === "string" ? v : summary;
      } catch (err) {
        record.endedAt = new Date().toISOString();
        record.ok = false;
        record.verified = false;
        record.resultSummary = `verification failed: ${err instanceof Error ? err.message : err}`;
        audit(taskId, record);
        fail({ error: record.resultSummary });
        return { outcome: "denied", taskId, actionId: action.id, error: record.resultSummary };
      }
    }
    record.endedAt = new Date().toISOString();
    record.ok = true;
    record.verified = verified;
    record.resultSummary = summary;
    audit(taskId, record);
    return { outcome: "ran", taskId, actionId: action.id, data, verified };
  } catch (err) {
    clearTimeout(timer);
    const timedOut = err instanceof Error && err.message.startsWith("timed out after");
    record.endedAt = new Date().toISOString();
    record.ok = false;
    record.resultSummary = timedOut
      ? err.message
      : err instanceof Error
        ? err.message
        : "handler threw";
    audit(taskId, record);
    fail({ error: `${action.name} failed: ${record.resultSummary}` });
    return { outcome: "denied", taskId, actionId: action.id, error: record.resultSummary };
  }
}

function truncate(data: unknown, max = 500): string {
  try {
    const s = typeof data === "string" ? data : JSON.stringify(data);
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch {
    return String(data).slice(0, max);
  }
}
