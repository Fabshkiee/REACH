export type TaskStatus = "queued" | "running" | "completed" | "failed";

export interface TaskEvidence {
  deviceId: string;
  capabilityId: string;
  /** Local path, file URI, or result reference produced by the device agent. */
  artifactUri?: string;
  note?: string;
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
