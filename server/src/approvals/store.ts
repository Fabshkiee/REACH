import { join } from "node:path";
import { dataDir, ensureDir, listJsonBasenames, readJson, writeJsonAtomic } from "../store/jsonFile.js";
import type { PendingApproval } from "../tasks/types.js";

export const APPROVAL_SCHEMA_VERSION = 1;
export const APPROVAL_TTL_MS = Number(process.env.APPROVAL_TTL_MS ?? 10 * 60_000);

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface StoredApproval extends PendingApproval {
  status: ApprovalStatus;
  decidedAt?: string;
  /** Who/what resolved it: "sim-ui", "mcp:decide_approval", "test", ... */
  decidedBy?: string;
}

function approvalsDir(): string {
  const dir = join(dataDir(), "approvals");
  ensureDir(dir);
  return dir;
}

function approvalPath(id: string): string {
  return join(approvalsDir(), `${id}.json`);
}

function isSafeId(id: string): boolean {
  return /^apr_[A-Za-z0-9_]+$/.test(id);
}

function newId(): string {
  return `apr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function read(id: string): StoredApproval | undefined {
  if (!isSafeId(id)) return undefined;
  const raw = readJson<{ version?: number } & StoredApproval>(approvalPath(id));
  if (!raw || raw.version !== APPROVAL_SCHEMA_VERSION) return undefined;
  return raw;
}

function write(apr: StoredApproval): void {
  writeJsonAtomic(approvalPath(apr.id), { version: APPROVAL_SCHEMA_VERSION, ...apr });
}

export function createApproval(input: {
  taskId: string;
  actionName: string;
  actionClass: string;
  target?: string;
  consequence: string;
  args?: Record<string, unknown>;
  ttlMs?: number;
}): StoredApproval {
  const now = Date.now();
  const apr: StoredApproval = {
    id: newId(),
    taskId: input.taskId,
    actionName: input.actionName,
    actionClass: input.actionClass,
    target: input.target,
    consequence: input.consequence,
    args: input.args ?? {},
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (input.ttlMs ?? APPROVAL_TTL_MS)).toISOString(),
    status: "pending",
  };
  write(apr);
  return apr;
}

/** Read with lazy expiry: past-due pendings report as expired. */
export function getApproval(id: string, now = Date.now()): StoredApproval | undefined {
  const apr = read(id);
  if (!apr) return undefined;
  if (apr.status === "pending" && Date.parse(apr.expiresAt) <= now) {
    const expired: StoredApproval = { ...apr, status: "expired" };
    write(expired);
    return expired;
  }
  return apr;
}

/**
 * Resolve exactly once. Returns undefined when unknown, already resolved, or
 * expired — approvals are single-use by construction.
 */
export function resolveApproval(
  id: string,
  decision: "approve" | "deny",
  decidedBy: string,
  now = Date.now(),
): StoredApproval | undefined {
  const apr = getApproval(id, now);
  if (!apr || apr.status !== "pending") return undefined;
  const resolved: StoredApproval = {
    ...apr,
    status: decision === "approve" ? "approved" : "denied",
    decidedAt: new Date(now).toISOString(),
    decidedBy,
  };
  write(resolved);
  return resolved;
}

export function listPendingApprovals(taskId?: string, now = Date.now()): StoredApproval[] {
  const out: StoredApproval[] = [];
  for (const f of listJsonBasenames(approvalsDir())) {
    const apr = getApproval(f.replace(/\.json$/, ""), now);
    if (apr && apr.status === "pending" && (!taskId || apr.taskId === taskId)) out.push(apr);
  }
  return out;
}
