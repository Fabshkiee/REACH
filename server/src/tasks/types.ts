export type TaskStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "awaiting_input"
  | "completed"
  | "failed";

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
