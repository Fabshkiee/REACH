import { z } from "zod";
import { createTask, getTask, setTaskStatus } from "../tasks/taskStore.js";

export const ExecuteOnMyDevicesSchema = z.object({
  task: z.string().min(3).max(2000).describe("Natural-language user goal, e.g. create a homework document on my laptop."),
});

export const GetTaskStatusSchema = z.object({
  taskId: z.string().min(1),
});

export type ExecuteOnMyDevicesInput = z.infer<typeof ExecuteOnMyDevicesSchema>;
export type GetTaskStatusInput = z.infer<typeof GetTaskStatusSchema>;

const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:3001";
const DOC_REQUEST = /document|docx|\bdoc\b|homework|report|memo|letter|homework/i;

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

interface DispatchResult {
  path?: string;
  opened?: boolean;
  openNote?: string;
  error?: string;
}

async function dispatchCreateDocument(taskId: string, task: string): Promise<void> {
  setTaskStatus(taskId, "running");
  const title = deriveDocTitle(task);
  const body = `Requested via REACH:\n"${task}"`;
  try {
    const res = await fetch(`${AGENT_URL}/jobs/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability: "create_document", args: { title, body } }),
    });
    const data = (await res.json().catch(() => ({}))) as DispatchResult;
    if (!res.ok || !data.path) {
      setTaskStatus(taskId, "failed", { error: data.error ?? `agent dispatch failed: HTTP ${res.status}` });
      return;
    }
    setTaskStatus(taskId, "completed", {
      evidence: {
        deviceId: "windows-laptop",
        capabilityId: "create_document",
        artifactUri: data.path,
        note: data.opened ? "created and opened" : `created; open skipped (${data.openNote ?? "unknown"})`,
      },
    });
  } catch (err) {
    setTaskStatus(taskId, "failed", {
      error: err instanceof Error ? `agent unreachable: ${err.message}` : "agent unreachable",
    });
  }
}

/**
 * Phase 1 routing: document-like goals dispatch to the Windows agent in the
 * background; everything else stays queued (full capability graph = Phase 2).
 * ALWAYS returns a taskId immediately — never blocks on device work.
 */
export function executeOnMyDevices(input: ExecuteOnMyDevicesInput): { taskId: string } {
  const parsed = ExecuteOnMyDevicesSchema.parse(input);
  const task = createTask(parsed.task);
  if (DOC_REQUEST.test(parsed.task)) {
    void dispatchCreateDocument(task.id, parsed.task);
  }
  return { taskId: task.id };
}

export function getTaskStatus(input: GetTaskStatusInput) {
  const parsed = GetTaskStatusSchema.parse(input);
  const task = getTask(parsed.taskId);
  if (!task) return { status: "failed" as const, error: `unknown task ${parsed.taskId}` };
  return { status: task.status, evidence: task.evidence, error: task.error };
}
