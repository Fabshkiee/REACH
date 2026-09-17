import type { ReachTask, TaskStatus } from "./types.js";

/**
 * In-memory task store for skeleton sprint.
 * Phase 2 replaces this with persistent storage (file/SQLite)
 * so tasks survive restarts — required for durable agentic workflows.
 */
const tasks = new Map<string, ReachTask>();

export function createTask(goal: string): ReachTask {
  const now = new Date().toISOString();
  const task: ReachTask = {
    id: `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    goal,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
  tasks.set(task.id, task);
  return task;
}

export function getTask(id: string): ReachTask | undefined {
  return tasks.get(id);
}

export function setTaskStatus(id: string, status: TaskStatus, patch: Partial<ReachTask> = {}): ReachTask | undefined {
  const existing = tasks.get(id);
  if (!existing) return undefined;
  const updated: ReachTask = { ...existing, ...patch, status, updatedAt: new Date().toISOString() };
  tasks.set(id, updated);
  return updated;
}
