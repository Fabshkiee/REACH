import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Minimal twin of the core's env loader (separate package, no shared code).
 * Same semantics: repo-root `.env` fills blanks, shell wins, values never logged.
 */
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

let loaded = false;
export function loadEnv(cwd = process.cwd()): void {
  if (loaded) return;
  loaded = true;
  const path = join(findRoot(cwd), ".env");
  if (!existsSync(path)) return;
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const k = t.slice(0, t.indexOf("=")).trim();
    let v = t.slice(t.indexOf("=") + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined && v !== "") process.env[k] = v;
  }
}

/** Fail-closed gate: no token, no boot (test env exempt). */
export function requireAgentToken(): string {
  const token = process.env.AGENT_TOKEN;
  if (token) return token;
  if (process.env.NODE_ENV === "test") return "test-token";
  console.error(
    "[agent] FATAL: AGENT_TOKEN is not set. Refusing to boot with an unauthenticated device channel.\n" +
      `Fix: generate one — node -e "console.log(require('crypto').randomBytes(24).toString('hex'))" —\n` +
      "then set the SAME value for the server and the agent (shell env or repo-root .env). See .env.example.",
  );
  process.exit(1);
}
