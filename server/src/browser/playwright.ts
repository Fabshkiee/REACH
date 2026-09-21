import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { defaultPolicyContext } from "../policy/engine.js";
import { dataDir } from "../store/jsonFile.js";

/** Resolved CLI entry of the pinned dependency — spawned with node directly. */
function playwrightMcpCli(): string {
  const req = createRequire(import.meta.url);
  const pkgPath = req.resolve("@playwright/mcp/package.json");
  return join(dirname(pkgPath), "cli.js");
}

export const PLAYWRIGHT_MCP_VERSION = "0.0.82";
export const PLAYWRIGHT_MCP_PORT = Number(process.env.PLAYWRIGHT_MCP_PORT ?? 8931);

/**
 * Planner-visible browser tools. Everything else the upstream ships —
 * evaluate, run_code_unsafe, routing, uploads, screenshots, config — is
 * structurally unreachable: callTool refuses before any subprocess exists.
 */
const ALLOWED_TOOLS = new Set([
  "browser_navigate",
  "browser_snapshot",
  "browser_find",
  "browser_click",
  "browser_type",
  "browser_select_option",
  "browser_press_key",
  "browser_wait_for",
  "browser_tabs",
]);

const NEVER_TOOLS = [/evaluate/i, /run_code/i, /route/i, /cookie/i, /config/i, /upload/i, /drop/i, /dialog/i];

export function assertToolAllowed(name: string): void {
  if (!ALLOWED_TOOLS.has(name)) {
    throw new Error(`browser tool "${name}" is not planner-visible (whitelist of ${ALLOWED_TOOLS.size})`);
  }
  for (const pattern of NEVER_TOOLS) {
    if (pattern.test(name)) throw new Error(`browser tool "${name}" is structurally banned`);
  }
}

export function browserProfileDir(): string {
  const dir = join(dataDir(), "browser-profile");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Auto-named browser outputs land in USER space (Documents/REACH), never in
 * repo dirs — so policy judges downloads as ordinary user-owned writes and
 * the user can always find their files. Same dir the fetch_download def polls.
 */
export function browserOutputDir(): string {
  const dir = join(defaultPolicyContext().workDir, "browser-downloads");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function serverUrl(port: number): string {
  return `http://localhost:${port}/mcp`;
}

async function waitForPort(port: number, timeoutMs = 180_000): Promise<void> {
  // NOTE: hostname "localhost", not 127.0.0.1 — the upstream server binds
  // IPv6 loopback (::1) on Windows, and a literal IPv4 probe never connects.
  const { connect } = await import("node:net");
  const start = Date.now();
  for (;;) {
    const open = await new Promise<boolean>((resolve) => {
      const s = connect({ host: "localhost", port, timeout: 2000 });
      s.once("connect", () => {
        s.end();
        resolve(true);
      });
      s.once("timeout", () => {
        s.destroy();
        resolve(false);
      });
      s.once("error", () => resolve(false));
    });
    if (open) return;
    if (Date.now() - start > timeoutMs) throw new Error(`playwright-mcp did not listen on :${port} in time`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * Managed Playwright MCP subprocess + client. Lazy singleton: starts on first
 * planner-visible call, stops with the core (or via stop() in tests).
 * Headed mode (for the one-time login) via PLAYWRIGHT_HEADED=1.
 */
class PlaywrightMcp {
  private proc: ChildProcess | undefined;
  private client: Client | undefined;
  private starting: Promise<Client> | undefined;
  private readonly port = PLAYWRIGHT_MCP_PORT;

  /** Boot budget lives here, not in call timeouts: first use is slow (browser
   *  launch), steady-state calls are fast. Concurrent callers share one boot. */
  async ensure(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.starting) {
      this.starting = this.boot().finally(() => {
        this.starting = undefined;
      });
    }
    return this.starting;
  }

  private async boot(): Promise<Client> {
    mkdirSync(browserProfileDir(), { recursive: true });
    mkdirSync(browserOutputDir(), { recursive: true });
    // Spawned with node directly (never cmd/npx shims): no shell exists in
    // this path at all. All argv are operator-controlled constants/paths.
    const args = [
      playwrightMcpCli(),
      "--port",
      String(this.port),
      "--user-data-dir",
      browserProfileDir(),
      "--output-dir",
      browserOutputDir(),
    ];
    if (process.env.PLAYWRIGHT_HEADED !== "1") args.push("--headless");
    this.proc = spawn(process.execPath, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    // Drain both streams: undrained pipes would backpressure a long-lived
    // server, and the stderr tail turns silent boot failures into messages.
    let stderrTail = "";
    this.proc.stdout?.on("data", () => {});
    this.proc.stderr?.on("data", (d) => {
      stderrTail = (stderrTail + String(d)).slice(-2000);
    });
    this.proc.once("error", (err) => {
      console.error(`[browser] playwright-mcp spawn failed: ${err.message}`);
      this.proc = undefined;
      this.client = undefined;
    });
    this.proc.unref?.();
    try {
      await waitForPort(this.port);
      const client = new Client({ name: "reach-browser", version: "0.1.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl(this.port))));
      this.client = client;
      return client;
    } catch (err) {
      this.proc?.kill();
      this.proc = undefined;
      const tail = stderrTail.trim() ? ` server said: ${stderrTail.trim().split("\n").pop()}` : "";
      throw new Error(`${err instanceof Error ? err.message : err}.${tail}`);
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    assertToolAllowed(name);
    const client = await this.ensure();
    const res = await client.callTool({ name, arguments: args });
    return res;
  }

  async listUpstreamTools(): Promise<string[]> {
    const client = await this.ensure();
    const { tools } = await client.listTools();
    return tools.map((t) => t.name);
  }

  async stop(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      // already gone
    }
    this.client = undefined;
    this.proc?.kill();
    this.proc = undefined;
  }
}

export const playwrightMcp = new PlaywrightMcp();
