import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { dataDir, ensureDir, listJsonBasenames, readJson, writeJsonAtomic } from "../store/jsonFile.js";
import type { ActionRecord, ReachTask, TaskEvent, TaskStatus } from "./types.js";

export const TASK_SCHEMA_VERSION = 4;
/** v1–v3 files still load; new fields arrive as undefined. */
const READABLE_VERSIONS = new Set([1, 2, 3, 4]);

/** Event trail cap: oldest entries dropped first (goal_received preserved). */
export const MAX_TASK_EVENTS = 200;

/** A loop slot older than this is treated as orphaned (crashed holder). */
const LOOP_STALE_MS = Number(process.env.PLANNER_LOOP_STALE_MS ?? 5 * 60_000);

function defaultBudget(): ReachTask["budget"] {
  return {
    maxPlannerCalls: Number(process.env.PLANNER_MAX_CALLS ?? 24),
    maxElapsedMs: Number(process.env.TASK_MAX_ELAPSED_MS ?? 10 * 60_000),
    maxActions: Number(process.env.TASK_MAX_ACTIONS ?? 40),
  };
}

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
  return `task_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "cancelled"]);

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

class FileTaskStore implements TaskStore {
  create(goal: string): ReachTask {
    const now = new Date().toISOString();
    const goalEvent: TaskEvent = {
      eventId: `ev_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      at: now,
      kind: "goal_received",
      summary: goal.length > 200 ? goal.slice(0, 200) + "…" : goal,
    };
    const task: ReachTask = { id: newId(), goal, status: "queued", createdAt: now, updatedAt: now, budget: defaultBudget(), events: [goalEvent] };
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

/** Append one user-visible event; oldest dropped past the cap (goal_received kept). */
export function appendTaskEvent(
  id: string,
  event: Omit<TaskEvent, "eventId" | "at"> & { eventId?: string; at?: string },
): ReachTask | undefined {
  const existing = store.get(id);
  if (!existing) return undefined;
  const full: TaskEvent = {
    eventId: event.eventId ?? `ev_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    at: event.at ?? new Date().toISOString(),
    kind: event.kind,
    ...(event.actionId ? { actionId: event.actionId } : {}),
    ...(event.capabilityId ? { capabilityId: event.capabilityId } : {}),
    ...(event.target ? { target: event.target } : {}),
    ...(event.status ? { status: event.status } : {}),
    summary: event.summary.length > 300 ? event.summary.slice(0, 300) + "…" : event.summary,
    ...(event.evidenceActionIds ? { evidenceActionIds: event.evidenceActionIds.slice(0, 50) } : {}),
  };
  const kept = [...(existing.events ?? []), full];
  const first = kept[0];
  const tail = kept.slice(-MAX_TASK_EVENTS);
  const events = first && first.kind === "goal_received" && !tail.some((e) => e.eventId === first.eventId)
    ? [first, ...tail.slice(-(MAX_TASK_EVENTS - 1))]
    : tail;
  return store.setStatus(id, existing.status, { events });
}

export function listRecentTasks(limit?: number): ReachTask[] {
  return store.listRecent(limit);
}

/**
 * Claim the single-flight planner-loop slot. Returns false when another live
 * loop holds the task or the task is already terminal — the caller must return
 * without touching task state (duplicate resume/approve is a no-op, never a
 * second loop). Synchronous read-modify-write on the file store.
 */
export function claimLoopSlot(id: string, token: string): boolean {
  const existing = store.get(id);
  if (!existing || isTerminalStatus(existing.status)) return false;
  const slot = existing.loop;
  if (slot?.active && Date.now() - Date.parse(slot.startedAt) < LOOP_STALE_MS && slot.token !== token) {
    return false;
  }
  store.setStatus(id, existing.status, {
    loop: { active: true, token, startedAt: new Date().toISOString() },
  });
  return true;
}

/** Release a held loop slot, preserving the task's current status. */
export function releaseLoopSlot(id: string, token: string): void {
  const existing = store.get(id);
  if (!existing || existing.loop?.token !== token) return;
  store.setStatus(id, existing.status, { loop: undefined });
}

/**
 * Cancel a task. Clears pauses so polls resolve; the planner loop observes the
 * `cancelled` status at the next step boundary and exits without overwriting it.
 * Terminal tasks are returned untouched.
 */
export function cancelTask(id: string, reason = "cancelled by user"): ReachTask | undefined {
  const existing = store.get(id);
  if (!existing || isTerminalStatus(existing.status)) return existing;
  const evidenceActionIds = (existing.trace ?? []).filter((r) => r.ok === true).map((r) => r.actionId);
  const cancelled = store.setStatus(id, "cancelled", {
    pendingApproval: undefined,
    pendingInput: undefined,
    loop: undefined,
    outcome: { kind: "failed", reason, evidenceActionIds },
    error: reason,
  });
  appendTaskEvent(id, { kind: "task_cancelled", summary: reason.slice(0, 300), evidenceActionIds });
  return cancelled;
}
