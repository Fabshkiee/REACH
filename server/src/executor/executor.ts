import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createApproval, getApproval } from "../approvals/store.js";
import { classify, defaultPolicyContext } from "../policy/engine.js";
import { parseProposedAction, type ProposedAction } from "../policy/types.js";
import { dataDir } from "../store/jsonFile.js";
import { appendActionRecord, appendTaskEvent, getTask, setTaskStatus } from "../tasks/taskStore.js";
import type { ActionRecord, AskedQuestion } from "../tasks/types.js";
import { getActionDef, type ActionDefinition } from "./registry.js";
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

function bound(s: string, max = 300): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function audit(taskId: string, record: ActionRecord): void {
  appendActionRecord(taskId, record);
  // User-visible trail: one event per audited record, derived in one place so
  // no executor path can act without appearing in the sim timeline.
  const what = `${record.name}${record.target ? ` on "${bound(record.target, 120)}"` : ""}`;
  if (record.actionClass === "ask" && record.ok === true) {
    appendTaskEvent(taskId, {
      kind: "clarification_requested",
      actionId: record.actionId,
      capabilityId: record.name,
      status: "awaiting_input",
      summary: bound(`Question asked: ${(record.resultSummary ?? "").replace(/^asked: /, "")}`, 300),
    });
  } else if (record.approvalId && (record.resultSummary ?? "").startsWith("paused for approval")) {
    appendTaskEvent(taskId, {
      kind: "approval_requested",
      actionId: record.actionId,
      capabilityId: record.name,
      target: record.target,
      status: "awaiting_approval",
      summary: bound(`Approval needed: ${(record.resultSummary ?? "").replace(/^paused for approval \S+: /, "")}`, 300),
    });
  } else if (record.ok === false) {
    appendTaskEvent(taskId, {
      kind: "action_finished",
      actionId: record.actionId,
      capabilityId: record.name,
      target: record.target,
      status: "failed",
      summary: bound(`Failed: ${what} — ${record.resultSummary ?? record.policyReason}`, 300),
    });
  } else {
    appendTaskEvent(taskId, {
      kind: "action_finished",
      actionId: record.actionId,
      capabilityId: record.name,
      target: record.target,
      status: record.verified === false ? "unverified" : "succeeded",
      summary: bound(
        `${what} ok${record.verified === false ? " (unverified)" : " (verified)"}${record.resultSummary ? `: ${record.resultSummary}` : ""}`,
        300,
      ),
      evidenceActionIds: [record.actionId],
    });
  }
  try {
    appendFileSync(join(dataDir(), "audit.jsonl"), JSON.stringify({ taskId, ...record }) + "\n");
  } catch (err) {
    console.error(`[executor] audit log failed: ${err instanceof Error ? err.message : err}`);
  }
}

/** Longest single argument kept in the audit trail (the body of a document
 *  can be 20k characters; the trace stays readable and the file stays small). */
const MAX_TRACE_ARG_CHARS = 600;

