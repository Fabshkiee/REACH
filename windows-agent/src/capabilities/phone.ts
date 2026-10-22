import { execSync, spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { assertAllowedPath } from "../sandbox.js";

/**
 * iOS phone capabilities via pymobiledevice3 (Mac-side bridge, Wi-Fi).
 * The iPhone must be paired with this Mac (Settings → General → AirPlay &
 * Continuity). No mobile app needed — uses Apple's CoreDevice/remote XPC.
 */

export const IosListSchema = z.object({});
export type IosListInput = z.infer<typeof IosListSchema>;

export const IosInfoSchema = z.object({});
export type IosInfoInput = z.infer<typeof IosInfoSchema>;

export const IosListFilesSchema = z.object({
  path: z.string().max(500).default("/DCIM/").describe("AFC path on the phone (e.g. /DCIM/, /Documents/)"),
});
export type IosListFilesInput = z.infer<typeof IosListFilesSchema>;

export const IosPullFileSchema = z.object({
  src: z.string().min(1).max(500).describe("AFC path on the phone (e.g. /DCIM/100APPLE/IMG_0988.JPG)"),
  destDir: z.string().max(500).optional().default("Downloads/REACH").describe("Local folder to save the file"),
});
export type IosPullFileInput = z.infer<typeof IosPullFileSchema>;

/** Discover the first wirelessly-paired iPhone. Returns its UDID. */
function discoverDevice(): string {
  const out = execSync("pymobiledevice3 remote browse", { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] });
  const devices = JSON.parse(out);
  if (!Array.isArray(devices) || devices.length === 0) {
    throw new Error("No iPhone found. Make sure it's paired (Settings → General → AirPlay & Continuity) and on the same network.");
  }
  const dev = devices[0];
  const udid = dev?.udid;
  if (!udid) throw new Error("Could not extract device UDID from browse result.");
  return String(udid);
}

/** Start a native tunnel, run a command, kill the tunnel. Returns stdout. */
async function withTunnel(udid: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("pymobiledevice3", ["remote", "start-tunnel", "--native", "--udid", udid, "--script-mode"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        child.kill();
        reject(new Error("Tunnel startup timed out"));
      }
    }, 15_000);

    child.stdout?.on("data", (d) => {
      stdout += String(d);
      const m = stdout.match(/^([0-9a-f:]+)\s+(\d+)$/m);
      if (m && !resolved) {
        resolved = true;
        clearTimeout(timer);
        const addr = m[1]!;
        const port = m[2]!;
        // Run the actual command
        const runner = spawn("pymobiledevice3", [...args, "--rsd", addr, port], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let cmdOut = "";
        let cmdErr = "";
        const cmdTimer = setTimeout(() => {
          runner.kill();
          child.kill();
          reject(new Error("Command timed out"));
        }, timeoutMs);
        runner.stdout?.on("data", (d) => { cmdOut += String(d); });
        runner.stderr?.on("data", (d) => { cmdErr += String(d); });
        runner.on("close", (code) => {
          clearTimeout(cmdTimer);
          // Give the tunnel a moment to flush before killing it.
          setTimeout(() => child.kill(), 1000);
          if (code !== 0) {
            reject(new Error(`pymobiledevice3 failed: ${cmdErr.slice(0, 300)}`));
          } else {
            resolve(cmdOut.trim());
          }
        });
      }
    });
    child.stderr?.on("data", (d) => { stderr += String(d); });
    child.on("close", () => {
      if (!resolved) {
        clearTimeout(timer);
        reject(new Error(`Tunnel failed: ${stderr.slice(0, 300)}`));
      }
    });
  });
}

export interface IosDevice {
  name: string;
  model: string;
  ios: string;
  udid: string;
}

export async function iosList(_input: IosListInput): Promise<{ ok: true; devices: IosDevice[]; count: number }> {
  const out = execSync("pymobiledevice3 remote browse", { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] });
  const devices = JSON.parse(out);
  const result: IosDevice[] = (Array.isArray(devices) ? devices : []).map((d: any) => ({
    name: d?.name || "Unknown",
    model: d?.model || "Unknown",
    ios: "see ios_info",
    udid: d?.udid || "unknown",
  }));
  return { ok: true, devices: result, count: result.length };
}

export async function iosInfo(_input: IosInfoInput): Promise<{ ok: true; name: string; ios: string; model: string }> {
  const udid = discoverDevice();
  const out = await withTunnel(udid, ["lockdown", "info"]);
  const info = JSON.parse(out);
  return {
    ok: true,
    name: info.DeviceName || "Unknown",
    ios: info.ProductVersion || "Unknown",
    model: info.HardwareModel || "Unknown",
  };
}

export async function iosListFiles(input: IosListFilesInput): Promise<{ ok: true; path: string; entries: string[]; count: number }> {
  const udid = discoverDevice();
  const out = await withTunnel(udid, ["afc", "ls", input.path]);
  const entries = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return { ok: true, path: input.path, entries, count: entries.length };
}

export async function iosPullFile(input: IosPullFileInput): Promise<{ ok: true; src: string; dest: string; size: number }> {
  const udid = discoverDevice();
  const resolvedDir = input.destDir.startsWith("/") ? input.destDir : join(homedir(), input.destDir);
  const safeDir = assertAllowedPath(resolvedDir);
  await mkdir(safeDir, { recursive: true });
  const filename = basename(input.src);
  const dest = join(safeDir, filename);
  await withTunnel(udid, ["afc", "pull", input.src, dest], 180_000);
  const st = await stat(dest);
  return { ok: true, src: input.src, dest, size: st.size };
}