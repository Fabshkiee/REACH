import { join } from "node:path";
import { dataDir, ensureDir, listJsonBasenames, readJson, writeJsonAtomic } from "../store/jsonFile.js";
import type { ActionRecord, ReachTask, TaskStatus } from "./types.js";

export const TASK_SCHEMA_VERSION = 2;
/** v1 files (pre-trace model) still load; new fields arrive as undefined. */
const READABLE_VERSIONS = new Set([1, 2]);

export interface TaskStore {
  create(goal: string): ReachTask;
  get(id: string): ReachTask | undefined;
  setStatus(id: string, status: TaskStatus, patch?: Partial<ReachTask>): ReachTask | undefined;
  listRecent(limit?: number): ReachTask[];
}

/** Task IDs are generated, never user-supplied — still, never let one escape the dir. */
function isSafeId(id: string): boolean {
  return /^task_[A-Za-z0-9_]+$/.test(id);
}

function tasksDir(): string {
  const dir = join(dataDir(), "tasks");
  ensureDir(dir);
  return dir;
}

function taskPath(id: string): string {
  return join(tasksDir(), `${id}.json`);
}

function newId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

class FileTaskStore implements TaskStore {
  create(goal: string): ReachTask {
    const now = new Date().toISOString();
    const task: ReachTask = { id: newId(), goal, status: "queued", createdAt: now, updatedAt: now };
    writeJsonAtomic(taskPath(task.id), { version: TASK_SCHEMA_VERSION, ...task });
    return task;
  }

  get(id: string): ReachTask | undefined {
    if (!isSafeId(id)) return undefined;
    const raw = readJson<{ version?: number } & ReachTask>(taskPath(id));
    if (!raw || !READABLE_VERSIONS.has(raw.version ?? 0)) return undefined;
    return raw;
  }

  setStatus(id: string, status: TaskStatus, patch: Partial<ReachTask> = {}): ReachTask | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const updated: ReachTask = { ...existing, ...patch, status, updatedAt: new Date().toISOString() };
    writeJsonAtomic(taskPath(id), { version: TASK_SCHEMA_VERSION, ...updated });
    return updated;
  }

  listRecent(limit = 20): ReachTask[] {
    const dir = tasksDir();
    const tasks = listJsonBasenames(dir)
      .map((f) => readJson<{ version?: number } & ReachTask>(join(dir, f)))
      .filter((t): t is { version?: number } & ReachTask => !!t && READABLE_VERSIONS.has(t.version ?? 0));
    tasks.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return tasks.slice(0, limit);
  }
}

// Singleton behind the classic function API. Swap the implementation here
// (e.g. `new SqliteTaskStore(...)`) to change backends — callers don't move.
const store: TaskStore = new FileTaskStore();

export function createTaskStore(): TaskStore {
  return store;
}

export function createTask(goal: string): ReachTask {
  return store.create(goal);
}

export function getTask(id: string): ReachTask | undefined {
  return store.get(id);
}

export function setTaskStatus(id: string, status: TaskStatus, patch: Partial<ReachTask> = {}): ReachTask | undefined {
  return store.setStatus(id, status, patch);
}

/** Append one audit record to a task's trace (read-modify-write in one place). */
export function appendActionRecord(id: string, record: ActionRecord): ReachTask | undefined {
  const existing = store.get(id);
  if (!existing) return undefined;
  return store.setStatus(id, existing.status, { trace: [...(existing.trace ?? []), record] });
}

export function listRecentTasks(limit?: number): ReachTask[] {
  return store.listRecent(limit);
}
