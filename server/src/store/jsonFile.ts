import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Synchronous atomic JSON file helpers. Sync is deliberate: REACH Core is a
 * single-user local bridge and these files are kilobytes — sync keeps every
 * caller deterministic (no half-written state across awaits) with zero deps.
 * Writes go to a sibling temp file + rename, so a crash can never leave a
 * torn document behind.
 */
export function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  renameSync(tmp, path);
}

export function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function listJsonBasenames(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

/** Root for all runtime state. Overridable per-env (tests point it at a temp dir). */
export function dataDir(): string {
  return process.env.REACH_DATA_DIR ?? join(process.cwd(), "data");
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
