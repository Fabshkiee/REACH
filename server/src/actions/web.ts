import { z } from "zod";
import { defineAction } from "../executor/registry.js";
import { callAgent } from "./agent.js";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
];

export const WebSearchSchema = z.object({
  query: z.string().min(1).max(500).describe("Search query terms"),
  mode: z.enum(["text", "image"]).default("text").describe("Search mode: 'text' for web pages or 'image' for direct photo/image URLs"),
  limit: z.number().int().min(1).max(20).default(5).describe("Maximum number of results to return (1-20, default 5)"),
});

export type WebSearchInput = z.input<typeof WebSearchSchema>;

export interface WebSearchTextResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchImageResult {
  title: string;
  imageUrl: string;
  sourceUrl: string;
  thumbnail?: string;
}

export interface WebSearchResult {
  ok: true;
  query: string;
  mode: "text" | "image";
  count: number;
  results: Array<WebSearchTextResult | WebSearchImageResult>;
}

export const DownloadAssetActionSchema = z.object({
  url: z.string().url().max(2000).describe("HTTP(S) URL of the asset to download"),
  destinationDir: z.string().min(1).max(500).optional().default("Downloads/REACH")
    .describe("Folder to store downloaded asset. Defaults to Downloads/REACH"),
  filename: z.string().min(1).max(200).optional()
    .describe("Optional target filename. If omitted, derived from URL/headers and sanitized"),
  allowedMimes: z.array(z.string().min(1)).optional()
    .describe("Optional restrict list of allowed MIME types (e.g. ['image/jpeg', 'image/png'])"),
});

export type DownloadAssetActionInput = z.input<typeof DownloadAssetActionSchema>;

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripHtmlTags(str: string): string {
  return decodeHtmlEntities(str.replace(/<[^>]+>/g, "")).trim();
}

