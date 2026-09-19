import { z } from "zod";

/**
 * Action classes. The class drives policy defaults; individual capabilities
 * refine via risk hints. There is deliberately NO generic "run"/"exec" class —
 * arbitrary code execution cannot be expressed in this model at all.
 */
export const ACTION_CLASSES = [
  "observe",
  "read",
  "search",
  "write",
  "move",
  "delete",
  "download",
  "launch",
  "interact",
  "send",
  "publish",
  "purchase",
  "configure",
  "ask",
] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];

export type PolicyVerdict = "allow" | "confirm" | "deny";

export interface PolicyContext {
  /** Inferred user-owned root, e.g. C:\Users\<name>. Never configured per folder. */
  userRoot: string;
  /** Where downloads land by default. */
  workDir: string;
  /** Known-safe launch names (populated by the apps adapter in A2). */
  knownApps?: string[];
}

export interface ProposedAction {
  id: string;
  actionClass: ActionClass;
  /** Capability-qualified name, e.g. "files.read". */
  name: string;
  args: Record<string, unknown>;
  /** Free-text target for policy inspection, e.g. a path, URL, or recipient. */
  target?: string;
  /** Timeout for this action instance. */
  timeoutMs: number;
  /** Planner-supplied confidence/ambiguity signal (0..1, higher = clearer intent). */
  clarity?: number;
}

export interface PolicyDecision {
  verdict: PolicyVerdict;
  /** Machine-readable reason code, e.g. "deny.system-path". */
  reason: string;
  /** Human sentence for evidence and approval cards. */
  message: string;
}

const ActionSchema = z.object({
  actionClass: z.enum(ACTION_CLASSES),
  name: z.string().min(1).max(120),
  args: z.record(z.unknown()).default({}),
  target: z.string().max(2000).optional(),
  timeoutMs: z.number().int().positive().max(600_000).default(60_000),
  clarity: z.number().min(0).max(1).optional(),
});

export function parseProposedAction(id: string, raw: unknown): ProposedAction {
  const parsed = ActionSchema.parse(raw);
  return { id, ...parsed };
}
