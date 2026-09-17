import { setTaskStatus } from "./taskStore.js";
import { findProviders } from "../registry/capabilityGraph.js";
import { isDeviceAvailable, listDevices } from "../registry/deviceStore.js";

const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:3001";
const DISPATCH_TIMEOUT_MS = Number(process.env.DISPATCH_TIMEOUT_MS ?? 60_000);
const DOC_REQUEST = /document|docx|\bdoc\b|homework|report|memo|letter/i;

/** "Create a document on my laptop for my biology homework" → "My Biology Homework". */
export function deriveDocTitle(task: string): string {
  const stripped = task
    .replace(/\s*on\s+my\s+laptop\s*/i, " ")
    .replace(/^(please\s+)?(create|make|write|generate|draft|start|open)\s+(a\s+|an\s+|the\s+)?(new\s+)?(word\s+)?(document|doc|docx|file|report|memo|letter)?\s*/i, "")
    .replace(/^\s*(for|about|on|titled?|called|named)\s+/i, "")
    .replace(/[.?!\s]+$/, "")
    .trim();
  const base = stripped || task.trim();
  return base
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ")
    .slice(0, 120);
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.AGENT_TOKEN) headers.authorization = `Bearer ${process.env.AGENT_TOKEN}`;
  return headers;
}

async function fetchWithTimeout(url: string, body: unknown): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DISPATCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

interface DispatchResult {
  path?: string;
  opened?: boolean;
  openNote?: string;
  error?: string;
}

async function dispatchOnce(taskId: string, task: string, deviceId: string): Promise<boolean> {
  const title = deriveDocTitle(task);
  const body = `Requested via REACH:\n"${task}"`;
  const res = await fetchWithTimeout(`${AGENT_URL}/jobs/dispatch`, {
    capability: "create_document",
    args: { title, body },
  });
  const data = (await res.json().catch(() => ({}))) as DispatchResult;
  if (!res.ok || !data.path) {
    // 4xx = the agent rejected the work; retrying won't help. 5xx/network may be transient.
    if (res.status >= 400 && res.status < 500) {
      setTaskStatus(taskId, "failed", { error: data.error ?? `agent rejected dispatch: HTTP ${res.status}` });
      return true;
    }
    return false;
  }
  setTaskStatus(taskId, "completed", {
    evidence: {
      deviceId,
      capabilityId: "create_document",
      artifactUri: data.path,
      note: data.opened ? "created and opened" : `created; open skipped (${data.openNote ?? "unknown"})`,
    },
  });
  return true;
}

async function runCreateDocument(taskId: string, task: string): Promise<void> {
  setTaskStatus(taskId, "running");
  const providers = findProviders("create_document", { onlyAvailable: true });
  if (providers.length === 0) {
    setTaskStatus(taskId, "failed", { error: "no capable device online (need create_document)" });
    return;
  }
  const deviceId = providers[0]!.deviceId;
  // One retry on transport failure only — the agent call is idempotent enough
  // (a retried create may yield "Title (1).docx", which evidence reports exactly).
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      if (await dispatchOnce(taskId, task, deviceId)) return;
    } catch (err) {
      if (attempt === 2) {
        setTaskStatus(taskId, "failed", {
          error: err instanceof Error ? `agent unreachable after retry: ${err.message}` : "agent unreachable after retry",
        });
        return;
      }
    }
  }
  setTaskStatus(taskId, "failed", { error: "agent dispatch failed after retry" });
}

function describeAvailable(): string {
  const online = listDevices().filter((d) => isDeviceAvailable(d));
  if (online.length === 0) return "none (no devices online)";
  return online.map((d) => `${d.capabilities.join(", ")} on ${d.id}`).join("; ");
}

/**
 * Route a queued task: required capabilities → available devices → execution.
 * Fail-fast: goals no online device can serve become `failed` with the reason
 * inline — never zombies stuck at `queued`.
 */
export function routeTask(taskId: string, goal: string): void {
  if (DOC_REQUEST.test(goal)) {
    void runCreateDocument(taskId, goal);
    return;
  }
  setTaskStatus(taskId, "failed", {
    error: `no capable device for "${goal.slice(0, 120)}". Available: ${describeAvailable()}`,
  });
}