function extractDestinationUrl(rawHref: string): string {
  try {
    const u = new URL(rawHref, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : rawHref;
  } catch {
    return rawHref;
  }
}

/**
 * Nova tool schemas carry no object type, so a map or a JSON body travels as
 * a JSON string. Decode it back to an object when it parses; leave anything
 * else (a plain text body) exactly as it is.
 */
function parseJsonMaybe(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/**
 * Execute web search via DuckDuckGo without external paid API keys.
 * Text mode uses DuckDuckGo HTML scraper.
 * Image mode uses DuckDuckGo VQD + /i.js JSON endpoint.
 */
export async function webSearch(input: WebSearchInput): Promise<WebSearchResult> {
  const parsed = WebSearchSchema.parse(input);

  if (parsed.mode === "image") {
    // 1. Image Search: Extract VQD verification token
    const vqdUrl = `https://duckduckgo.com/?q=${encodeURIComponent(parsed.query)}&iax=images&ia=images`;
    const ctrl1 = new AbortController();
    const timer1 = setTimeout(() => ctrl1.abort(), 15_000);
    let vqdRes: Response;
    try {
      vqdRes = await fetch(vqdUrl, {
        headers: {
          "User-Agent": USER_AGENTS[0]!,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: ctrl1.signal,
      });
    } finally {
      clearTimeout(timer1);
    }

    if (!vqdRes.ok) {
      throw new Error(`DuckDuckGo image search init returned HTTP ${vqdRes.status}`);
    }

    const html = await vqdRes.text();
    const vqdMatch =
      html.match(/vqd=([0-9-]+)/) ??
      html.match(/vqd=[\"']([0-9-]+)[\"']/) ??
      html.match(/vqd:\s*[\"']([0-9-]+)[\"']/);

    if (!vqdMatch) {
      throw new Error("Failed to extract DuckDuckGo search verification token (vqd)");
    }
    const vqd = vqdMatch[1];

    // 2. Fetch images JSON with required AJAX headers
    const imgApiUrl = `https://duckduckgo.com/i.js?l=wt-wt&o=json&q=${encodeURIComponent(parsed.query)}&vqd=${vqd}&f=,,,&p=1`;
    const ctrl2 = new AbortController();
    const timer2 = setTimeout(() => ctrl2.abort(), 15_000);
    let imgRes: Response;
    const cookieHeader = vqdRes.headers.get("set-cookie");
    try {
      imgRes = await fetch(imgApiUrl, {
        headers: {
          "User-Agent": USER_AGENTS[0]!,
          Referer: "https://duckduckgo.com/",
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Accept-Language": "en-US,en;q=0.9",
          "X-Requested-With": "XMLHttpRequest",
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        signal: ctrl2.signal,
      });
    } finally {
      clearTimeout(timer2);
    }

    if (!imgRes.ok) {
      throw new Error(`DuckDuckGo image API returned HTTP ${imgRes.status}`);
    }

    const data = (await imgRes.json().catch(() => ({}))) as {
      results?: Array<{
        title?: string;
        image?: string;
        url?: string;
        thumbnail?: string;
      }>;
    };

    const rawList = Array.isArray(data.results) ? data.results : [];
    const results: WebSearchImageResult[] = [];

    for (const item of rawList) {
      if (item.image && /^https?:\/\//i.test(item.image)) {
        results.push({
          title: stripHtmlTags(item.title ?? "Image"),
          imageUrl: item.image,
          sourceUrl: item.url ?? item.image,
          ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}),
        });
      }
      if (results.length >= parsed.limit) break;
    }

    return {
      ok: true,
      query: parsed.query,
      mode: "image",
      count: results.length,
      results,
    };
  }

  // Text Mode: DuckDuckGo HTML with resilient User-Agent fallback
  const textUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(parsed.query)}`;
  let html = "";
  let lastStatus = 0;

  for (const ua of USER_AGENTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(textUrl, {
        headers: {
          "User-Agent": ua,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: ctrl.signal,
      });
      lastStatus = res.status;
      if (res.ok) {
        const text = await res.text();
        const hasResults = /web-result|result__a/i.test(text);
        html = text;
        if (hasResults) break;
      }
    } catch {
      // Continue to next UA on network failure
    } finally {
      clearTimeout(timer);
    }
  }

  if (!html && lastStatus !== 200) {
    throw new Error(`DuckDuckGo text search returned HTTP ${lastStatus || 500}`);
  }
  const results: WebSearchTextResult[] = [];

  // Match structured web results from DuckDuckGo HTML
  const webResultRegex =
    /<div[^>]+class="[^"]*web-result[^"]*"[^>]*>.*?<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>.*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>(.*?)<\/a>/gs;
  const matches = [...html.matchAll(webResultRegex)];

  if (matches.length > 0) {
    for (const m of matches) {
      const rawHref = m[1] ?? "";
      const rawTitle = m[2] ?? "";
      const rawSnippet = m[3] ?? "";
      const url = extractDestinationUrl(rawHref);
      const title = stripHtmlTags(rawTitle);
      const snippet = stripHtmlTags(rawSnippet);

      if (url && title) {
        results.push({ title, url, snippet });
      }
      if (results.length >= parsed.limit) break;
    }
  } else {
    // Fallback: extract links and snippets independently
    const linkMatches = [...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs)];
    const snippetMatches = [...html.matchAll(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>(.*?)<\/a>/gs)];

    const count = Math.min(linkMatches.length, parsed.limit);
    for (let i = 0; i < count; i++) {
      const lm = linkMatches[i];
      if (!lm) continue;
      const rawHref = lm[1] ?? "";
      const rawTitle = lm[2] ?? "";
      const rawSnippet = snippetMatches[i] ? snippetMatches[i]![1] ?? "" : "";
      const url = extractDestinationUrl(rawHref);
      const title = stripHtmlTags(rawTitle);
      const snippet = stripHtmlTags(rawSnippet);

      if (url && title) {
        results.push({ title, url, snippet });
      }
    }
  }

  // Resilient fallback to DuckDuckGo lite endpoint if HTML scraping produced no results
  if (results.length === 0) {
    try {
      const liteCtrl = new AbortController();
      const liteTimer = setTimeout(() => liteCtrl.abort(), 10_000);
      try {
        const liteRes = await fetch("https://lite.duckduckgo.com/lite/", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENTS[0]!,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          body: `q=${encodeURIComponent(parsed.query)}`,
          signal: liteCtrl.signal,
        });
        if (liteRes.ok) {
          const liteHtml = await liteRes.text();
          const linkMatches = [
            ...liteHtml.matchAll(/<a[^>]*class=['"]result-link['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi),
            ...liteHtml.matchAll(/<a\s+[^>]*?href=['"]([^'"]+)['"][^>]*?class=['"]result-link['"][^>]*?>([\s\S]*?)<\/a>/gi),
          ];
          const snippetMatches = [...liteHtml.matchAll(/<td\s+[^>]*?class=['"]result-snippet['"][^>]*?>([\s\S]*?)<\/td>/gi)];
          const count = Math.min(linkMatches.length, parsed.limit);
          for (let i = 0; i < count; i++) {
            const lm = linkMatches[i];
            if (!lm) continue;
            const url = extractDestinationUrl(lm[1] ?? "");
            const title = stripHtmlTags(lm[2] ?? "");
            const snippet = stripHtmlTags(snippetMatches[i] ? snippetMatches[i]![1] ?? "" : "");
            if (url && title) {
              results.push({ title, url, snippet });
            }
            if (results.length >= parsed.limit) break;
          }
        }
      } finally {
        clearTimeout(liteTimer);
      }
    } catch {
      // Non-fatal fallback attempt
    }
  }

  // An empty result set from a live engine is NOT a successful search: it
  // means the request was rate-limited or bot-challenged. Reporting
  // ok:true with zero results would tell the planner "I looked and there is
  // nothing there" — a confident falsehood. Fail honestly instead.
  if (results.length === 0) {
    throw new Error(
      `web.search returned no results for "${parsed.query}" — the search engine most likely rate-limited or bot-challenged the request. Do not conclude the topic does not exist; retry once, narrow the query, or use browser.* / web.request instead.`,
    );
  }

  return {
    ok: true,
    query: parsed.query,
    mode: "text",
    count: results.length,
    results,
  };
}

export { webSearch as search };

/**
 * Register web actions in the server executor registry.
 * Registers:
 * - web.search (actionClass: "search")
 * - web.download_asset (actionClass: "download")
 */
export function registerWebActions(): void {
  try {
    defineAction({
      name: "web.search",
      actionClass: "search",
      description:
        "Search the web for information or images using DuckDuckGo without requiring external paid API keys. Mode 'text' returns web page titles, snippets, and URLs; mode 'image' returns titles, direct image URLs, and source URLs.",
      schema: WebSearchSchema,
      timeoutMs: 30_000,
      targetOf: (args) => (typeof args["query"] === "string" ? args["query"] : undefined),
      verify: (result) => {
        const r = result as { ok?: unknown; results?: unknown[]; query?: unknown; mode?: unknown };
        if (!r || typeof r !== "object" || r.ok !== true || !Array.isArray(r.results)) {
          throw new Error("web.search did not return a valid result object");
        }
        return `web.search ok: found ${r.results.length} ${String(r.mode ?? "text")} results for "${String(r.query ?? "")}"`;
      },
      handler: async (args) => webSearch(args as WebSearchInput),
    });
  } catch {
    // Already registered (dev re-entry)
  }

  try {
    defineAction({
      name: "web.download_asset",
      actionClass: "download",
      description:
        "Download a media asset or file from a URL to local storage (Downloads/REACH or Documents/REACH) with 50MB ceiling, MIME validation, and file verification.",
      schema: DownloadAssetActionSchema,
      timeoutMs: 60_000,
      targetOf: (args) => (typeof args["destinationDir"] === "string" ? args["destinationDir"] : "Downloads/REACH"),
      verify: (result) => {
        const r = result as { ok?: unknown; error?: unknown; path?: unknown; size?: unknown; verified?: unknown };
        if (!r || typeof r !== "object" || r.ok !== true) {
          throw new Error(typeof r?.error === "string" ? r.error : "download_asset did not report ok");
        }
        return `download_asset ok: saved to ${String(r.path)} (${String(r.size)} bytes, verified)`;
      },
      handler: async (args) => callAgent("download_asset", args),
    });
  } catch {
    // Already registered (dev re-entry)
  }

  try {
    defineAction({
      name: "web.request",
      actionClass: "interact",
      description:
        "Send an HTTP request to any external REST API or webhook (e.g. Discord webhook, Slack incoming webhook, IFTTT, Zapier, or custom HTTP endpoint). Supports GET, POST, PUT, DELETE with headers and JSON/text body.",
      schema: z.object({
        url: z.string().url().max(2000).describe("HTTP(S) URL to request"),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET").describe("HTTP method (default GET)"),
        // Nova tool schemas have no object type, so the converter advertises
        // these two fields as STRINGS. The validator must therefore accept a
        // JSON string as well as the object form — otherwise the model is
        // told to send something the executor rejects.
        headers: z
          .union([z.record(z.string()), z.string()])
          .optional()
          .describe("Optional HTTP headers — a JSON object, or a JSON-encoded string"),
        body: z
          .union([z.string(), z.record(z.unknown())])
          .optional()
          .describe("Optional request body — raw text, a JSON object, or a JSON-encoded string"),
        timeoutMs: z.number().int().positive().max(60_000).optional().default(15_000),
      }),
      timeoutMs: 30_000,
      targetOf: (args) => (typeof args["url"] === "string" ? args["url"] : undefined),
      verify: (result) => {
        const r = result as { ok?: unknown; status?: unknown };
        if (!r || typeof r !== "object" || r.ok !== true) {
          throw new Error("web.request did not succeed");
        }
        return `web.request ok: HTTP ${String(r.status ?? "200")}`;
      },
      handler: async (args) => {
        const url = String(args["url"]);
        const method = String(args["method"] ?? "GET").toUpperCase();
        const timeout = Number(args["timeoutMs"] ?? 15_000);
        // Nova tool schemas carry objects as JSON strings, so a JSON-encoded
        // map arrives here as a string. Normalise before use.
        const rawHeaders = parseJsonMaybe(args["headers"]);
        const headers: Record<string, string> = {
          "user-agent": "REACH-Agent/1.0",
          ...(rawHeaders && typeof rawHeaders === "object" ? (rawHeaders as Record<string, string>) : {}),
        };
        let body: string | undefined;
        if (args["body"] !== undefined && method !== "GET") {
          const parsedBody = parseJsonMaybe(args["body"]);
          if (typeof parsedBody === "string") {
            body = parsedBody;
          } else {
            body = JSON.stringify(parsedBody);
            if (!headers["content-type"]) headers["content-type"] = "application/json";
          }
        }
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeout);
        try {
          const res = await fetch(url, { method, headers, body, signal: ctrl.signal });
          const text = await res.text();
          let data: unknown = text;
          try {
            data = JSON.parse(text);
          } catch {
            // Keep as string
          }
          return {
            ok: res.ok,
            status: res.status,
            statusText: res.statusText,
            data,
          };
        } finally {
          clearTimeout(t);
        }
      },
    });
  } catch {
    // Already registered (dev re-entry)
  }
}

