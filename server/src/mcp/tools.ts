import { z } from "zod";
import { createTask, getTask } from "../tasks/taskStore.js";

export const ExecuteOnMyDevicesSchema = z.object({
  task: z.string().min(3).max(2000).describe("Natural-language user goal, e.g. create a homework document on my laptop."),
});

export const GetTaskStatusSchema = z.object({
  taskId: z.string().min(1),
});

export type ExecuteOnMyDevicesInput = z.infer<typeof ExecuteOnMyDevicesSchema>;
export type GetTaskStatusInput = z.infer<typeof GetTaskStatusSchema>;

/**
 * Skeleton tool handlers — Phase 2 adds real dispatch to device agents.
 * MUST return quickly (<500ms) with a taskId; never block on device work.
 */
export function executeOnMyDevices(input: ExecuteOnMyDevicesInput): { taskId: string } {
  const parsed = ExecuteOnMyDevicesSchema.parse(input);
  const task = createTask(parsed.task);
  // TODO Phase 2: resolve capabilities → pick device → dispatch via HTTPS → running.
  return { taskId: task.id };
}

export function getTaskStatus(input: GetTaskStatusInput) {
  const parsed = GetTaskStatusSchema.parse(input);
  const task = getTask(parsed.taskId);
  if (!task) return { status: "failed" as const, error: `unknown task ${parsed.taskId}` };
  return { status: task.status, evidence: task.evidence, error: task.error };
}
