import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

/**
 * Agent-side path guard (defense in depth behind core policy).
 *
 * Design correction: this used to cage everything to the user profile, which
 * made the core's "outside user space → confirm" verdict unexecutable — no
 * confirmed action could ever run. The agent now enforces DENY patterns only
 * (system locations, other users' data, secret material), exactly like the
 * core. Ordinary locations on any drive — O:\Downloads included — pass here;
 * risk judgment stays with core policy + user approval.
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

/** Resolve `target` (absolute wins, relative resolves against `base`). */
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

function windowsDenyRoots(): string[] {
  const roots: string[] = [];
  const sys = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  roots.push(sys);
  if (process.env.ProgramFiles) roots.push(process.env.ProgramFiles);
  if (process.env["ProgramFiles(x86)"]) roots.push(process.env["ProgramFiles(x86)"]);
  if (process.env.ProgramData) roots.push(process.env.ProgramData);
  return roots.map(lower);
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
 * Assert a path is operable: resolved (traversal collapsed), outside system
 * roots, outside other users' trees, and clear of secret material. Anything
 * else — any drive, any user-owned folder — is allowed through; risk calls
 * belong to core policy and user approval, not to this gate.
 */
export function assertAllowedPath(input: string, base = userRoot()): string {
  if (!input || typeof input !== "string" || input.length > 2000 || input.includes("\0")) {
    throw new Error("invalid path: empty, non-string, or too long");
  }
  const abs = resolve(base, input);
  const t = lower(abs);

  for (const root of windowsDenyRoots()) {
    const edge = root.endsWith("\\") ? root : root + "\\";
    if (t === root || t.startsWith(edge)) throw new Error(`refused: system location "${root}"`);
  }

  const usersDir = lower(resolve(join(userRoot(), "..")));
  const mine = lower(resolve(userRoot()));
  if (t.startsWith(usersDir + sep) && !(t === mine || t.startsWith(mine + sep))) {
    throw new Error("refused: another user's data");
  }

  const hit = secretHit(abs);
  if (hit) throw new Error(`refused: target involves ${hit}`);
  return abs;
}
