import { z } from "zod";
import { defineAction } from "../executor/registry.js";

const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:3001";
const CALL_TIMEOUT_MS = Number(process.env.DISPATCH_TIMEOUT_MS ?? 60_000);

function agentHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.AGENT_TOKEN) headers.authorization = `Bearer ${process.env.AGENT_TOKEN}`;
  return headers;
}

/** Call one agent capability; agent-side guards re-validate everything. */
export async function callAgent(capability: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${AGENT_URL}/jobs/dispatch`, {
      method: "POST",
      headers: agentHeaders(),
      body: JSON.stringify({ capability, args }),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `agent HTTP ${res.status}`);
    return data;
  } catch (err) {
    if (ctrl.signal.aborted) throw new Error(`agent call timed out after ${CALL_TIMEOUT_MS}ms`);
    throw err instanceof Error ? err : new Error("agent call failed");
  } finally {
    clearTimeout(timer);
  }
}

const PathArg = z.string().min(1).max(2000);

/**
 * Executor action defs for the laptop agent's primitives. Schemas mirror the
 * agent side (which re-validates — defense in depth); policy classifies by
 * the `target` each def declares. Register once at boot.
 */
export function registerAgentActions(): void {
  const defs = [
    {
      name: "files.search",
      actionClass: "search" as const,
      description: "Search filenames (and optionally contents) under user space.",
      schema: z.object({ query: z.string().min(1).max(200), root: z.string().max(500).optional(), mode: z.enum(["name", "content"]).optional(), limit: z.number().int().min(1).max(50).optional() }),
      timeoutMs: 60_000,
      capability: "search_files",
    },
    {
      name: "files.read",
      actionClass: "read" as const,
      description: "Read a text/docx/pdf/xlsx file as text. Larger files: page with offsetChars (totalChars reports length, truncated says more remains).",
      schema: z.object({ path: PathArg, maxBytes: z.number().int().positive().max(2_097_152).optional(), offsetChars: z.number().int().min(0).max(200_000_000).optional() }),
      timeoutMs: 30_000,
      capability: "read_file",
    },
    {
      name: "files.list",
      actionClass: "search" as const,
      description: "List one directory: names, sizes, and types (directories first, files smallest-first). Use for 'what is here' or 'which files are small enough to read' — never verify a directory as a file.",
      schema: z.object({ path: PathArg.optional(), limit: z.number().int().min(1).max(200).optional() }),
      timeoutMs: 15_000,
      capability: "list_files",
    },
    {
      name: "files.write",
      actionClass: "write" as const,
      description: "Write text to a file (overwrite only with overwrite:true).",
      schema: z.object({ path: PathArg, content: z.string().max(2_097_152), overwrite: z.boolean().optional() }),
      timeoutMs: 30_000,
      capability: "write_file",
    },
    {
      name: "files.create_document",
      actionClass: "write" as const,
      description:
        "Create and open a real .docx Word document on the laptop. Draft the body text yourself (plain paragraphs, one per line). The file lands in the Documents/REACH folder and opens automatically.",
      schema: z.object({
        title: z.string().min(1).max(200),
        body: z.string().max(20000).default(""),
        imagePaths: z.array(z.string().min(1).max(2000)).max(20).optional(),
      }),
      timeoutMs: 60_000,
      capability: "create_document",
    },
    {
      name: "files.move",
      actionClass: "move" as const,
      description: "Move/rename a file (overwrite only with overwrite:true).",
      schema: z.object({ from: PathArg, to: PathArg, overwrite: z.boolean().optional() }),
      timeoutMs: 30_000,
      capability: "move_file",
    },
    {
      name: "files.delete",
      actionClass: "delete" as const,
      description: "Delete a single file. Always requires user approval (confirm tier).",
      schema: z.object({ path: PathArg }),
      timeoutMs: 30_000,
      capability: "delete_file",
    },
    {
      name: "files.verify",
      actionClass: "observe" as const,
      description: "Verify a file exists (and optionally meets a minimum size).",
      schema: z.object({ path: PathArg, minBytes: z.number().int().nonnegative().optional() }),
      timeoutMs: 15_000,
      capability: "verify_file",
    },
    {
      name: "apps.open_document",
      actionClass: "interact" as const,
      description: "Open a document in its default app, or a directory in Windows File Explorer.",
      schema: z.object({ path: PathArg }),
      timeoutMs: 30_000,
      capability: "open_document",
    },
    {
      name: "apps.open_url",
      actionClass: "interact" as const,
      description: "Open an http(s) URL in the default browser.",
      schema: z.object({ url: z.string().min(1).max(2000) }),
      timeoutMs: 30_000,
      capability: "open_url",
    },
    {
      name: "apps.launch",
      actionClass: "launch" as const,
      description: "Launch a known-safe desktop utility by name (notepad, calc, cmd, powershell, explorer).",
      schema: z.object({ app: z.string().min(1).max(100) }),
      timeoutMs: 30_000,
      capability: "launch_application",
    },
    {
      name: "desktop.inspect_windows",
      actionClass: "observe" as const,
      description: "Inspect currently open desktop application windows. Returns window titles and process names (e.g. Discord, Figma, Spotify, VS Code).",
      schema: z.object({ query: z.string().max(100).optional() }),
      timeoutMs: 15_000,
      capability: "inspect_windows",
    },
    {
      name: "desktop.focus_window",
      actionClass: "interact" as const,
      description: "Bring a desktop application window to the foreground by its window title or process name (e.g. 'Discord', 'Figma', 'Spotify').",
      schema: z.object({ title: z.string().min(1).max(200) }),
      timeoutMs: 15_000,
      capability: "focus_window",
    },
    {
      name: "desktop.type_text",
      actionClass: "interact" as const,
      description: "Type text into the active desktop window (e.g. Discord chat, search bar, text editor). Set submit:true to press Enter. Automatically uses clipboard pasting for reliability.",
      schema: z.object({
        text: z.string().max(10000),
        submit: z.boolean().optional(),
        useClipboard: z.boolean().optional(),
      }),
      timeoutMs: 15_000,
      capability: "type_text",
    },
    {
      name: "desktop.send_hotkey",
      actionClass: "interact" as const,
      description: "Send keyboard shortcuts to the active window (e.g. ['ctrl', 'k'] for quick open in Discord/Slack, ['ctrl', 'o'] for file open, ['enter'], ['escape'], ['space']).",
      schema: z.object({ keys: z.array(z.string().min(1).max(20)).min(1).max(5) }),
      timeoutMs: 15_000,
      capability: "send_hotkey",
    },
    {
      name: "desktop.set_clipboard",
      actionClass: "interact" as const,
      description: "Set the Windows system clipboard text. Useful for copying summaries, code snippets, or URLs to paste into desktop apps.",
      schema: z.object({ text: z.string().max(100000) }),
      timeoutMs: 15_000,
      capability: "set_clipboard",
    },
    {
      name: "desktop.get_clipboard",
      actionClass: "read" as const,
      description: "Read the current text from the Windows system clipboard.",
      schema: z.object({}),
      timeoutMs: 15_000,
      capability: "get_clipboard",
    },
  ] as const;

  for (const d of defs) {
    try {
      defineAction({
        name: d.name,
        actionClass: d.actionClass,
        description: d.description,
        schema: d.schema,
        timeoutMs: d.timeoutMs,
        targetOf: (args) => targetForAction(d.name, args),
        verify: (result) => {
          const r = result as { ok?: unknown; error?: unknown; opened?: unknown; openNote?: unknown };
          if (!(r && typeof r === "object" && r.ok === true)) {
            throw new Error(typeof r?.error === "string" ? r.error : `${d.capability} did not report ok`);
          }
          // Open state is best-effort by design — but it must be VISIBLE, never
          // silently swallowed. A "completed" task with opened:false tells the truth.
          const opened =
            r.opened === undefined ? "" : r.opened === true ? " (opened)" : ` (open skipped: ${String(r.openNote ?? "unknown")})`;
          return `${d.capability} ok${opened}`;
        },
        handler: async (args) => callAgent(d.capability, args),
      });
    } catch {
      // Already registered (dev re-entry) — definitions are stable.
    }
  }
}

/** Executor-visible target helper (policy needs the target before dispatch). */
export function targetForAction(name: string, args: Record<string, unknown>): string | undefined {
  switch (name) {
    case "files.search":
      return typeof args["root"] === "string" && args["root"] ? args["root"] : undefined;
    case "files.read":
    case "files.verify":
    case "files.list":
    case "apps.open_document":
      return typeof args["path"] === "string" ? args["path"] : undefined;
    case "files.write":
      return typeof args["path"] === "string" ? args["path"] : undefined;
    case "files.create_document":
      return typeof args["title"] === "string" ? args["title"] : undefined;
    case "files.move":
      return typeof args["to"] === "string" ? args["to"] : undefined;
    case "files.delete":
      return typeof args["path"] === "string" ? args["path"] : undefined;
    case "apps.open_url":
      return typeof args["url"] === "string" ? args["url"] : undefined;
    case "apps.launch":
      return typeof args["app"] === "string" ? args["app"] : undefined;
    case "desktop.inspect_windows":
      return typeof args["query"] === "string" ? args["query"] : "windows";
    case "desktop.focus_window":
      return typeof args["title"] === "string" ? args["title"] : undefined;
    case "desktop.type_text":
    case "desktop.send_hotkey":
      return "active_window";
    case "desktop.set_clipboard":
    case "desktop.get_clipboard":
      return "clipboard";
    default:
      return undefined;
  }
}
