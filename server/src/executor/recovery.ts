/**
 * Teaching errors: generic recovery hints derived from failure SHAPE, never
 * goal text. The table maps error patterns (plus action class) to the next
 * move — so the planner reasons from the error instead of guessing. Nothing
 * here names goals, sites, or examples; it applies to every future task.
 */

const HINTS: Array<{ code: string; when: (actionClass: string, error: string) => boolean; hint: string }> = [
  {
    code: "too_large",
    when: (_cls, err) => /too large/i.test(err),
    hint: "The target exceeds one-shot reading. Retry files.read with offsetChars+maxBytes to page through it (totalChars reports length), or files.list to check sizes first.",
  },
  {
    code: "is_directory",
    when: (_cls, err) => /not a file[\s\S]*director|is a directory/i.test(err),
    hint: "The path is a directory, not a file. Use files.list on it instead of file operations.",
  },
  {
    code: "is_file",
    when: (_cls, err) => /not a directory[\s\S]*is a file/i.test(err),
    hint: "The path is a file, not a directory. Use files.read or files.verify on it instead.",
  },
  {
    code: "not_found",
    when: (_cls, err) => /no such (file|directory)|unknown task|not recognized as a valid file/i.test(err),
    hint: "Re-check the exact path with files.search or files.list; do not guess variants more than once, then ask or finish cannot.",
  },
  {
    code: "bad_args",
    when: (_cls, err) => /invalid args|bad-args|malformed action|validation failed/i.test(err),
    hint: "Fix the arguments against the tool schema (types, enums, required fields) and retry once; repeated schema failures mean re-resolve the target or ask.",
  },
  {
    code: "timeout",
    when: (_cls, err) => /timed out after/i.test(err),
    hint: "A timeout never proves the action did not happen. Inspect current state (files.verify / browser.observe) before any retry.",
  },
  {
    code: "page_rejected",
    when: (cls, err) =>
      (cls === "interact" || err.includes("browser.")) &&
      /reported an error|returned empty content|stale|not found|not visible|detached/i.test(err),
    hint: "The page rejected the interaction (stale ref or changed page). Re-observe for fresh refs before acting again; never replay the same ref.",
  },
  {
    code: "device_offline",
    when: (_cls, err) => /no capable device online|not reachable|offline|agent call timed out|ECONNREFUSED/i.test(err),
    hint: "No device can run this. Do not retry blindly — ask the user to bring the device online, or finish cannot naming the missing capability.",
  },
  {
    code: "no_capability",
    when: (_cls, err) => /no registered capability|not allowed: .*capability|not_implemented/i.test(err),
    hint: "That capability does not exist here. Finish cannot naming it; never invent a replacement tool.",
  },
  {
    code: "denied",
    when: (_cls, err) => /denied|refus|blocked|escapes|outside user-owned space/i.test(err),
    hint: "Policy refused this. Do not rephrase the same action to dodge the refusal — narrow the scope, pick a user-owned target, or finish cannot.",
  },
];

/** First matching hint code for a failure, or undefined when nothing matches. */
export function recoveryHintFor(actionClass: string, errorText: string): string | undefined {
  const hit = HINTS.find((h) => h.when(actionClass, errorText));
  return hit?.hint;
}

/** Hint codes, for tests and trail summaries. */
export function recoveryHintCode(actionClass: string, errorText: string): string | undefined {
  return HINTS.find((h) => h.when(actionClass, errorText))?.code;
}

/** Autonomous recoveries before the loop nudges toward asking the user. */
export const MAX_AUTONOMOUS_RECOVERIES = 2;

/**
 * Planner-facing FAILED feedback. consecutiveFailures counts consecutive
 * FAILED turns including this one (1-based): after MAX_AUTONOMOUS_RECOVERIES
 * the nudge orders ask_user with concrete options over a third blind retry.
 */
export function failureFeedback(opts: {
  error: string;
  hint?: string;
  consecutiveFailures: number;
}): string {
  const { error, hint, consecutiveFailures } = opts;
  let out = `FAILED: ${error}`;
  if (hint) out += ` Recovery hint: ${hint}`;
  if (consecutiveFailures >= MAX_AUTONOMOUS_RECOVERIES) {
    out +=
      " Two recoveries already tried — call reach.ask_user with concrete options now, not another blind retry. If the user cannot resolve it, finish cannot with partial evidence preserved.";
  } else {
    out += " Try one changed approach (different args, narrower scope, or sibling tool).";
  }
  return out;
}
