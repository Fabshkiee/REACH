import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { BedrockPlannerBackend } from "./bedrock.js";
import { requireBedrockConfig } from "../config.js";
import { proposeAction } from "../executor/executor.js";
import { getActionDef } from "../executor/registry.js";
import { policyContextForAvailable } from "../policy/context.js";
import { defaultPolicyContext } from "../policy/engine.js";
import { claimLoopSlot, getTask, isTerminalStatus, releaseLoopSlot, setTaskStatus, appendTaskEvent, listRecentTasks } from "../tasks/taskStore.js";
import { failureFeedback, recoveryHintFor } from "../executor/recovery.js";
import type { ActionRecord, TaskOutcome, TaskStatus } from "../tasks/types.js";
import type { HistoryEntry, PlannerBackend } from "./backend.js";
import { FINISH_TOOL_NAME, MILESTONE_TOOL_NAME, toolsForPlanner, type CheckpointMilestoneArgs, type FinishArgs } from "./tools.js";

const MAX_STEPS = Number(process.env.PLANNER_MAX_STEPS ?? 8);

const SYSTEM = [
  "You are the REACH planner: given a user goal, achieve it by calling the offered tools, one per turn.",
  "Rules:",
  "- Call exactly ONE tool per turn. Never invent tool names — only call tools from the offered set.",
  "- If the user goal is a greeting, conversational opening, or lacks an actionable device task (e.g. 'hi', 'hello', 'how are you', 'help'), call reach.ask_user to greet the user and ask what task they would like you to perform on their connected devices.",
  "- If the target of an action is genuinely ambiguous (which file? which device?), call reach.ask_user instead of guessing.",
  "- For questions, file reading, or summarization goals, include the full substantive answer or summary directly in the 'summary' argument of reach.finish (up to 2000 characters). Do not output just a meta-description like 'done'.",
  "- Some actions pause for user approval; you will be told when that happens. Continue after approval arrives.",
  "- When no more actions are needed, call reach.finish with kind + evidence: complete (cite verified actionIds returned in tool results like 'act_...' or successful tool names like 'files.read'), partial (cite prior evidence + remaining work), cannot (missing capabilities + reason), unverified (reason), or failed (reason). Narration without cited evidence is rejected.",
  "- Plain-text replies with no tool calls are deprecated: every turn must call a tool (an action tool, reach.ask_user, or reach.finish with evidence).",
  "- Failures teach: a FAILED result may carry a Recovery hint naming the next move — use it instead of guessing.",
  "- Recover, then ask, then concede: after a failure, retry with a changed approach (at most 2 autonomous recoveries: different args, narrower scope, or sibling tool). If still stuck or the choice changes the outcome, call reach.ask_user with concrete options. Only then reach.finish cannot, preserving partial evidence.",
  "- When you need a file the user referred to by DESCRIPTION, call files.search first — do not guess its exact path. Search matches by word, so 'the product sync recording' finds 'product-sync-recording.mp3'. A guessed path that misses wastes a turn and a step.",
  "- files.search scores each hit by how many query words it covers; a hit whose score is less than the number of query words is a PARTIAL/noisy match. If no hit covers every query word, treat the file as not present and say so (or ask once to confirm the name) — do not open an unrelated file.",
  "- apps.open_url routes Spotify links to the Spotify app, not the browser. When the user asks to open something 'in Spotify', call apps.open_url with the Spotify link only — do not also call apps.launch.",
  "- Web browsing must use web.* or browser.* tools (never apps.launch of browser names like chrome, msedge, firefox).",
  "- Launching an application: use apps.launch with the app name (and 'path' to open a folder/file in it). It works for any installed app — unknown apps just ask for confirmation first. Never search for an app name as if it were a file. When the user says 'open X with/in/and folder Y', pass path=Y.",
  "- Creating a document: write the FINISHED document — your own structured summary of the source (sections, decisions, action items with owners), never a copy of the source text. Give each section its own '#' heading line and use '- ' for bullets.",
  "- Embedding an image in a document: download it first with web.download_asset (mode 'image' search gives the URL), then embed it INLINE next to the section it illustrates using markdown '![](localPath)' with a caption line. Do not put all images at the end and do not use remote URLs. imagePaths (appended at end) is a fallback only.",

  "- Directories are explored via files.list (names + sizes) and opened with apps.open_document. Never read or verify a directory as a file.",
  "- Web information extraction: When the user asks for information from a web page (e.g. 'tell me the issues', 'what does the page say', 'read the title'): once the relevant text or item titles appear in browser.observe or browser.find snapshots, do not click randomly; extract the answer directly and call reach.finish complete with the substantive summary in the summary argument.",
  "- Browser searching: browser.observe returns the page's text, and the answer is usually ALREADY in that snapshot — read it and answer. Use browser.find at most once, and only with a distinctive TEXT term you can see on the page; never with a structural word like 'listitem', 'heading' or 'link'. If a find returns nothing, do not retry it with another structural term: re-observe, or answer with what you already have.",
  "- In browser.click, 'target' must be the exact snapshot ref identifier (e.g. 'f1e36', 'e4') from browser.observe, never a CSS selector, element name, or empty string.",
  "- Never invent placeholder usernames (such as 'yourusername', 'username', 'example', 'myuser', etc.) in URLs or commands. If the user refers to 'my profile', 'my repo', or 'my account', use the provided gitUser/systemUser environment context — for a site account, prefer gitUser (it is the person's handle; systemUser is the OS login name and usually will not resolve on a public site). If the username is still unknown, call reach.ask_user to ask for their username/profile URL, or use web.search to locate it.",
  "- Two-tier planning: For composite or multi-step goals, break the goal into 2–4 verifiable milestones. Allocate a dedicated 6-step horizon per sub-goal. Call reach.checkpoint_milestone upon completing each milestone before advancing to the next, maintaining verified evidence at each step.",
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

/**
 * The payloads of the actions that already ran, replayed verbatim into the
 * resumed task's context.
 *
 * The trace summary is one line per action, so a resumed task knows THAT
 * something ran but not WHAT it returned. Measured: a task that transcribed
 * a 105-second meeting, paused for approval, and resumed then wrote
 * minutes about "John Doe" and a Q3 launch — none of it in the recording.
 * It had the summary ("transcribed 1595 chars") and nothing else, so it
 * filled the gap with the shape of a meeting rather than the meeting.
 */
function replayedResults(taskId: string): string | undefined {
  const records = (getTask(taskId)?.trace ?? []).filter((r) => r.ok === true && r.resultData);
  if (records.length === 0) return undefined;
  const lines = records.slice(-6).map((r) => `[${r.name}${r.target ? ` on "${r.target}"` : ""}]\n${r.resultData}`);
  return lines.join("\n\n");
}

/**
 * Milliseconds this task spent waiting on external services. That time is
 * the third party's, not the planner's, so it does not count against the
 * task's elapsed budget — a long transcription is work, not a stuck agent.
 */
function externalWaitMs(taskId: string): number {
  return (getTask(taskId)?.trace ?? []).reduce((sum, r) => sum + (r.waitedMs ?? 0), 0);
}

function budgetOf(taskId: string): { maxPlannerCalls: number; maxElapsedMs: number; maxActions: number } {  const task = getTask(taskId);
  return {
    maxPlannerCalls: task?.budget?.maxPlannerCalls ?? 24,
    maxElapsedMs: task?.budget?.maxElapsedMs ?? 10 * 60_000,
    maxActions: task?.budget?.maxActions ?? 40,
  };
}

function asStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string").slice(0, 50) : [];
}

