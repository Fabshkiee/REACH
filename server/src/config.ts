import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export class ConfigurationError extends Error {
  readonly fix: string;
  constructor(message: string, fix: string) {
    super(message);
    this.name = "ConfigurationError";
    this.fix = fix;
  }
}

/** Repo root regardless of whether we run from server/, repo root, or dist/. */
function findRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "server"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

let loaded = false;

/**
 * Load `<repo>/.env` once. Shell environment always wins — .env only fills
 * blanks. Safe to call repeatedly; never throws, never logs values.
 */
export function loadEnv(cwd = process.cwd()): { path?: string; keys: string[] } {
  if (loaded) return { keys: [] };
  loaded = true;
  const root = findRoot(cwd);
  const path = join(root, ".env");
  if (!existsSync(path)) return { keys: [] };
  let parsed: Record<string, string> = {};
  try {
    parsed = parseDotEnv(readFileSync(path, "utf8"));
  } catch {
    return { path, keys: [] };
  }
  const keys: string[] = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined && v !== "") {
      process.env[k] = v;
      keys.push(k);
    }
  }
  return { path, keys };
}

/** Fail-closed gate for the core<->agent channel. Test env is exempt. */
export function requireAgentToken(service: string): string {
  const token = process.env.AGENT_TOKEN;
  if (token) return token;
  if (process.env.NODE_ENV === "test") return "test-token";
  console.error(
    `[${service}] FATAL: AGENT_TOKEN is not set. Refusing to boot with an unauthenticated device channel.\n` +
      `Fix: generate one — node -e "console.log(require('crypto').randomBytes(24).toString('hex'))" —\n` +
      `then set the SAME value for the server and the agent (shell env or repo-root .env). See .env.example.`,
  );
  process.exit(1);
}

/** Bedrock availability for live planning. Throws ConfigurationError (never silent). */
export function requireBedrockConfig(): { region: string; modelId: string } {
  const missing: string[] = [];
  if (!process.env.AWS_ACCESS_KEY_ID) missing.push("AWS_ACCESS_KEY_ID");
  if (!process.env.AWS_SECRET_ACCESS_KEY) missing.push("AWS_SECRET_ACCESS_KEY");
  if (missing.length > 0) {
    throw new ConfigurationError(
      `Bedrock not configured: missing ${missing.join(", ")}.`,
      "Put AWS keys in repo-root .env (see .env.example) or export them. Live planning is unavailable until then — tasks fail quoted, never faked.",
    );
  }
  return {
    region: process.env.AWS_REGION ?? "us-east-1",
    modelId: process.env.BEDROCK_MODEL_ID ?? "amazon.nova-pro-v1:0",
  };
}

export function serviceFileDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}
