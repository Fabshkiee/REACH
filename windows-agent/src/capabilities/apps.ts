import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { assertAllowedPath } from "../sandbox.js";
import { verifyFile } from "./files.js";

/**
 * Known-safe launch targets. Names only — never raw paths or binaries.
 * Anything outside this map reaches the user as a confirmation, never silent.
 *
 * Each entry lists how to open the app on each platform: `win` (executable),
 * `mac` (application name for `open -a`), `uri` (custom scheme — works
 * everywhere). The KEY is the stable public name advertised to the core.
 */
export interface KnownApp {
  win?: string;
  mac?: string;
  uri?: string;
}

export const KNOWN_APPS: Record<string, KnownApp> = {
  calculator: { win: "calc.exe", mac: "Calculator" },
  calc: { win: "calc.exe", mac: "Calculator" },
  notepad: { win: "notepad.exe", mac: "TextEdit" },
  paint: { win: "mspaint.exe" },
  mspaint: { win: "mspaint.exe" },
  snipping: { win: "SnippingTool.exe" },
  settings: { uri: "ms-settings:" },
  finder: { win: "explorer.exe", mac: "Finder" },
  explorer: { win: "explorer.exe", mac: "Finder" },
  terminal: { win: "wt.exe", mac: "Terminal" },
  wt: { win: "wt.exe", mac: "Terminal" },
  safari: { mac: "Safari" },
  chrome: { win: "chrome.exe", mac: "Google Chrome" },
  edge: { win: "msedge.exe" },
  msedge: { win: "msedge.exe" },
  opera: { win: "opera.exe" },
  textedit: { mac: "TextEdit" },
  notes: { mac: "Notes" },
  mail: { mac: "Mail" },
  messages: { mac: "Messages" },
  preview: { mac: "Preview" },
  music: { mac: "Music" },
  photos: { uri: "ms-photos:", mac: "Photos" },
  figma: { uri: "figma:" },
  vscode: { win: "code.cmd", mac: "Visual Studio Code" },
  code: { win: "code.cmd", mac: "Visual Studio Code" },
  antigravity: { mac: "Antigravity IDE" },
  "antigravity ide": { mac: "Antigravity IDE" },
  "antigravity 2": { mac: "Antigravity" },
  "antigravity 2.0": { mac: "Antigravity" },
  spotify: { uri: "spotify:" },
  slack: { uri: "slack:" },
  discord: { uri: "discord:" },
  obsidian: { uri: "obsidian:" },
  notion: { uri: "notion:" },
  steam: { uri: "steam:" },
  telegram: { uri: "tg:" },
  whatsapp: { uri: "whatsapp:" },
  zoom: { uri: "zoommtg:" },
  teams: { uri: "msteams:" },
  word: { win: "WINWORD.EXE", mac: "Microsoft Word" },
  winword: { win: "WINWORD.EXE", mac: "Microsoft Word" },
  excel: { win: "EXCEL.EXE", mac: "Microsoft Excel" },
  powerpoint: { win: "POWERPNT.EXE", mac: "Microsoft PowerPoint" },
  outlook: { win: "OUTLOOK.EXE", mac: "Microsoft Outlook" },
  vlc: { win: "vlc.exe", mac: "VLC" },
  powershell: { win: "powershell.exe" },
  pwsh: { win: "pwsh.exe" },
  cmd: { win: "cmd.exe" },
};

export const OpenDocumentSchema = z.object({
  path: z.string().min(1).max(2000),
});
export type OpenDocumentInput = z.infer<typeof OpenDocumentSchema>;

export const OpenUrlSchema = z.object({
  url: z.string().min(1).max(2000),
});
export type OpenUrlInput = z.infer<typeof OpenUrlSchema>;

export const LaunchApplicationSchema = z.object({
  app: z.string().min(1).max(100),
  /** Optional file or folder to open in the app (e.g. a project folder). */
  path: z.string().max(2000).optional(),
});
export type LaunchApplicationInput = z.infer<typeof LaunchApplicationSchema>;

