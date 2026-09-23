export type TaskStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "cancelled";

/** Terminal outcome nuance. Lifecycle `status` stays completed/failed/cancelled
 *  for backward compat; `outcome.kind` tells the UI what actually happened.
 *  `complete` requires cited verified actions; anything else preserves partial
 *  evidence instead of narrating success. */
export type TaskOutcomeKind = "complete" | "partial" | "unverified" | "failed" | "cannot";

export interface TaskOutcome {
  kind: TaskOutcomeKind;
  /** Human-readable summary (complete/partial) or reason (failed/cannot/unverified). */
  summary?: string;
  reason?: string;
  /** Trace actionIds that ground this outcome — never model narration alone. */
  evidenceActionIds: string[];
  /** For `cannot`: which capabilities were missing. */
  missingCapabilities?: string[];
  /** For `partial`: what remains undone. */
  remaining?: string[];
}

/** Task-wide hard limits, stored at creation and enforced across resumes.
 *  Per-invocation MAX_STEPS remains as a backstop; these are the real gates. */
export interface TaskBudget {
  maxPlannerCalls: number;
  maxElapsedMs: number;
  maxActions: number;
}

/** Single-flight loop slot: exactly one planner loop per task at a time. */
export interface TaskLoopSlot {
  active: boolean;
  token: string;
  startedAt: string;
}

export interface TaskEvidence {
  deviceId: string;
  capabilityId: string;
  /** Local path, file URI, or result reference produced by the device agent. */
  artifactUri?: string;
  note?: string;
}

/** One audited step of a task: the constitution's 8-field evidence record. */
export interface ActionRecord {
  actionId: string;
  actionClass: string;
  name: string;
  target?: string;
  policyVerdict: "allow" | "confirm" | "deny";
  policyReason: string;
  startedAt: string;
  endedAt?: string;
  ok?: boolean;
  resultSummary?: string;
  verified?: boolean;
  approvalId?: string;
}

/** A paused confirmation: single-action, quoted, expiring. */
export interface PendingApproval {
  id: string;
  taskId: string;
  actionName: string;
  actionClass: string;
  /** Exact target the user is asked about. */
  target?: string;
  /** What happens if approved, in plain words. */
  consequence: string;
  args: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

/** A paused clarifying question from the planner. */
export interface PendingInput {
  taskId: string;
  question: string;
  options?: string[];
  createdAt: string;
  /** Set when the user answers; the executor consumes it on resume. */
  answer?: string;
  answeredAt?: string;
  questionCount?: number;
}

export interface AskedQuestion {
  question: string;
  normalized: string;
  options?: string[];
  answer?: string;
  askedAt: string;
  answeredAt?: string;
}

/** Append-only, user-visible task event. The sim timeline renders these. */
export type TaskEventKind =
  | "goal_received"
  | "action_finished"
  | "approval_requested"
  | "approval_decided"
  | "clarification_requested"
  | "clarification_answered"
  | "outcome_set"
  | "task_cancelled";

export interface TaskEvent {
  eventId: string;
  at: string;
  kind: TaskEventKind;
  actionId?: string;
  /** Action/adapter name, e.g. "files.search". */
  capabilityId?: string;
  target?: string;
  status?: "succeeded" | "failed" | "awaiting_approval" | "awaiting_input" | "unverified";
  /** Bounded (≤300 chars), safe for the user. */
  summary: string;
  evidenceActionIds?: string[];
}

export interface ReachTask {
  id: string;
  /** Original natural-language goal, e.g. "create a document on my laptop for biology homework". */
  goal: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  evidence?: TaskEvidence;
  error?: string;
  /** Subtask linkage for multi-step plans. */
  parentId?: string;
  /** Planner's working plan (human-readable steps). */
  plan?: string[];
  /** Full audit trace, appended per action. */
  trace?: ActionRecord[];
  pendingApproval?: PendingApproval;
  pendingInput?: PendingInput;
  /** Planner token accounting (cents-visibility for the Builder story). */
  usage?: { inputTokens: number; outputTokens: number; calls: number };
  /** Structured terminal outcome (Slice B). Absent on old/running tasks. */
  outcome?: TaskOutcome;
  /** Hard limits enforced cumulatively across resumes. */
  budget?: TaskBudget;
  /** Single-flight planner-loop slot. */
  loop?: TaskLoopSlot;
  /** Append-only user-visible event trail (capped, oldest dropped first). */
  events?: TaskEvent[];
  /** Asked clarifying questions history for guardrails and UI (Phase 1). */
  askedQuestions?: AskedQuestion[];
}

export interface ExecuteOnMyDevicesInput {
  task: string;
}

export interface ExecuteOnMyDevicesOutput {
  taskId: string;
}

export interface GetTaskStatusInput {
  taskId: string;
}

export interface GetTaskStatusOutput {
  status: TaskStatus;
  result?: string;
  evidence?: TaskEvidence;
  error?: string;
}
