import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

/**
 * Agent-side path guard. Mirrors the core policy's intent as defense in depth:
 * the agent never trusts the core's judgment alone — every file operation
 * re-validates here. Must stay inside the user's profile, outside secret and
 * system locations, with `..` resolved before judging.
 */
const SECRET_BASENAMES = new Set([
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  ".env",
  "ntuser.dat",
  "login data",
  "logins.json",
  "cookies",
  "credentials.json",
]);
const SECRET_EXTENSIONS = new Set([".pem", ".key", ".pfx", ".p12"]);
const SECRET_DIR_SEGMENTS = new Set([".ssh", "gnupg", "user data", "mozilla"]);

function lower(p: string): string {
  return p.replace(/\//g, "\\").toLowerCase();
}

function segments(p: string): string[] {
  return lower(p).split("\\").filter(Boolean);
}

export function userRoot(): string {
  return process.env.REACH_USER_ROOT ?? homedir();
}

/** Resolve `target` (absolute or relative to `base`) and confine it to `root`. */
export function resolveWithin(root: string, target: string, base = root): string {
  const abs = resolve(base, target);
  const r = lower(resolve(root));
  const t = lower(abs);
  const edge = r.endsWith("\\") ? r : r + "\\";
  if (t !== r && !t.startsWith(edge)) {
    throw new Error(`path escapes allowed root: ${target}`);
  }
  return abs;
}

function secretHit(abs: string): string | undefined {
  const segs = segments(abs);
  const base = segs[segs.length - 1] ?? "";
  if (SECRET_BASENAMES.has(base)) return `secret filename "${base}"`;
  const dot = base.lastIndexOf(".");
  if (dot > 0 && SECRET_EXTENSIONS.has(base.slice(dot))) return `secret file type "${base.slice(dot)}"`;
  for (const seg of segs) {
    if (SECRET_DIR_SEGMENTS.has(seg)) return `credential directory "${seg}"`;
  }
  return undefined;
}

/**
 * Assert a path is operable: inside the user profile, not a secret location,
 * not another user's tree, not a system root. Throws with a clear reason.
 */
export function assertAllowedPath(input: string, base = userRoot()): string {
  if (!input || typeof input !== "string" || input.length > 2000 || input.includes("\0")) {
    throw new Error("invalid path: empty, non-string, or too long");
  }
  const root = resolve(userRoot());
  // resolve() lets absolute targets win; confinement below judges the result.
  const abs = resolveWithin(root, input, base);
  const hit = secretHit(abs);
  if (hit) throw new Error(`refused: target involves ${hit}`);
  const usersDir = lower(resolve(join(root, "..")));
  const mine = lower(root);
  const t = lower(abs);
  if (t.startsWith(usersDir + sep) && !(t === mine || t.startsWith(mine + sep))) {
    throw new Error("refused: another user's data");
  }
  return abs;
}