/** Spawn a command and wait for it to exit. Never uses a shell. */
function spawnAndWait(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`${cmd} failed to start: ${err.message}`));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, stderr: stderr.trim() });
    });
  });
}

/**
 * Open with the default handler WITHOUT a shell.
 *
 * - Windows: PowerShell's Start-Process calls ShellExecuteEx directly (no
 *   cmd.exe parsing). The script is a static file (`Start-Process -FilePath
 *   $args[0]`) and the target travels as a process argument — argv elements
 *   are never shell-parsed, so no injection is possible at any level.
 *   (Note: Start-Process has no -LiteralPath parameter on any PowerShell
 *   version; -FilePath with a single argv element is exact.)
 * - macOS: `open` (LaunchServices). A file type with no registered handler
 *   (e.g. .docx with no Pages/Word installed) falls back to Quick Look,
 *   which every macOS ships.
 * - Linux: `xdg-open`.
 */
async function startVerb(pathOrUri: string): Promise<void> {
  if (process.platform === "darwin") {
    const first = await spawnAndWait("open", [pathOrUri], 15_000);
    if (first.code === 0) return;
    const fallback = await spawnAndWait("qlmanage", ["-p", pathOrUri], 15_000);
    if (fallback.code !== 0) {
      throw new Error(`open failed: ${first.stderr || `exit ${first.code}`}`);
    }
    return;
  }
  if (process.platform === "linux") {
    const r = await spawnAndWait("xdg-open", [pathOrUri], 15_000);
    if (r.code !== 0) throw new Error(`open failed: ${r.stderr || `exit ${r.code}`}`);
    return;
  }

  const { mkdtemp, writeFile: wf, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "reach-open-"));
  const script = join(dir, "open.ps1");
  try {
    await wf(script, "Start-Process -FilePath $args[0]", "utf8");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, pathOrUri],
      { windowsHide: true, stdio: "ignore" },
    );
    await new Promise<void>((res, rej) => {
      const timer = setTimeout(() => {
        child.kill();
        rej(new Error("open timed out after 15s"));
      }, 15_000);
      timer.unref?.();
      child.once("error", (err) => {
        clearTimeout(timer);
        rej(new Error(`open failed to start: ${err.message}`));
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) res();
        else rej(new Error(`open failed: powershell exit ${code}`));
      });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Shared by create_document and open_document. Best-effort: never fails the task. */
export async function openWithDefaultApp(absPath: string): Promise<{ opened: boolean; openNote?: string }> {
  // E2E suites create many documents; never leave Finder/Word windows behind.
  if (process.env.REACH_E2E_NO_OPEN === "1") {
    return { opened: true, openNote: "suppressed during e2e" };
  }
  try {
    await startVerb(absPath);
    return { opened: true };
  } catch (err) {
    return { opened: false, openNote: err instanceof Error ? err.message : "open failed" };
  }
}

export async function openDocument(input: OpenDocumentInput): Promise<{
  path: string;
  opened: boolean;
  isDirectory?: boolean;
  openNote?: string;
}> {
  const parsed = OpenDocumentSchema.parse(input);
  const abs = assertAllowedPath(parsed.path);
  let st;
  try {
    st = await stat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`missing path: no such file or directory (ENOENT): ${abs}`);
    }
    throw err;
  }
  if (!st.isFile() && !st.isDirectory()) {
    throw new Error(`not an openable file or directory: ${abs}`);
  }
  const isDirectory = st.isDirectory();
  const { opened, openNote } = await openWithDefaultApp(abs);
  return {
    path: abs,
    opened,
    ...(isDirectory ? { isDirectory: true } : {}),
    openNote,
  };
}

const BLOCKED_SCHEMES = new Set(["file:", "javascript:", "data:", "vbscript:"]);

