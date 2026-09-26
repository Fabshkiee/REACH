import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { assertAllowedPath } from "../sandbox.js";
import { verifyFile } from "./files.js";

/**
 * Known-safe launch targets. Names only — never raw paths or binaries.
 * Anything outside this map reaches the user as a confirmation, never silent.
 */
export const KNOWN_APPS: Record<string, { bin: string } | { uri: string }> = {
  calculator: { bin: "calc.exe" },
  notepad: { bin: "notepad.exe" },
  paint: { bin: "mspaint.exe" },
  snipping: { bin: "SnippingTool.exe" },
  settings: { uri: "ms-settings:" },
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
});
export type LaunchApplicationInput = z.infer<typeof LaunchApplicationSchema>;

/**
 * Open with the default handler WITHOUT a shell. PowerShell's Start-Process
 * calls ShellExecuteEx directly (no cmd.exe parsing). The script is a static
 * file (`Start-Process -FilePath $args[0]`) and the target travels as a
 * process argument — argv elements are never shell-parsed, so no injection is
 * possible at any level. (Note: Start-Process has no -LiteralPath parameter
 * on any PowerShell version; -FilePath with a single argv element is exact.
 * Brackets in generated titles are sanitized at creation for the same reason.)
 */
function startVerb(pathOrUri: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const run = async () => {
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
    };
    void run().then(resolve, reject);
  });
}

/** Shared by create_document and open_document. Best-effort: never fails the task. */
export async function openWithDefaultApp(absPath: string): Promise<{ opened: boolean; openNote?: string }> {
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

export async function openUrl(input: OpenUrlInput): Promise<{ url: string; opened: boolean; openNote?: string }> {
  const parsed = OpenUrlSchema.parse(input);
  const url = assertSafeUrl(parsed.url);
  try {
    await startVerb(url);
    return { url, opened: true };
  } catch (err) {
    return { url, opened: false, openNote: err instanceof Error ? err.message : "open failed" };
  }
}

export async function launchApplication(input: LaunchApplicationInput): Promise<{ app: string; launched: boolean }> {
  const parsed = LaunchApplicationSchema.parse(input);
  const key = parsed.app.trim().toLowerCase();
  const entry = KNOWN_APPS[key];
  if (!entry) {
    throw new Error(`unknown application "${parsed.app}": known-safe set is [${Object.keys(KNOWN_APPS).join(", ")}]`);
  }
  if ("uri" in entry) {
    await startVerb(entry.uri);
    return { app: key, launched: true };
  }
  // GUI apps never exit on their own, so execFile-style waiting would report
  // every launch as a timeout. Spawn detached instead: success = the OS
  // accepted the process (spawn event), failure = immediate spawn error.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(entry.bin, [], { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", (err) => reject(new Error(`launch failed: ${(err as Error).message}`)));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  return { app: key, launched: true };
}
