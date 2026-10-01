/**
 * `npm run doctor` — preflight for humans. Zero dependencies, exit code tells
 * scripts everything: 0 = ready, 1 = something to fix (each line says what).
 * Never prints secret VALUES, only presence.
 */
import { connect } from "node:net";
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

let failures = 0;
function finish(): never {
  console.log(
    failures === 0
      ? "\nReady. Boot with: npm run dev:server  +  npm run dev:agent"
      : `\n${failures} check(s) failing — fix the lines above, then re-run.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}
function record(name: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  check(name, ok, detail);
}

const major = Number(process.versions.node.split(".")[0]);
record("node >= 24", major >= 24, `node v${process.versions.node}`);

const root = process.cwd().endsWith("server") ? join(process.cwd(), "..") : process.cwd();
const envPath = join(root, ".env");
record(".env present", existsSync(envPath), existsSync(envPath) ? envPath : "missing — copy .env.example to .env");
record(".env.example present", existsSync(join(root, ".env.example")), join(root, ".env.example"));

const env: Record<string, string | undefined> = { ...process.env };
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const k = t.slice(0, t.indexOf("=")).trim();
    if ((!env[k] || env[k] === "") && k) {
      env[k] = t
        .slice(t.indexOf("=") + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  }
}

const presence = (v: string | undefined) => (v ? `set (${v.length} chars)` : "MISSING");
record("AGENT_TOKEN set", !!env["AGENT_TOKEN"], presence(env["AGENT_TOKEN"]));
record("AWS_ACCESS_KEY_ID set", !!env["AWS_ACCESS_KEY_ID"], presence(env["AWS_ACCESS_KEY_ID"]));
record("AWS_SECRET_ACCESS_KEY set", !!env["AWS_SECRET_ACCESS_KEY"], presence(env["AWS_SECRET_ACCESS_KEY"]));
record("AWS_REGION", true, env["AWS_REGION"] ?? "unset (defaults to us-east-1)");
record("BEDROCK_MODEL_ID", true, env["BEDROCK_MODEL_ID"] ?? "unset (defaults to amazon.nova-pro-v1:0)");

const dataDir = env["REACH_DATA_DIR"] ?? join(process.cwd(), "data");
let writable = false;
try {
  mkdirSync(dataDir, { recursive: true });
  accessSync(dataDir, constants.W_OK);
  writable = true;
} catch {
  writable = false;
}
record("data dir writable", writable, dataDir);

async function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ host: "127.0.0.1", port, timeout: 1500 });
    s.once("connect", () => {
      s.end();
      resolve(false);
    });
    s.once("timeout", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(true));
  });
}

const corePort = Number(env["PORT"] ?? 3000);
const agentPort = Number(env["AGENT_PORT"] ?? 3001);
const coreFree = await portFree(corePort);
const agentFree = await portFree(agentPort);
record(
  `port ${corePort} free (core)`,
  coreFree,
  coreFree ? "free" : "HELD — another server is running (or stale). Kill it before verifying.",
);
record(
  `port ${agentPort} free (agent)`,
  agentFree,
  agentFree ? "free" : "HELD — another agent is running (or stale). Kill it before verifying.",
);

finish();