/** Tool results are bounded so one huge page snapshot cannot eat the context. */
const TOOL_RESULT_BUDGET = 8000;

/**
 * Render a tool result within the budget WITHOUT losing its metadata.
 *
 * The old version sliced the serialized JSON. JSON.stringify puts the big
 * field first and the flags last, so the slice ate exactly the fields that
 * matter most — `truncated`, `totalChars`, `pages` — precisely when the
 * result was too big to fit. The model was shown 8,000 characters with no
 * indication that more existed.
 *
 * Now long strings are clipped in place and every non-string field (flags,
 * counts, paths, booleans) survives.
 */
export function clipToolResult(data: unknown, budget = TOOL_RESULT_BUDGET): string {
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
  let max = 4000;
  let text = JSON.stringify(clip(data, max)) ?? String(data);
  while (text.length > budget && max > 200) {
    max = Math.floor(max / 2);
    text = JSON.stringify(clip(data, max)) ?? String(data);
  }
  return text;
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
  const task = getTask(taskId);
  const trace = task?.trace ?? [];

  // Evidence is THIS task's evidence. A previous task's actions are context
  // the model may read, but they are never proof that THIS task did anything:
  // with them allowed, a task that executed nothing could cite them and be
  // marked complete — a success claim with nothing behind it.
  // Index by actionId, by tool name (e.g. files.read), and by sanitized name
  // (files__read). When duplicate tool names exist, prefer the
  // successful/verified one.
  const byKey = new Map<string, ActionRecord>();
  for (const r of trace) {
    byKey.set(r.actionId, r);
    const existing = byKey.get(r.name);
    if (!existing || (!existing.ok && r.ok) || (!existing.verified && r.verified)) {
      byKey.set(r.name, r);
    }
    const sanitized = r.name.replace(/\./g, "__");
    const existingSanitized = byKey.get(sanitized);
    if (!existingSanitized || (!existingSanitized.ok && r.ok) || (!existingSanitized.verified && r.verified)) {
      byKey.set(sanitized, r);
    }
  }

  const rawCited = asStringArray(args.evidenceActionIds);
  const cited: string[] = [];
  const unknown: string[] = [];
  const failedInTrace: string[] = [];
  for (const item of rawCited) {
    const r = byKey.get(item);
    if (!r) {
      const anyMatch = trace.find(
        (x) => x.actionId === item || x.name === item || x.name.replace(/\./g, "__") === item,
      );
      if (anyMatch) {
        failedInTrace.push(item);
      } else {
        unknown.push(item);
      }
    } else if (r.ok !== true) {
      failedInTrace.push(item);
    } else {
      if (!cited.includes(r.actionId)) {
        cited.push(r.actionId);
      }
    }
  }

  // If the model did not explicitly provide valid actionIds but verified actions ran in this task,
  // and no completely unknown fake IDs were passed, auto-attach verified actions.
  if (kind === "complete" && cited.length === 0 && unknown.length === 0) {
    const verified = (task?.trace ?? []).filter((r) => r.ok && r.verified);
    if (verified.length > 0) {
      cited.push(...verified.map((r) => r.actionId));
    }
  }

  const summary = typeof args.summary === "string" ? args.summary.slice(0, 2000) : "";
  const reason = typeof args.reason === "string" ? args.reason.slice(0, 2000) : "";
  const missingCapabilities = asStringArray(args.missingCapabilities);
  const remaining = asStringArray(args.remaining);

  if (kind === "complete") {
    if (unknown.length > 0) {
      return { invalid: `reach.finish complete cites unknown/failed actions: ${unknown.join(", ")}. Cite only successful trace actionIds.` };
    }
    if (cited.length === 0) {
      return { invalid: "reach.finish complete needs evidenceActionIds citing verified trace actions." };
    }
    const unverified = cited.filter((id) => byKey.get(id)?.verified !== true);
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
    if (unknown.length > 0) return { invalid: `reach.finish partial cites unknown/failed actions: ${unknown.join(", ")}.` };
    if (cited.length === 0) return { invalid: "reach.finish partial needs evidenceActionIds for the work that succeeded." };
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
    if (unknown.length > 0) return { invalid: `reach.finish unverified cites unknown/failed actions: ${unknown.join(", ")}.` };
    if (cited.length === 0) return { invalid: "reach.finish unverified needs evidenceActionIds for the unconfirmed work." };
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
  if (unknown.length > 0) return { invalid: `reach.finish ${kind} cites unknown/failed actions: ${unknown.join(", ")}.` };
  const outcome: TaskOutcome = {
    kind,
    reason: reason || summary || (kind === "cannot" ? "goal cannot be achieved with available capabilities" : "task failed"),
    evidenceActionIds: cited,
    ...(kind === "cannot" && missingCapabilities.length > 0 ? { missingCapabilities } : {}),
  };
  return { terminal: { status: "failed", patch: { outcome, error: outcome.reason } } };
}

function localUserContextNote(): string {
  const parts: string[] = [];
  try {
    const gitUser = execSync("git config user.name", { encoding: "utf8", timeout: 2000 }).trim();
    if (gitUser) parts.push(`gitUser="${gitUser}"`);
  } catch {}
  try {
    const sysUser = userInfo().username || process.env.USERNAME || process.env.USER;
    if (sysUser) parts.push(`systemUser="${sysUser}"`);
  } catch {}
  try {
    const home = homedir();
    parts.push(`userHome="${home}"`);
    parts.push(`picturesDir="${join(home, "Pictures")}"`);
    parts.push(`documentsDir="${join(home, "Documents")}"`);
  } catch {}
  return parts.length > 0 ? `[Local environment identity & paths: ${parts.join(", ")}]` : "";
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
  const userEnv = localUserContextNote();
  let history: HistoryEntry[] = [{ role: "user", text: userEnv ? `${task.goal}\n${userEnv}` : task.goal }];
  if (opts.resumeNote) {
    history.push({
      role: "user",
      text: `Context from earlier in this task (audit-trace summary, not verbatim):\n${traceSummary(taskId)}\n${opts.resumeNote}`,
    });
    // The RESULTS of the actions that already ran, verbatim. Without them a
    // resumed task has only one-line summaries: the model loses the file it
    // read, or the transcript it transcribed, and — measured — invents
    // plausible filler instead ("John Doe" in a meeting about nobody).
    const results = replayedResults(taskId);
    if (results) {
      history.push({ role: "user", text: `Results of the actions already run in this task:\n${results}` });
    }
  } else {
    const recentTasks = listRecentTasks(5).filter((t) => t.id !== taskId && t.status === "completed");
    if (recentTasks.length > 0) {
      const last = recentTasks[0];
      const lastMs = Date.parse(last.createdAt);
      if (!isNaN(lastMs) && Date.now() - lastMs < 15 * 60_000) {
        history.push({
          role: "user",
          // Context, NOT permission. A previous task's outcome is background
          // reading; it is never evidence for THIS task, and the model must
          // still perform this task's actions itself. (When this line said
          // "actions that can be cited", a fresh task would cite the previous
          // run's action IDs and finish in one turn having done nothing —
          // a success claim with nothing behind it.)
          text:
            `[Prior completed task context: id=${last.id}, goal="${last.goal}", outcome="${last.outcome?.summary || last.outcome?.reason || "done"}"]\n` +
            `[That was a DIFFERENT task. It is background only. Do the current goal's actions yourself; prior actions are not evidence for this task.]`,
        });
      }
    }
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
  let stepBase = plan.length;

  horizonLoop: while (true) {
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
    if (Date.now() - startedMs - externalWaitMs(taskId) >= budget.maxElapsedMs) {
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

    // Plain-text turns are deprecated: force reach.finish with cited evidence or reach.ask_user.
    if (turn.toolCalls.length === 0) {
      history.push({ role: "assistant", text: turn.text });
      const hint = succeededRecords(taskId).length === 0
        ? "If this is a greeting or request without an actionable device task, call reach.ask_user to ask the user how to help. Otherwise, select an action tool or call reach.finish cannot."
        : "You must call reach.finish with kind ('complete'|'partial'|'cannot'|'unverified'|'failed') and cite evidenceActionIds from verified actions. Put your full substantive answer/summary in the summary argument.";
      history.push({
        role: "user",
        text: `ERROR: Plain-text turns are deprecated. Every turn must call a tool. ${hint}`,
      });
      plan.push(`step ${stepBase + step}: rejected plain-text turn — directed to reach.finish`);
      setTaskStatus(taskId, "running", { plan });
      saveUsage();
      continue;
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

    if (first.name === MILESTONE_TOOL_NAME) {
      const args = first.args as unknown as CheckpointMilestoneArgs;
      const completed = typeof args?.completed === "string" ? args.completed.trim().slice(0, 500) : "";
      const next = typeof args?.next === "string" ? args.next.trim().slice(0, 500) : undefined;
      if (!completed) {
        history.push({
          role: "user",
          toolResults: [{ toolCallId: first.id, content: "ERROR: reach.checkpoint_milestone requires a non-empty 'completed' string." }],
        });
        continue;
      }
      plan.push(`step ${stepBase + step}: milestone "${completed}"${next ? ` (next: ${next})` : ""}`);
      appendTaskEvent(taskId, {
        kind: "milestone_completed",
        capabilityId: "planner-loop",
        status: "succeeded",
        summary: `Milestone: ${completed}`,
      });
      history.push({
        role: "user",
        toolResults: [
          {
            toolCallId: first.id,
            content: `OK: milestone recorded: "${completed}". ${next ? `Proceed with next sub-goal: ${next}` : "Proceed towards finishing the goal."}`,
          },
        ],
      });
      consecutiveFailures = 0;
      setTaskStatus(taskId, "running", { plan });
      saveUsage();
      continue;
    }

    if (first.name === "apps.launch") {
      const appName = String((first.args as { app?: unknown })?.app ?? "").trim().toLowerCase();
      const cleanApp = appName.replace(/\.exe$/i, "");
      const BROWSER_NAMES = new Set(["chrome", "msedge", "edge", "firefox", "brave", "opera", "safari", "browser"]);
      if (BROWSER_NAMES.has(appName) || BROWSER_NAMES.has(cleanApp)) {
        history.push({
          role: "user",
          toolResults: [{
            toolCallId: first.id,
            content: `ERROR: apps.launch cannot be used to launch web browsers (e.g. chrome, msedge, firefox). Web browsing must use web.* or browser.* tools.`,
          }],
        });
        plan.push(`step ${stepBase + step}: rejected apps.launch for browser "${appName}"`);
        setTaskStatus(taskId, "running", { plan });
        saveUsage();
        continue;
      }
      // The known-safe app set comes from the DEVICE advertisement, not from a
      // second hardcoded list here (that copy drifted and rejected apps the
      // machine could run). Unknown binaries are the policy's call.
      const knownApps = new Set((policyCtx.knownApps ?? []).map((a) => a.toLowerCase()));
      if (knownApps.size > 0 && !knownApps.has(appName) && !knownApps.has(cleanApp)) {
        history.push({
          role: "user",
          toolResults: [{
            toolCallId: first.id,
            content: `ERROR: apps.launch is restricted to the apps this device advertises: [${[...knownApps].join(", ")}]. "${appName}" is not permitted.`,
          }],
        });
        plan.push(`step ${stepBase + step}: rejected apps.launch for unknown utility "${appName}"`);
        setTaskStatus(taskId, "running", { plan });
        saveUsage();
        continue;
      }
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
            content: `OK [actionId: ${proposed.actionId}]: ${clipToolResult(proposed.data)}${proposed.verified === false ? " (UNVERIFIED)" : " (verified)"}`,
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

  // Step horizon reached (all MAX_STEPS turns exhausted).
  // If cumulative budget remains, auto-continue by re-seeding with compact trace summary.
  const budgetRemaining =
    callCount < budget.maxPlannerCalls &&
    (Date.now() - startedMs) < budget.maxElapsedMs &&
    (getTask(taskId)?.trace?.length ?? 0) < budget.maxActions;

  if (budgetRemaining) {
    const verified = verifiedRecords(taskId);
    const compactTrace = verified.length > 0
      ? verified.map((r) => `- [${r.actionId}] ${r.name}${r.target ? ` on "${r.target}"` : ""}: ${(r.resultSummary ?? "ok").slice(0, 150)}`).join("\n")
      : "(no verified actions yet)";

    history = [
      { role: "user", text: task.goal },
      { role: "assistant", text: `Step horizon checkpoint: completed ${MAX_STEPS} turns. Verified progress so far:\n${compactTrace}` },
      { role: "user", text: `Budget checkpoint: ${MAX_STEPS} turns completed. Verified progress so far:\n${compactTrace}\nContinue executing towards final goal or call reach.finish.` },
    ];
    plan.push(`step horizon reached (${MAX_STEPS} turns) — auto-continuing with verified trace summary`);
    appendTaskEvent(taskId, {
      kind: "action_finished",
      capabilityId: "planner-loop",
      status: "succeeded",
      summary: `Step horizon reached (${MAX_STEPS} steps); auto-continuing`,
    });
    setTaskStatus(taskId, "running", { plan });
    saveUsage();
    stepBase = plan.length;
    continue horizonLoop;
  }

  break horizonLoop;
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
