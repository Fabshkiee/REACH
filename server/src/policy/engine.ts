import { homedir, userInfo } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";
import type { ActionClass, PolicyContext, PolicyDecision, ProposedAction } from "./types.js";

export function defaultPolicyContext(): PolicyContext {
  const root = homedir();
  return {
    userRoot: root,
    workDir: process.env.REACH_WORK_DIR ?? join(root, "Documents", "REACH"),
  };
}

/** Windows drive-letter absolute path: "C:\Users\x" or "C:/Users/x". */
const DRIVE_ABS = /^[a-zA-Z]:[\\/]/;

/**
 * Lexical normalization for policy comparison (no fs access — pure).
 * Separators are unified to "/" so one set of rules judges POSIX paths
 * ("/Users/me/x") and Windows paths ("C:\Users\me\x") identically.
 */
export function normalizeTarget(target: string): string {
  return target.replace(/\\/g, "/").replace(/\0/g, "").trim().toLowerCase();
}

/**
 * Resolve a target against a base. A Windows drive path keeps its OWN root
 * (resolved with win32 rules) so it can never be mistaken for a location
 * inside the local user root; everything else resolves natively.
 */
export function resolveTarget(base: string, target: string): string {
  const unified = target.replace(/\\/g, "/");
  if (DRIVE_ABS.test(target)) return win32.resolve(unified).replace(/\\/g, "/");
  return resolve(base, unified);
}

/** True when `target` stays inside `root` after resolving `..` lexically. */
export function isWithinRoot(root: string, target: string): boolean {
  const r = normalizeTarget(resolve(root));
  const t = normalizeTarget(resolveTarget(root, target));
  return t === r || t.startsWith(r.endsWith("/") ? r : r + "/");
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

/**
 * System locations that policy denies outright, per platform. The core may
 * run on a different OS than the agent, so Windows drive roots stay on the
 * list everywhere (a Windows path can still arrive at a POSIX core).
 */
export function systemDenyRoots(): string[] {
  const roots: string[] = [];
  // Windows roots are always denied: the core and the agent may run on
  // different machines, so a Windows path can still arrive here.
  roots.push(process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows");
  if (process.env.ProgramFiles) roots.push(process.env.ProgramFiles);
  if (process.env["ProgramFiles(x86)"]) roots.push(process.env["ProgramFiles(x86)"]);
  if (process.env.ProgramData) roots.push(process.env.ProgramData);
  if (process.platform === "darwin") {
    roots.push("/System", "/Library", "/usr", "/bin", "/sbin", "/etc", "/private/etc", "/private/var/db", "/dev", "/cores");
  } else if (process.platform !== "win32") {
    roots.push("/usr", "/bin", "/sbin", "/etc", "/boot", "/dev", "/proc", "/sys", "/var/lib");
  }
  return roots.map(normalizeTarget);
}

function hitsSecretLocation(target: string): string | undefined {
  const t = normalizeTarget(target);
  const segments = t.split("/").filter(Boolean);
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
  for (const root of systemDenyRoots()) {
    const edge = root.endsWith("/") ? root : root + "/";
    if (t === root || t.startsWith(edge)) {
      return `system location "${root}"`;
    }
  }
  // Another user's profile: under /Users/<someone-else> (macOS/Linux) or
  // C:\Users\<someone-else> (Windows).
  const usersDir = normalizeTarget(dirname(ctx.userRoot));
  const mine = normalizeTarget(ctx.userRoot);
  if (t.startsWith(usersDir + "/") && !(t === mine || t.startsWith(mine + "/"))) {
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
  "upload",
  "record",
]);

/**
 * Risk × target × scope × intent. Pure function — no I/O, fully unit-testable.
 * Order: structural denies first, then class defaults, then clarity escalation.
 */
const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const UNSAFE_SCHEMES = new Set(["file:", "javascript:", "data:", "vbscript:"]);

export function classify(action: ProposedAction, ctx: PolicyContext = defaultPolicyContext()): PolicyDecision {
  const rawTarget = (action.target ?? "").trim();
  // Windows drive paths ("C:\…") match the scheme pattern textually but are
  // local paths — only treat longer schemes as URIs.
  const isUri = URI_SCHEME.test(rawTarget) && !/^[a-zA-Z]:[\\/]/.test(rawTarget);
  // Resolve paths first (against userRoot) so `..\..` escapes are judged by
  // where they LAND, not by how they're spelled. URIs are never resolved —
  // they are judged as remote targets, never as local paths.
  const target = rawTarget && !isUri ? normalizeTarget(resolveTarget(ctx.userRoot, rawTarget)) : normalizeTarget(rawTarget);

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
      const scheme = isUri ? rawTarget.split(":")[0]!.toLowerCase() + ":" : "";
      if (UNSAFE_SCHEMES.has(scheme)) {
        return {
          verdict: "deny",
          reason: "deny.unsafe-scheme",
          message: `Refused: scheme "${scheme}" can escape the browser sandbox.`,
        };
      }
      if (action.actionClass === "interact" && (action.args["submit"] === true || (action.name === "web.request" && typeof action.args["method"] === "string" && action.args["method"].toUpperCase() !== "GET"))) {
        return {
          verdict: "confirm",
          reason: "confirm.submit-action",
          message: `Confirmation needed: interacting with "${action.target}" submits or changes data. Confirm the exact payload.`,
        };
      }
      if (action.name.startsWith("desktop.")) {
        return { verdict: "allow", reason: "allow.desktop-interaction", message: `Desktop interaction on "${action.target}"; allowed.` };
      }
      if (action.actionClass === "interact" && (scheme === "http:" || scheme === "https:")) {
        const host = rawTarget.split("/")[2] ?? "";
        const hostOnly = host.split("@").pop() ?? "";
        const [hostname, port] = hostOnly.split(":");
        const dotted = hostname.includes(".") && !/^\d+\.\d+\.\d+\.\d+$/.test(hostname);
        const stdPort =
          !port ||
          (scheme === "https:" && port === "443") ||
          (scheme === "http:" && port === "80");
        if (dotted && stdPort && !rawTarget.includes("@")) {
          return { verdict: "allow", reason: "allow.named-web-target", message: "Named web destination; navigation is reversible." };
        }
        return {
          verdict: "confirm",
          reason: "confirm.unusual-url-target",
          message: `Confirmation needed: "${action.target}" is an unusual web target (IP, port, or credentials). Confirm before opening.`,
        };
      }
      const home = !isUri && (isWithinRoot(ctx.userRoot, target) || isWithinRoot(ctx.workDir, target));
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

    case "upload": {
      // Data is leaving this machine. The user approves the exact scope.
      return {
        verdict: "confirm",
        reason: "confirm.cloud-egress",
        message: `Confirmation needed: this sends "${action.target ?? "the selected file"}" to a third-party service. Confirm the exact file and destination.`,
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
