import { z } from "zod";
import { defineAction } from "../executor/registry.js";
import { join } from "node:path";
import { assertToolAllowed, browserOutputDir, playwrightMcp } from "../browser/playwright.js";

const UrlArg = z.string().min(1).max(2000);
const PageUrl = z.string().min(1).max(2000).describe("Current page URL (from the last snapshot). Binds this action to a page.");

function assertMcpOk(result: unknown, tool: string): string {
  const r = result as { isError?: unknown; content?: Array<{ text?: string }> };
  if (!r || typeof r !== "object" || r.isError === true) {
    throw new Error(`${tool} reported an error`);
  }
  const text = (r.content ?? [])
    .map((c) => (typeof c?.text === "string" ? c.text : ""))
    .join("\n");
  if (!text.trim()) throw new Error(`${tool} returned empty content`);
  return text;
}

/**
 * Browser action defs over the consumed Playwright MCP server. The planner
 * sees ONLY these names — upstream's evaluate/run_code/routing/config tools
 * are unreachable (assertToolAllowed throws before any subprocess exists).
 * Submitting interactions (type with submit:true) route to approval via the
 * existing submit rule; nothing browser-specific was added to policy.
 */
export function registerBrowserActions(): void {
  const defs = [
    {
      name: "browser.goto",
      actionClass: "interact" as const,
      description: "Navigate the browser to an http(s) URL.",
      schema: z.object({ url: UrlArg }),
      timeoutMs: 60_000,
      call: (a: Record<string, unknown>) => playwrightMcp.callTool("browser_navigate", { url: a["url"] }),
      targetOf: (a: Record<string, unknown>) => (typeof a["url"] === "string" ? a["url"] : undefined),
    },
    {
      name: "browser.observe",
      actionClass: "observe" as const,
      description: "Capture the accessibility snapshot of the current page (refs for acting).",
      schema: z.object({ pageUrl: PageUrl.optional() }),
      timeoutMs: 30_000,
      call: () => playwrightMcp.callTool("browser_snapshot", {}),
      targetOf: (a: Record<string, unknown>) => (typeof a["pageUrl"] === "string" ? a["pageUrl"] : undefined),
    },
    {
      name: "browser.find",
      actionClass: "observe" as const,
      description: "Search page snapshot text (cheaper than a full snapshot).",
      schema: z.object({ text: z.string().min(1).max(500).optional(), regex: z.string().min(1).max(500).optional(), pageUrl: PageUrl.optional() }),
      timeoutMs: 30_000,
      call: (a: Record<string, unknown>) => playwrightMcp.callTool("browser_find", { text: a["text"], regex: a["regex"] }),
      targetOf: (a: Record<string, unknown>) => (typeof a["pageUrl"] === "string" ? a["pageUrl"] : undefined),
    },
    {
      name: "browser.click",
      actionClass: "interact" as const,
      description: "Click a snapshot element ref on the given page.",
      schema: z.object({ pageUrl: PageUrl, target: z.string().min(1).max(200), element: z.string().max(300).optional() }),
      timeoutMs: 30_000,
      call: (a: Record<string, unknown>) =>
        playwrightMcp.callTool("browser_click", { target: a["target"], element: a["element"] }),
      targetOf: (a: Record<string, unknown>) => (typeof a["pageUrl"] === "string" ? a["pageUrl"] : undefined),
    },
    {
      name: "browser.type",
      actionClass: "interact" as const,
      description: "Type into an editable snapshot ref. submit:true presses Enter (needs approval).",
      schema: z.object({
        pageUrl: PageUrl,
        target: z.string().min(1).max(200),
        text: z.string().max(5000),
        submit: z.boolean().optional(),
      }),
      timeoutMs: 30_000,
      call: (a: Record<string, unknown>) =>
        playwrightMcp.callTool("browser_type", { target: a["target"], text: a["text"], submit: a["submit"] ?? false }),
      targetOf: (a: Record<string, unknown>) => (typeof a["pageUrl"] === "string" ? a["pageUrl"] : undefined),
    },
    {
      name: "browser.select",
      actionClass: "interact" as const,
      description: "Choose dropdown option(s) on the given page.",
      schema: z.object({ pageUrl: PageUrl, target: z.string().min(1).max(200), values: z.string().min(1).max(500) }),
      timeoutMs: 30_000,
      call: (a: Record<string, unknown>) =>
        playwrightMcp.callTool("browser_select_option", { target: a["target"], values: [a["values"]] }),
      targetOf: (a: Record<string, unknown>) => (typeof a["pageUrl"] === "string" ? a["pageUrl"] : undefined),
    },
    {
      name: "browser.press_key",
      actionClass: "interact" as const,
      description: "Press a key (e.g. Escape, ArrowDown). Prefer submit:true on type for Enter.",
      schema: z.object({ pageUrl: PageUrl, key: z.string().min(1).max(50) }),
      timeoutMs: 30_000,
      call: (a: Record<string, unknown>) => playwrightMcp.callTool("browser_press_key", { key: a["key"] }),
      targetOf: (a: Record<string, unknown>) => (typeof a["pageUrl"] === "string" ? a["pageUrl"] : undefined),
    },
    {
      name: "browser.wait",
      actionClass: "observe" as const,
      description: "Wait for text or seconds (page loads, downloads).",
      schema: z.object({ text: z.string().max(500).optional(), time: z.number().positive().max(120).optional(), pageUrl: PageUrl.optional() }),
      timeoutMs: 150_000,
      call: (a: Record<string, unknown>) => playwrightMcp.callTool("browser_wait_for", { text: a["text"], time: a["time"] }),
      targetOf: (a: Record<string, unknown>) => (typeof a["pageUrl"] === "string" ? a["pageUrl"] : undefined),
    },
    {
      name: "browser.fetch_download",
      actionClass: "download" as const,
      description: "Collect a file the page just downloaded (polls the sandbox download dir).",
      schema: z.object({ since: z.string().min(1).max(100), minBytes: z.number().int().nonnegative().optional() }),
      timeoutMs: 120_000,
      call: (a: Record<string, unknown>) => collectDownload(a),
      targetOf: () => browserOutputDir(),
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
        targetOf: d.targetOf,
        verify: (result) => assertMcpOk(result, d.name),
        handler: async (args) => d.call(args),
      });
    } catch {
      // Already registered (dev re-entry) — definitions are stable.
    }
  }
}