function traceArgs(action: ProposedAction): Record<string, unknown> | undefined {
  if (!action.args || typeof action.args !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(action.args)) {
    if (typeof v === "string") {
      out[k] = v.length > MAX_TRACE_ARG_CHARS ? `${v.slice(0, MAX_TRACE_ARG_CHARS)} …[${v.length} chars]` : v;
    } else if (v === undefined) {
      continue;
    } else {
      out[k] = v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function baseRecord(action: ProposedAction, verdict: ActionRecord["policyVerdict"], reason: string): ActionRecord {
  const args = traceArgs(action);
  return {
    actionId: action.id,
    actionClass: action.actionClass,
    name: action.name,
    target: action.target,
    ...(args ? { args } : {}),
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

export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function questionNamesAnswer(normQuestion: string, answer: string): boolean {
  const normAns = normalizeQuestion(answer);
  if (!normAns || normAns.length < 2) return false;
  const escaped = normAns.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const re = new RegExp(`\\b${escaped}\\b`, "i");
  return re.test(normQuestion);
}

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
  opts: { softFail?: boolean; preApproved?: string } = {},
): Promise<ProposeResult> {
  const task = getTask(taskId);
  if (!task) return { outcome: "rejected", taskId, error: `unknown task ${taskId}` };
  // Never act on ended tasks: approvals resolve through the approval-decision
  // path (which peeks at task state first) and the loop never proposes after
  // terminal — this is the backstop so a stray proposal cannot resurrect
  // completed/failed/cancelled work.
  if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
    return { outcome: "rejected", taskId, error: `task is already ${task.status} — no further actions` };
  }
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
      const priorQuestions = (task.askedQuestions ?? []) as Array<string | AskedQuestion>;
      const qCount = Math.max(priorQuestions.length, (task as { questionCount?: number }).questionCount ?? 0);

      // Hard cap: 3 questions per task
      if (qCount >= 3) {
        const errMsg = "ERROR: Question budget exhausted (3/3 questions already asked for this task). Cap limit exceeded: you must proceed with available tools or call reach.finish.";
        const record = baseRecord(action, "deny", "deny.ask-budget-exhausted");
        record.endedAt = new Date().toISOString();
        record.ok = false;
        record.resultSummary = errMsg;
        audit(taskId, record);
        fail({ error: errMsg });
        return { outcome: "rejected", taskId, actionId: action.id, error: errMsg };
      }

      // Duplicate detection & naming prior answer
      const normQ = normalizeQuestion(question);
      for (const prior of priorQuestions) {
        const priorQ = typeof prior === "string" ? prior : prior.question;
        const priorNorm = typeof prior === "string" ? normalizeQuestion(prior) : (prior.normalized || normalizeQuestion(prior.question));
        const priorAns = typeof prior === "string" ? undefined : prior.answer;

        const isDuplicate = normQ === priorNorm ||
          (normQ.length >= 15 && priorNorm.length >= 15 && (normQ.includes(priorNorm) || priorNorm.includes(normQ)));

        if (isDuplicate) {
          const errMsg = priorAns
            ? `ERROR: Duplicate question already asked: "${priorQ}". The user already answered: "${priorAns}". Act on this prior answer instead of repeating questions.`
            : `ERROR: Duplicate question already asked: "${priorQ}". Await or act on available information instead of repeating questions.`;
          const record = baseRecord(action, "deny", "deny.duplicate-question");
          record.endedAt = new Date().toISOString();
          record.ok = false;
          record.resultSummary = errMsg;
          audit(taskId, record);
          fail({ error: errMsg });
          return { outcome: "rejected", taskId, actionId: action.id, error: errMsg };
        }

        if (priorAns && questionNamesAnswer(normQ, priorAns)) {
          const errMsg = `ERROR: Question already answered: "${priorQ}" was answered with "${priorAns}". Act on this prior answer instead of asking again.`;
          const record = baseRecord(action, "deny", "deny.repeat-answered-question");
          record.endedAt = new Date().toISOString();
          record.ok = false;
          record.resultSummary = errMsg;
          audit(taskId, record);
          fail({ error: errMsg });
          return { outcome: "rejected", taskId, actionId: action.id, error: errMsg };
        }
      }

      // Check external priorAnswers array on task state
      const priorAnswersList = (task as { priorAnswers?: string[] }).priorAnswers;
      if (Array.isArray(priorAnswersList)) {
        for (const ans of priorAnswersList) {
          if (ans && questionNamesAnswer(normQ, ans)) {
            const errMsg = `ERROR: Question references already answered choice: "${ans}". Act on this prior answer instead of asking again.`;
            const record = baseRecord(action, "deny", "deny.repeat-answered-question");
            record.endedAt = new Date().toISOString();
            record.ok = false;
            record.resultSummary = errMsg;
            audit(taskId, record);
            fail({ error: errMsg });
            return { outcome: "rejected", taskId, actionId: action.id, error: errMsg };
          }
        }
      }

      const record = baseRecord(action, "allow", "allow.ask-user");
      record.endedAt = new Date().toISOString();
      record.ok = true;
      record.resultSummary = `asked: ${question.slice(0, 120)}`;
      audit(taskId, record);
      const askedQuestions: AskedQuestion[] = [
        ...priorQuestions.map((q) =>
          typeof q === "string"
            ? { question: q, normalized: normalizeQuestion(q), askedAt: new Date().toISOString() }
            : q
        ),
        {
          question,
          normalized: normQ,
          options,
          askedAt: new Date().toISOString(),
        },
      ];
      setTaskStatus(taskId, "awaiting_input", {
        pendingInput: { taskId, question, options, createdAt: new Date().toISOString(), questionCount: askedQuestions.length },
        askedQuestions,
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
    // Pre-approved (user already said yes to exactly this action): run it now
    // instead of pausing again — otherwise every approval loops back into a
    // fresh confirmation. Denials still stand: approval never overrides deny.
    if (opts.preApproved) {
      const record = baseRecord(action, "confirm", decision.reason);
      record.approvalId = opts.preApproved;
      record.resultSummary = `user-approved ${opts.preApproved}: proceeding`;
      audit(taskId, record);
      return runAllowed(taskId, action, args, def, policyCtx, record, (patch) => fail(patch));
    }
    // Single live pause per task: a second confirm-class proposal while an
    // approval is still pending is denied, never silently overwrites the
    // pending approval (which would orphan a resolvable approval id).
    const livePause = task.status === "awaiting_approval" && task.pendingApproval
      ? getApproval(task.pendingApproval.id)
      : undefined;
    if (livePause?.status === "pending") {
      const record = baseRecord(action, "confirm", "confirm.superseded");
      record.endedAt = new Date().toISOString();
      record.ok = false;
      record.resultSummary = `policy would confirm, but approval ${livePause.id} (${livePause.actionName}) is still pending — resolve it first`;
      audit(taskId, record);
      fail({ error: record.resultSummary });
      return { outcome: "denied", taskId, actionId: action.id, error: record.resultSummary };
    }
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
  return runAllowed(taskId, action, args, def, policyCtx, record, (patch) => fail(patch));
}

async function runAllowed(
  taskId: string,
  action: ProposedAction,
  args: Record<string, unknown>,
  def: ActionDefinition,
  policyCtx: PolicyContext,
  record: ActionRecord,
  fail: (patch: { error: string }) => void,
): Promise<ProposeResult> {
  const ctrl = new AbortController();
  const timeout = Math.min(action.timeoutMs, def.timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // NOTE: intentionally NOT unref'd. An unref'd timer lets the event loop drain
  // while a hung handler is still pending — the timeout then never fires and the
  // task hangs forever (verified 2026-09-24: executor suite aborted mid-file on
  // Windows/tsx with "event loop has already resolved"). The timer is always
  // cleared when the race settles, so it never holds the process open past that.
  const timeoutGate = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new Error(`timed out after ${timeout}ms`));
    }, timeout);
  });
  try {
    const startedMs = Date.now();
    const data = await Promise.race([
      def.handler(args, { taskId, actionId: action.id, policyCtx, signal: ctrl.signal }),
      timeoutGate,
    ]);
    clearTimeout(timer);
    // Time spent waiting on a third party is not the agent's own elapsed time.
    if (def.externalWait) record.waitedMs = Date.now() - startedMs;
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
    // Keep the payload (clipped) so a task that pauses and resumes can
    // still see WHAT the earlier action returned.
    record.resultData = clipResultData(data);
    audit(taskId, record);
    return { outcome: "ran", taskId, actionId: action.id, data, verified };
  } catch (err) {
    clearTimeout(timer);
    // The wait happened either way — record it even on failure, so the
    // task's budget is not charged for a third party's clock twice.
    if (def.externalWait && !record.waitedMs) {
      record.waitedMs = Date.now() - Date.parse(record.startedAt);
    }
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

/**
 * The payload kept in the trace for a resumed task. Long strings are clipped
 * in place so the flags at the end of the payload survive — a plain slice of
 * the serialised JSON eats exactly the fields that say the result was
 * truncated.
 */
export const MAX_TRACE_RESULT_CHARS = 4000;

function clipResultData(data: unknown, budget = MAX_TRACE_RESULT_CHARS): string | undefined {
  const clip = (v: unknown, max: number): unknown => {
    if (typeof v === "string") return v.length > max ? `${v.slice(0, max)} …[clipped]` : v;
    if (Array.isArray(v)) return v.map((x) => clip(x, max));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = clip(x, max);
      return out;
    }
    return v;
  };
  try {
    let max = Math.floor(budget / 2);
    let text = JSON.stringify(clip(data, max)) ?? String(data);
    while (text.length > budget && max > 200) {
      max = Math.floor(max / 2);
      text = JSON.stringify(clip(data, max)) ?? String(data);
    }
    return text;
  } catch {
    return undefined;
  }
}