export function assertSafeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`not a valid URL: ${raw.slice(0, 120)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`refused: scheme "${url.protocol}" is not openable (http/https only)`);
  }
  if (BLOCKED_SCHEMES.has(url.protocol)) throw new Error(`refused: scheme "${url.protocol}" is blocked`);
  if (url.username || url.password) throw new Error("refused: URLs with embedded credentials are blocked");
  return url.toString();
}

/**
 * Spotify web links opened via the default browser never reach the Spotify
 * app. Convert an https://open.spotify.com/<type>/<id> URL into the matching
 * spotify:<type>:<id> URI so startVerb hands it to the registered handler
 * (the Spotify app) instead of Safari/Chrome.
 */
export function spotifyDeepLink(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.hostname !== "open.spotify.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [type, id] = parts;
  if (!["playlist", "track", "album", "artist", "show", "episode"].includes(type)) return null;
  if (!id) return null;
  return `spotify:${type}:${id}`;
}

export async function openUrl(input: OpenUrlInput): Promise<{ url: string; opened: boolean; openNote?: string }> {
  const parsed = OpenUrlSchema.parse(input);
  const url = assertSafeUrl(parsed.url);
  // Spotify links go to the app, not the browser (see spotifyDeepLink).
  const target = spotifyDeepLink(url) ?? url;
  try {
    await startVerb(target);
    return { url, opened: true };
  } catch (err) {
    return { url, opened: false, openNote: err instanceof Error ? err.message : "open failed" };
  }
}

export async function launchApplication(input: LaunchApplicationInput): Promise<{ app: string; launched: boolean }> {
  const parsed = LaunchApplicationSchema.parse(input);
  const key = parsed.app.trim().toLowerCase();
  const entry = KNOWN_APPS[key];
  // Optional target (file or folder) to open in the app.
  const targetPath = parsed.path ? assertAllowedPath(parsed.path) : undefined;
  // Unknown apps are not refused outright: policy already gates `launch` as
  // "confirm" for anything outside KNOWN_APPS, so once the user approves we
  // attempt a generic launch (macOS `open -a`). This avoids a hard-coded
  // allowlist being the only thing the user can open.
  if (!entry) {
    if (process.platform !== "darwin") {
      throw new Error(`unknown application "${parsed.app}": known-safe set is [${Object.keys(KNOWN_APPS).join(", ")}]`);
    }
    const args = targetPath ? ["-a", parsed.app.trim(), targetPath] : ["-a", parsed.app.trim()];
    const r = await spawnAndWait("open", args, 15_000);
    if (r.code !== 0) throw new Error(`launch failed: ${r.stderr || `exit ${r.code}`}`);
    return { app: key, launched: true };
  }
  // 1. URL scheme — identical on every platform (opens the registered handler).
  if (entry.uri && !targetPath) {
    await startVerb(entry.uri);
    return { app: key, launched: true };
  }
  // 2. Native launcher for THIS platform. An app with no launcher here is a
  //    truthful refusal, never a silent success.
  if (process.platform === "darwin") {
    if (!entry.mac) throw new Error(`application "${parsed.app}" has no macOS launcher`);
    const args = targetPath ? ["-a", entry.mac, targetPath] : ["-a", entry.mac];
    const r = await spawnAndWait("open", args, 15_000);
    if (r.code !== 0) throw new Error(`launch failed: ${r.stderr || `exit ${r.code}`}`);
    return { app: key, launched: true };
  }
  const bin = entry.win;
  if (!bin) throw new Error(`application "${parsed.app}" has no launcher on ${process.platform}`);
  // GUI apps never exit on their own, so execFile-style waiting would report
  // every launch as a timeout. Spawn detached instead: success = the OS
  // accepted the process (spawn event), failure = immediate spawn error.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, targetPath ? [targetPath] : [], { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", (err) => reject(new Error(`launch failed: ${(err as Error).message}`)));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  return { app: key, launched: true };
}