async function collectDownload(args: Record<string, unknown>): Promise<{ path: string; size: number }> {
  const since = Date.parse(String(args["since"] ?? ""));
  const minBytes = typeof args["minBytes"] === "number" ? args["minBytes"] : 1;
  // Single source of truth with the Playwright --output-dir: files land here.
  const dir = browserOutputDir();
  const { readdir, stat, mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  const deadline = Date.now() + 90_000;
  for (;;) {
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      entries = [];
    }
    let best: { path: string; size: number; mtime: number } | undefined;
    for (const e of entries) {
      if (e.endsWith(".crdownload") || e.endsWith(".part") || e.endsWith(".tmp")) continue;
      const p = join(dir, e);
      try {
        const st = await stat(p);
        if (st.isFile() && st.mtimeMs >= (Number.isNaN(since) ? 0 : since) && st.size >= minBytes) {
          if (!best || st.mtimeMs > best.mtime) best = { path: p, size: st.size, mtime: st.mtimeMs };
        }
      } catch {
        continue;
      }
    }
    if (best) {
      // Settle check: size stable across 1.5s means the download finished.
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const st2 = await stat(best.path);
        if (st2.size === best.size) return { path: best.path, size: best.size };
      } catch {
        continue;
      }
    }
    if (Date.now() > deadline) throw new Error("no completed download appeared in 90s");
    await new Promise((r) => setTimeout(r, 2000));
  }
}
