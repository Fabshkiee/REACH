import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ActionClass, PolicyContext, PolicyDecision, ProposedAction } from "./types.js";

export function defaultPolicyContext(): PolicyContext {
  const root = homedir();
  return {
    userRoot: root,
    workDir: process.env.REACH_WORK_DIR ?? join(root, "Documents", "REACH"),
  };
}

/** Lexical normalization for policy comparison (no fs access — pure). */
export function normalizeTarget(target: string): string {
  return target.replace(/\//g, "\\").replace(/\0/g, "").trim().toLowerCase();
}

/** True when `target` stays inside `root` after resolving `..` lexically. */
export function isWithinRoot(root: string, target: string): boolean {
  const r = normalizeTarget(resolve(root));
  const t = normalizeTarget(resolve(root, target));
  return t === r || t.startsWith(r.endsWith("\\") ? r : r + "\\");
}

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

function windowsDenyRoots(): string[] {
  const roots: string[] = [];
  const sys = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  roots.push(sys);
  if (process.env.ProgramFiles) roots.push(process.env.ProgramFiles);
  if (process.env["ProgramFiles(x86)"]) roots.push(process.env["ProgramFiles(x86)"]);
  if (process.env.ProgramData) roots.push(process.env.ProgramData);
  return roots.map(normalizeTarget);
}

function hitsSecretLocation(target: string): string | undefined {
  const t = normalizeTarget(target);
  const segments = t.split("\\").filter(Boolean);
  const base = segments[segments.length - 1] ?? "";
  if (SECRET_BASENAMES.has(base)) return `secret filename "${base}"`;
  const dot = base.lastIndexOf(".");
  if (dot > 0 && SECRET_EXTENSIONS.has(base.slice(dot))) return `secret file type "${base.slice(dot)}"`;
  for (const seg of segments) {
    if (SECRET_DIR_SEGMENTS.has(seg)) return `credential directory "${seg}"`;
  }
  return undefined;
}

function hitsSystemRoot(target: string, ctx: PolicyContext): string | undefined {
  const t = normalizeTarget(target);
  void ctx;
  for (const root of windowsDenyRoots()) {
    if (t === root || t.startsWith(root.endsWith("\\") ? root : root + "\\")) {
      return `system location "${root}"`;
    }
  }
  // Another user's profile: under C:\Users\<someone-else>.
  const usersDir = normalizeTarget(dirname(ctx.userRoot));
  const mine = normalizeTarget(ctx.userRoot);
  if (t.startsWith(usersDir + "\\") && !(t === mine || t.startsWith(mine + "\\"))) {
    return "another user's data";
  }
  return undefined;
}

const ALWAYS_CONFIRM: ReadonlySet<ActionClass> = new Set([
  "delete",
  "send",
  "publish",
  "purchase",
  "configure",
]);

/**
 * Risk × target × scope × intent. Pure function — no I/O, fully unit-testable.
 * Order: structural denies first, then class defaults, then clarity escalation.
 */
export function classify(action: ProposedAction, ctx: PolicyContext = defaultPolicyContext()): PolicyDecision {
  const rawTarget = (action.target ?? "").trim();
  // Resolve first (against userRoot) so `..\..` escapes are judged by where
  // they LAND, not by how they're spelled. resolve() handles absolute targets.
  const target = rawTarget ? normalizeTarget(resolve(ctx.userRoot, rawTarget)) : "";

  const secret = target ? hitsSecretLocation(target) : undefined;
  if (secret) {
    return {
      verdict: "deny",
      reason: "deny.secret-location",
      message: `Refused: target involves ${secret}. Credentials and browser profiles are never readable by policy.`,
    };
  }
  const system = target ? hitsSystemRoot(target, ctx) : undefined;
  if (system) {
    return {
      verdict: "deny",
      reason: "deny.protected-location",
      message: `Refused: ${system} is outside user-owned space.`,
    };
  }

  switch (action.actionClass) {
    case "observe":
    case "search":
    case "read":
    case "ask":
      return { verdict: "allow", reason: "allow.read-only", message: "Read-only observation; allowed." };

    case "write":
    case "move":
    case "download":
    case "interact": {
      if (!target) {
        return {
          verdict: "confirm",
          reason: "confirm.missing-target",
          message: "Confirmation needed: this action names no target to judge.",
        };
      }
      if (action.actionClass === "interact" && action.args["submit"] === true) {
        return {
          verdict: "confirm",
          reason: "confirm.submit-action",
          message: `Confirmation needed: interacting with "${action.target}" submits or changes data. Confirm the exact payload.`,
        };
      }
      const home = isWithinRoot(ctx.userRoot, target) || isWithinRoot(ctx.workDir, target);
      if (!home) {
        return {
          verdict: "confirm",
          reason: "confirm.outside-user-space",
          message: `Confirmation needed: "${action.target}" is outside the usual user space. Confirm the exact destination.`,
        };
      }
      if ((action.clarity ?? 1) < 0.35) {
        return {
          verdict: "confirm",
          reason: "confirm.unclear-intent",
          message: "Confirmation needed: the intent behind this action is ambiguous.",
        };
      }
      return { verdict: "allow", reason: "allow.user-owned", message: "User-owned target with clear intent; allowed." };
    }

    case "launch": {
      const name = (action.target ?? "").trim().toLowerCase();
      if (name && ctx.knownApps?.includes(name)) {
        return { verdict: "allow", reason: "allow.known-app", message: `Known-safe application "${action.target}"; allowed.` };
      }
      return {
        verdict: "confirm",
        reason: "confirm.unknown-binary",
        message: `Confirmation needed: "${action.target ?? "unnamed program"}" is not a known-safe application. Confirm the exact program.`,
      };
    }

    default: {
      // delete / send / publish / purchase / configure — consequential by class.
      if (ALWAYS_CONFIRM.has(action.actionClass)) {
        return {
          verdict: "confirm",
          reason: `confirm.consequential-${action.actionClass}`,
          message: `Confirmation needed: ${action.actionClass} is consequential and needs explicit approval.`,
        };
      }
      return { verdict: "deny", reason: "deny.unknown-class", message: "Refused: unknown action class." };
    }
  }
}

/** Who the local user is (for audit lines, not for authorization). */
export function localUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return "unknown";
  }
}
