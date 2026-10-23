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
export async function callAgent(
  capability: string,
  args: Record<string, unknown>,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
    if (ctrl.signal.aborted) throw new Error(`agent call timed out after ${timeoutMs}ms`);
    throw err instanceof Error ? err : new Error("agent call failed");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reports quote the web; a report with no URL is unverifiable, and "Link"
 * anchor text hides the publisher. This runs before dispatch so the model
 * gets a correction instead of shipping a doc the user cannot check.
 */
export function requireReportSource(args: Record<string, unknown>): void {
  const body = typeof args["body"] === "string" ? args["body"] : "";
  const label = `${String(args["documentType"] ?? "")} ${String(args["title"] ?? "")}`;
  if (!/\b(report|update|research|analysis)\b/i.test(label)) return;

  if (!/https?:\/\/[^\s)<>\]"']+/i.test(body)) {
    throw new Error(
      "A report/update/research document must cite its sources. Add at least one full http(s) URL from web.search in the body — a title alone or the word 'Link' is not a citation. Then create the document again.",
    );
  }

  const malformedCve = /\bCVE-\d{4}-\d{4,}[A-Za-z]+\b/.exec(body);
  if (malformedCve) {
    throw new Error(
      `Malformed CVE ID "${malformedCve[0]}": use CVE-YYYY-NNNN with no letter suffix, then create the document again.`,
    );
  }

  const lazyAnchor = /\[(link|here|source|this|read more)\s*\]\(\s*https?:/i.exec(body);
  if (lazyAnchor) {
    throw new Error(
      `Replace the "${lazyAnchor[1]}" link text with the publisher or source name (e.g. [CISA](https://...)), then create the document again.`,
    );
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
      description:
        "Search filenames (and optionally contents) under user space. The query is matched by WORD, so 'standup transcript' finds 'standup-transcript.txt'. Results are ranked — the best match is first — and each hit carries a score (how many query words it covered). A hit whose score is less than the number of query words is a partial/noisy match: if none covers every word, the file is probably absent. mode 'name' matches file names, 'content' matches what is inside files (.txt, .docx, .pdf, .xlsx). If timedOut is true the walk hit its budget and the list is PARTIAL; say so rather than concluding the file does not exist.",
      schema: z.object({ query: z.string().min(1).max(200), root: z.string().max(500).optional(), mode: z.enum(["name", "content"]).optional(), limit: z.number().int().min(1).max(50).optional() }),
      timeoutMs: 60_000,
      capability: "search_files",
    },
    {
      name: "files.read",
      actionClass: "read" as const,
      description:
        "Read a text/docx/pdf/xlsx file as text. Larger files: page with offsetChars (totalChars reports the length, truncated says more remains). If truncated is true, read again with offsetChars to get the rest — do not treat the first page as the whole file.",
      schema: z.object({ path: PathArg, maxBytes: z.number().int().positive().max(2_097_152).optional(), offsetChars: z.number().int().min(0).max(200_000_000).optional() }),
      timeoutMs: 30_000,
      capability: "read_file",
    },
    {
      name: "files.list",
      actionClass: "search" as const,
      description:
        "List one directory: names, sizes, and types (directories first). sorted smallest-first by default — pass sort:'name' for alphabetical or sort:'recent' for newest first. Use offset to page past the first `limit` entries; total and truncated say whether more exist. Use for 'what is here' or 'which files are small enough to read' — never verify a directory as a file.",
      schema: z.object({ path: PathArg.optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).max(10000).optional(), sort: z.enum(["size", "name", "recent"]).optional() }),
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
        "Create and open a real .docx Word document on the laptop. The body is MARKDOWN and becomes real Word structure: '#' becomes a heading, '- ' a bullet, '1. ' a numbered item, '| a | b |' a table, '**x**' bold. Write the FINISHED document in your own words — a summary or minutes you composed from the source, NEVER a copy of the source text. Name the kind of document in documentType, then give each section its OWN '#' heading line (do not use bold text as a section label). The title is the document's top-level heading, so body headings sit one level below it. Example (meeting minutes): title 'Weekly Standup Minutes', documentType 'meeting minutes', body '# Attendees' then names, '# Decisions' then '- ...' bullets, '# Action items' then '- **Owner** - what they do' (list EVERY action item with its owner, even when it also appears above), '# Open questions' then '- ...'. For a report: a '# Summary' section then '# Section name' sections. For a technical/debate doc: '# Thesis' then the claim, '# Evidence' with bullets of real feats and numbers, '# Counter-arguments' addressing the strongest opposing view, '# Verdict' with a one-paragraph conclusion. For a letter: a greeting paragraph then the body. IMAGES: download with web.download_asset first, then embed INLINE next to the section they illustrate using markdown '![](localPath)' with a caption line (e.g. '![](/Users/.../fig.png)' then 'Figure 1 — caption'). Passing a remote URL also works as a fallback, but downloading first is preferred (saves the file to disk). imagePaths (appended at end) is a fallback only. The file lands in the Documents/REACH folder and opens automatically.",
      schema: z.object({
        title: z.string().min(1).max(200),
        body: z.string().max(20000).default(""),
        documentType: z.string().max(80).optional().describe("The kind of document, e.g. 'meeting minutes', 'incident report', 'invoice summary'"),
        directory: z.string().max(2000).optional().describe("Folder to save it in (defaults to the REACH work folder)"),
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
      description: "Launch an application by name (e.g. 'calculator', 'spotify', 'vscode', 'Antigravity'). Pass 'path' to open a specific file or folder in it. Known apps launch silently; any other installed app asks for confirmation first. Never search for an app name as a file.",
      schema: z.object({ app: z.string().min(1).max(100), path: z.string().max(2000).optional() }),
      timeoutMs: 30_000,
      capability: "launch_application",
    },
    {
      name: "phone.ios_list",
      actionClass: "search" as const,
      description: "List iPhones paired with this Mac (USB or Wi-Fi). Returns name, model, iOS version and UDID. Pair/trust the phone first; pass the UDID to another phone.* tool when several are paired.",
      schema: z.object({}),
      timeoutMs: 20_000,
      capability: "ios_list",
    },
    {
      name: "phone.ios_info",
      actionClass: "observe" as const,
      description: "Get a connected iPhone's name, model, iOS version, UDID, battery (level + charging) and storage. Battery/storage are null when the phone does not report them — never invent them from a null.",
      schema: z.object({ udid: z.string().min(1).max(64).optional() }),
      timeoutMs: 60_000,
      capability: "ios_info",
    },
    {
      name: "phone.ios_list_files",
      actionClass: "search" as const,
      description: "List files on a connected iPhone (e.g. /DCIM/ for photos). Paged: total and truncated report whether more entries exist beneath the limit.",
      schema: z.object({
        path: z.string().max(500).default("/DCIM/"),
        limit: z.number().int().min(1).max(2000).optional(),
        udid: z.string().min(1).max(64).optional(),
      }),
      timeoutMs: 30_000,
      capability: "ios_list_files",
    },
    {
      name: "phone.ios_pull_file",
      actionClass: "read" as const,
      description: "Download a file from a connected iPhone to the laptop (e.g. a photo from /DCIM/...).",
      schema: z.object({
        src: z.string().min(1).max(500),
        destDir: z.string().max(500).optional(),
        udid: z.string().min(1).max(64).optional(),
      }),
      timeoutMs: 180_000,
      capability: "ios_pull_file",
    },
    {
      name: "phone.ios_screenshot",
      actionClass: "download" as const,
      description: "Capture the connected iPhone's screen to a PNG on the laptop (default Downloads/REACH). Requires Developer Mode and a current developer image on the phone. Returns the saved path and size.",
      schema: z.object({ destDir: z.string().max(500).optional(), udid: z.string().min(1).max(64).optional() }),
      timeoutMs: 90_000,
      capability: "ios_screenshot",
    },
    {
      name: "phone.ios_apps",
      actionClass: "search" as const,
      description: "List the apps installed on the connected iPhone (display name + bundle ID). Use the bundle ID with phone.ios_launch or phone.ios_push_file. Requires Developer Mode and a current developer image.",
      schema: z.object({ udid: z.string().min(1).max(64).optional() }),
      timeoutMs: 90_000,
      capability: "ios_apps",
    },
    {
      name: "phone.ios_paste",
      actionClass: "read" as const,
      description: "Read the current text on the connected iPhone's clipboard. Requires Developer Mode and a current developer image.",
      schema: z.object({
        maxChars: z.number().int().min(1).max(20000).optional(),
        udid: z.string().min(1).max(64).optional(),
      }),
      timeoutMs: 60_000,
      capability: "ios_paste",
    },
    {
      name: "phone.ios_copy",
      actionClass: "interact" as const,
      description: "Put text on the connected iPhone's clipboard (e.g. a link or address to paste on the phone). Requires Developer Mode and a current developer image.",
      schema: z.object({
        text: z.string().min(1).max(10000),
        udid: z.string().min(1).max(64).optional(),
      }),
      timeoutMs: 60_000,
      capability: "ios_copy",
    },
    {
      name: "phone.ios_launch",
      actionClass: "launch" as const,
      description: "Launch an app on the connected iPhone by bundle ID (from phone.ios_apps). Unknown bundle IDs need approval. Requires Developer Mode and a current developer image.",
      schema: z.object({
        bundleId: z.string().min(1).max(200).regex(/^[A-Za-z0-9.-]+$/),
        udid: z.string().min(1).max(64).optional(),
      }),
      timeoutMs: 60_000,
      capability: "ios_launch",
    },
    {
      name: "phone.ios_button",
      actionClass: "configure" as const,
      description: "Press a hardware button on the connected iPhone: home, lock, volume-up, volume-down, mute or siri. Always requires approval. Requires Developer Mode and a current developer image.",
      schema: z.object({
        button: z.enum(["home", "lock", "volume-up", "volume-down", "mute", "siri"]),
        udid: z.string().min(1).max(64).optional(),
      }),
      timeoutMs: 60_000,
      capability: "ios_button",
    },
    {
      name: "phone.ios_push_file",
      actionClass: "send" as const,
      description: "Copy a local file onto the connected iPhone: into an app's Documents folder when bundleId is given, else into /REACH/ in the phone's media area. Always requires approval. Requires Developer Mode for app containers.",
      schema: z.object({
        path: PathArg,
        bundleId: z.string().min(1).max(200).regex(/^[A-Za-z0-9.-]+$/).optional(),
        remotePath: z.string().min(1).max(500).optional(),
        udid: z.string().min(1).max(64).optional(),
      }),
      timeoutMs: 180_000,
      capability: "ios_push_file",
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
        deviceCapability: d.capability,
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
        handler: async (args) => {
          if (d.name === "files.create_document") requireReportSource(args);
          return callAgent(d.capability, args, d.timeoutMs + 5_000);
        },
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
      // Judge the folder the document will land in when one was named —
      // that is what the user is really authorising.
      return typeof args["directory"] === "string" && args["directory"]
        ? args["directory"]
        : typeof args["title"] === "string"
          ? args["title"]
          : undefined;
    case "files.move":
      return typeof args["to"] === "string" ? args["to"] : undefined;
    case "files.delete":
      return typeof args["path"] === "string" ? args["path"] : undefined;
    case "apps.open_url":
      return typeof args["url"] === "string" ? args["url"] : undefined;
    case "apps.launch":
      return typeof args["path"] === "string" && args["path"]
        ? `${args["app"]}: ${args["path"]}`
        : typeof args["app"] === "string"
          ? args["app"]
          : undefined;
    case "phone.ios_list":
    case "phone.ios_info":
      return "phone";
    case "phone.ios_list_files":
      return typeof args["path"] === "string" ? args["path"] : "phone";
    case "phone.ios_pull_file":
      return typeof args["src"] === "string" ? args["src"] : "phone";
    case "phone.ios_screenshot":
      return typeof args["destDir"] === "string" && args["destDir"] ? args["destDir"] : "Downloads/REACH";
    case "phone.ios_apps":
      return "phone-apps";
    case "phone.ios_paste":
    case "phone.ios_copy":
      return "phone-clipboard";
    case "phone.ios_launch":
      return typeof args["bundleId"] === "string" ? args["bundleId"] : "phone-app";
    case "phone.ios_button":
      return typeof args["button"] === "string" ? `phone-button:${args["button"]}` : "phone-button";
    case "phone.ios_push_file":
      return typeof args["path"] === "string" ? args["path"] : undefined;
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
