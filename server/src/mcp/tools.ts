import { z } from "zod";
import { createTask, getTask, listRecentTasks } from "../tasks/taskStore.js";
import { routeTask } from "../tasks/runner.js";

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

/**
 * Accept a goal, persist it as queued, and route in the background.
 * ALWAYS returns a taskId immediately (<500ms) — never blocks on device work.
 */
export function executeOnMyDevices(input: ExecuteOnMyDevicesInput): { taskId: string } {
  const parsed = ExecuteOnMyDevicesSchema.parse(input);
  const task = createTask(parsed.task);
  routeTask(task.id, parsed.task);
  return { taskId: task.id };
}

export function getTaskStatus(input: GetTaskStatusInput) {
  const parsed = GetTaskStatusSchema.parse(input);
  const task = getTask(parsed.taskId);
  if (!task) return { status: "failed" as const, error: `unknown task ${parsed.taskId}` };
  return { status: task.status, evidence: task.evidence, error: task.error };
}

export function listTasks(limit?: number) {
  return listRecentTasks(limit).map((t) => ({
    id: t.id,
    goal: t.goal,
    status: t.status,
    updatedAt: t.updatedAt,
  }));
}
