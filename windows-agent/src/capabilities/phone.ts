import { execSync, spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { assertAllowedPath } from "../sandbox.js";

/**
 * iOS phone capabilities via pymobiledevice3 (Mac-side bridge, Wi-Fi or USB).
 * Classic lockdown/AFC services and the developer core-device services all
 * ride one `remote start-tunnel --native` tunnel. The iPhone must be paired
 * and reachable; screen capture, app launch and hardware buttons additionally
 * need Developer Mode enabled on the phone (Settings → Privacy & Security →
 * Developer Mode).
 */

// ---------- schemas ----------

const UdidArg = z.string().min(1).max(64).optional().describe("Target iPhone UDID from phone.ios_list; needed when several are paired");

export const IosListSchema = z.object({});
export type IosListInput = z.infer<typeof IosListSchema>;

export const IosInfoSchema = z.object({
  udid: UdidArg,
});
export type IosInfoInput = z.infer<typeof IosInfoSchema>;

export const IosListFilesSchema = z.object({
  path: z.string().max(500).default("/DCIM/").describe("AFC path on the phone (e.g. /DCIM/, /Documents/)"),
  limit: z.number().int().min(1).max(2000).optional().default(200).describe("Maximum entries to return; total and truncated report the rest"),
  udid: UdidArg,
});
export type IosListFilesInput = z.infer<typeof IosListFilesSchema>;

export const IosPullFileSchema = z.object({
  src: z.string().min(1).max(500).describe("AFC path on the phone (e.g. /DCIM/100APPLE/IMG_0988.JPG)"),
  destDir: z.string().max(500).optional().default("Downloads/REACH").describe("Local folder to save the file"),
  udid: UdidArg,
});
export type IosPullFileInput = z.infer<typeof IosPullFileSchema>;

export const IosScreenshotSchema = z.object({
  destDir: z.string().max(500).optional().default("Downloads/REACH").describe("Local folder to save the PNG"),
  udid: UdidArg,
});
export type IosScreenshotInput = z.infer<typeof IosScreenshotSchema>;

export const IosAppsSchema = z.object({
  udid: UdidArg,
});
export type IosAppsInput = z.infer<typeof IosAppsSchema>;

export const IosPasteSchema = z.object({
  maxChars: z.number().int().min(1).max(20000).optional().default(4000).describe("Maximum characters to return"),
  udid: UdidArg,
});
export type IosPasteInput = z.infer<typeof IosPasteSchema>;

export const IosCopySchema = z.object({
  text: z.string().min(1).max(10000).describe("Text to place on the iPhone clipboard"),
  udid: UdidArg,
});
export type IosCopyInput = z.infer<typeof IosCopySchema>;

const BundleIdArg = z.string().min(1).max(200).regex(/^[A-Za-z0-9.-]+$/, "bundle ID: letters, digits, dots and hyphens only");

export const IosLaunchSchema = z.object({
  bundleId: BundleIdArg.describe("App bundle identifier (from phone.ios_apps, e.g. com.apple.mobilesafari)"),
  udid: UdidArg,
});
export type IosLaunchInput = z.infer<typeof IosLaunchSchema>;

export const IOS_BUTTONS = ["home", "lock", "volume-up", "volume-down", "mute", "siri"] as const;

export const IosButtonSchema = z.object({
  button: z.enum(IOS_BUTTONS).describe("Hardware button to press"),
  udid: UdidArg,
});
export type IosButtonInput = z.infer<typeof IosButtonSchema>;

export const IosPushFileSchema = z.object({
  path: z.string().min(1).max(2000).describe("Local file to copy to the phone"),
  bundleId: BundleIdArg.optional().describe("App whose Documents folder receives the file; without it the file goes to /REACH/ in the phone's media area"),
  remotePath: z.string().min(1).max(500).optional().describe("Destination path on the phone (absolute, without '..')"),
  udid: UdidArg,
});
export type IosPushFileInput = z.infer<typeof IosPushFileSchema>;

// ---------- shared shapes ----------

export interface IosDevice {
  name: string;
  model: string;
  ios: string;
  udid: string;
}

export interface IosBattery {
  level: number;
  charging: boolean;
}

export interface IosStorage {
  freeBytes: number;
  totalBytes: number;
}

export interface IosAppEntry {
  name: string;
  bundleId: string;
}

// ---------- pure parsing / selection helpers ----------

function asRecord(raw: unknown): Record<string, unknown> | undefined {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

/** First non-empty, non-"unknown" string among the given fields. */
function asText(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "unknown") return v.trim();
  }
  return undefined;
}

function asNumber(...values: unknown[]): number | undefined {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

function asBoolean(...values: unknown[]): boolean | undefined {
  for (const v of values) {
    if (typeof v === "boolean") return v;
    if (v === "true" || v === 1) return true;
    if (v === "false" || v === 0) return false;
  }
  return undefined;
}

function parseJson(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Accepts both discovery shapes: `remote browse` peer info
 * (UniqueDeviceID/DeviceName/ProductType/OSVersion) and `usbmux list`
 * short info (Identifier/DeviceName/ProductType/ProductVersion).
 */
export function parseDevices(raw: unknown): IosDevice[] {
  if (!Array.isArray(raw)) return [];
  const devices: IosDevice[] = [];
  for (const entry of raw) {
    const d = asRecord(entry);
    if (!d) continue;
    const udid = asText(d["UniqueDeviceID"], d["udid"], d["identifier"], d["Identifier"], d["SerialNumber"]);
    if (!udid) continue;
    devices.push({
      udid,
      name: asText(d["DeviceName"], d["name"], d["deviceName"]) ?? "unknown",
      model: asText(d["ProductType"], d["model"], d["DeviceClass"]) ?? "unknown",
      ios: asText(d["OSVersion"], d["ProductVersion"], d["ios"]) ?? "unknown",
    });
  }
  return devices;
}

/** Merge discovery lists by UDID, filling in missing fields from either source. */
export function mergeDevices(...lists: IosDevice[][]): IosDevice[] {
  const byUdid = new Map<string, IosDevice>();
  for (const list of lists) {
    for (const d of list) {
      const key = d.udid.toLowerCase();
      const prev = byUdid.get(key);
      if (!prev) {
        byUdid.set(key, d);
        continue;
      }
      byUdid.set(key, {
        udid: prev.udid,
        name: asText(prev.name, d.name) ?? "unknown",
        model: asText(prev.model, d.model) ?? "unknown",
        ios: asText(prev.ios, d.ios) ?? "unknown",
      });
    }
  }
  return [...byUdid.values()];
}

/** Explicit UDID wins; one device is implicit; several without one is an error. */
export function chooseDevice(devices: IosDevice[], udid?: string): IosDevice {
  if (udid) {
    const match = devices.find((d) => d.udid.toLowerCase() === udid.toLowerCase());
    if (!match) {
      const known = devices.length ? devices.map((d) => d.udid).join(", ") : "none";
      throw new Error(`iPhone "${udid}" is not paired with this Mac. Known UDIDs: ${known}. Run phone.ios_list to refresh.`);
    }
    return match;
  }
  if (devices.length === 1) return devices[0]!;
  if (devices.length === 0) {
    throw new Error(
      "No iPhone found. Pair the iPhone with this Mac (Apple Devices/Xcode), keep it unlocked on the same network, then retry.",
    );
  }
  throw new Error(
    `Several iPhones are paired: ${devices.map((d) => `${d.name} (${d.udid})`).join("; ")}. Pass udid to choose one.`,
  );
}

export function parseBattery(raw: unknown): IosBattery | null {
  const d = asRecord(raw);
  if (!d) return null;
  const level = asNumber(d["CurrentCapacity"], d["BatteryCurrentCapacity"], d["level"]);
  if (level === undefined) return null;
  const charging = asBoolean(d["IsCharging"], d["BatteryIsCharging"], d["charging"]);
  return { level: Math.max(0, Math.min(100, Math.round(level))), charging: charging ?? false };
}

export function parseStorage(raw: unknown): IosStorage | null {
  const d = asRecord(raw);
  if (!d) return null;
  const total = asNumber(d["TotalDataCapacity"], d["TotalDiskCapacity"], d["TotalSystemCapacity"]);
  const free = asNumber(d["TotalDataAvailable"], d["TotalSystemAvailable"]);
  if (total === undefined || free === undefined) return null;
  return { freeBytes: free, totalBytes: total };
}

export function parseApps(raw: unknown): IosAppEntry[] {
  if (!Array.isArray(raw)) return [];
  const apps: IosAppEntry[] = [];
  for (const entry of raw) {
    const d = asRecord(entry);
    if (!d) continue;
    const bundleId = asText(d["bundleIdentifier"], d["BundleIdentifier"], d["CFBundleIdentifier"], d["identifier"]);
    if (!bundleId) continue;
    apps.push({
      bundleId,
      name: asText(d["displayName"], d["DisplayName"], d["name"], d["Name"], d["CFBundleDisplayName"]) ?? bundleId,
    });
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

export function clipText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

// ---------- discovery + tunnel transport ----------

function runJson(cmd: string, timeoutMs = 15_000): unknown {
  try {
    const out = execSync(cmd, { encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(out);
  } catch {
    return undefined;
  }
}

/**
 * `remote browse` covers the native (Wi-Fi) pairing the tunnel needs; the
 * usbmux list adds USB/Xcode-paired devices. Both are best-effort: a machine
 * with no phone returns the merged empty list.
 */
export function listDevices(): IosDevice[] {
  const native = parseDevices(runJson("pymobiledevice3 remote browse --timeout 5"));
  const usb = parseDevices(runJson("pymobiledevice3 usbmux list"));
  return mergeDevices(native, usb);
}

function discoverDevice(udid?: string): IosDevice {
  return chooseDevice(listDevices(), udid);
}

interface TunnelCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface TunnelCommand {
  args: string[];
  timeoutMs?: number;
}

/** Serializes tunnel usage: concurrent native tunnels wedge the phone's RSD connections. */
let tunnelChain: Promise<unknown> = Promise.resolve();

/**
 * Start one native tunnel, run the commands through it sequentially, kill it.
 * A failed command is returned rather than thrown so optional probes (battery)
 * can degrade to null without failing the whole tool.
 */
async function startTunnelOnce(udid: string, commands: TunnelCommand[], defaultTimeoutMs = 30_000): Promise<TunnelCommandResult[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("pymobiledevice3", ["remote", "start-tunnel", "--native", "--udid", udid, "--script-mode"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let started = false;
    const startupTimer = setTimeout(() => {
      if (!started) {
        child.kill();
        reject(new Error("Tunnel startup timed out. Make sure the iPhone is unlocked and on the same network."));
      }
    }, 15_000);

    child.stdout?.on("data", (d) => {
      stdout += String(d);
      const m = stdout.match(/^([0-9a-f:]+)\s+(\d+)$/m);
      if (!m || started) return;
      started = true;
      clearTimeout(startupTimer);
      const addr = m[1]!;
      const port = m[2]!;
      const results: TunnelCommandResult[] = [];

      const finish = () => {
        // Give the tunnel a moment to flush before killing it.
        setTimeout(() => child.kill(), 1000);
        resolve(results);
      };

      const runNext = (index: number): void => {
        const command = commands[index];
        if (!command) {
          finish();
          return;
        }
        const runner = spawn("pymobiledevice3", [...command.args, "--rsd", addr, port], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let cmdOut = "";
        let cmdErr = "";
        const cmdTimer = setTimeout(() => {
          runner.kill();
          child.kill();
          reject(new Error(`pymobiledevice3 ${command.args.join(" ")} timed out after ${command.timeoutMs ?? defaultTimeoutMs}ms`));
        }, command.timeoutMs ?? defaultTimeoutMs);
        runner.stdout?.on("data", (d) => { cmdOut += String(d); });
        runner.stderr?.on("data", (d) => { cmdErr += String(d); });
        runner.on("error", (err) => {
          clearTimeout(cmdTimer);
          child.kill();
          reject(err);
        });
        runner.on("close", (code) => {
          clearTimeout(cmdTimer);
          results.push({ code: code ?? 1, stdout: cmdOut, stderr: cmdErr });
          runNext(index + 1);
        });
      };
      runNext(0);
    });

    child.stderr?.on("data", (d) => { stderr += String(d); });
    child.on("close", () => {
      if (!started) {
        clearTimeout(startupTimer);
        reject(new Error(`Tunnel failed: ${stderr.slice(0, 300)}`));
      }
    });
  });
}

/**
 * Run one tunneled command, one tunnel at a time. Tunnel startup is flaky
 * (remoted's RSD handshake races), so a startup failure gets one retry;
 * command timeouts are not retried because the command may have run.
 */
async function runInTunnel(udid: string, commands: TunnelCommand[], defaultTimeoutMs = 30_000): Promise<TunnelCommandResult[]> {
  const run = tunnelChain.then(async () => {
    try {
      return await startTunnelOnce(udid, commands, defaultTimeoutMs);
    } catch (err) {
      if (!/^Tunnel (failed|startup timed out)/.test(String(err))) throw err;
      return startTunnelOnce(udid, commands, defaultTimeoutMs);
    }
  });
  tunnelChain = run.catch(() => undefined);
  return run;
}

/**
 * pymobiledevice3 prints a long hint block that blames Developer Mode when a
 * developer service is simply absent from the tunnel. Keep the truthful part.
 */
export function cleanToolError(args: string[], stderr: string): string {
  if (/Failed to start service/i.test(stderr)) {
    return `pymobiledevice3 ${args.join(" ")}: the iPhone does not expose this developer service on the current connection (not a Developer Mode issue).`;
  }
  return `pymobiledevice3 ${args.join(" ")} failed: ${stderr.slice(0, 300)}`;
}

/** One command through a tunnel; rejects when it exits non-zero. */
async function withTunnel(udid: string, args: string[], timeoutMs = 30_000): Promise<string> {
  const [result] = await runInTunnel(udid, [{ args, timeoutMs }], timeoutMs);
  if (!result || result.code !== 0) {
    throw new Error(cleanToolError(args, result?.stderr ?? "no output"));
  }
  return result.stdout;
}

function localDir(destDir: string): string {
  const resolved = destDir.startsWith("/") ? destDir : join(homedir(), destDir);
  return assertAllowedPath(resolved);
}

function remoteTarget(remotePath: string | undefined, fallback: string): string {
  const remote = remotePath ?? fallback;
  if (!remote.startsWith("/") || remote.includes("..")) {
    throw new Error(`Invalid phone path "${remote}": use an absolute path without "..".`);
  }
  return remote;
}

// ---------- capabilities ----------

export async function iosList(_input: IosListInput): Promise<{ ok: true; devices: IosDevice[]; count: number }> {
  const devices = listDevices();
  return { ok: true, devices, count: devices.length };
}

export async function iosInfo(input: IosInfoInput): Promise<{
  ok: true;
  udid: string;
  name: string;
  model: string;
  ios: string;
  battery: IosBattery | null;
  storage: IosStorage | null;
}> {
  const device = discoverDevice(input.udid);
  const results = await runInTunnel(device.udid, [
    { args: ["lockdown", "info"], timeoutMs: 20_000 },
    { args: ["diagnostics", "battery", "single"], timeoutMs: 20_000 },
  ]);
  const info = asRecord(parseJson(results[0]?.stdout));
  const battery = results[1]?.code === 0 ? parseBattery(parseJson(results[1]!.stdout)) : null;
  return {
    ok: true,
    udid: device.udid,
    name: asText(info?.["DeviceName"]) ?? device.name,
    model: asText(info?.["HardwareModel"], info?.["ProductType"]) ?? device.model,
    ios: asText(info?.["ProductVersion"], info?.["OSVersion"]) ?? device.ios,
    battery,
    storage: parseStorage(info),
  };
}

export async function iosListFiles(input: IosListFilesInput): Promise<{
  ok: true;
  udid: string;
  path: string;
  entries: string[];
  count: number;
  total: number;
  truncated: boolean;
}> {
  const device = discoverDevice(input.udid);
  const out = await withTunnel(device.udid, ["afc", "ls", input.path]);
  const all = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const entries = all.slice(0, input.limit);
  return {
    ok: true,
    udid: device.udid,
    path: input.path,
    entries,
    count: entries.length,
    total: all.length,
    truncated: all.length > entries.length,
  };
}

export async function iosPullFile(input: IosPullFileInput): Promise<{ ok: true; udid: string; src: string; dest: string; size: number }> {
  const device = discoverDevice(input.udid);
  const dir = localDir(input.destDir);
  await mkdir(dir, { recursive: true });
  const dest = join(dir, basename(input.src));
  await withTunnel(device.udid, ["afc", "pull", input.src, dest], 180_000);
  const st = await stat(dest);
  return { ok: true, udid: device.udid, src: input.src, dest, size: st.size };
}

export async function iosScreenshot(input: IosScreenshotInput): Promise<{ ok: true; udid: string; path: string; size: number }> {
  const device = discoverDevice(input.udid);
  const dir = localDir(input.destDir);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `iphone-${Date.now()}.png`);
  await withTunnel(device.udid, ["developer", "core-device", "screen-capture", "screenshot", path], 60_000);
  const st = await stat(path);
  return { ok: true, udid: device.udid, path, size: st.size };
}

export async function iosApps(input: IosAppsInput): Promise<{ ok: true; udid: string; apps: IosAppEntry[]; count: number }> {
  const device = discoverDevice(input.udid);
  const out = await withTunnel(device.udid, ["developer", "core-device", "list-apps"], 60_000);
  const apps = parseApps(parseJson(out));
  return { ok: true, udid: device.udid, apps, count: apps.length };
}

export async function iosPaste(input: IosPasteInput): Promise<{ ok: true; udid: string; text: string; truncated: boolean }> {
  const device = discoverDevice(input.udid);
  const raw = (await withTunnel(device.udid, ["developer", "core-device", "paste"], 30_000)).replace(/\r?\n$/, "");
  const { text, truncated } = clipText(raw, input.maxChars);
  return { ok: true, udid: device.udid, text, truncated };
}

export async function iosCopy(input: IosCopyInput): Promise<{ ok: true; udid: string; chars: number }> {
  const device = discoverDevice(input.udid);
  await withTunnel(device.udid, ["developer", "core-device", "copy", input.text], 30_000);
  return { ok: true, udid: device.udid, chars: input.text.length };
}

export async function iosLaunch(input: IosLaunchInput): Promise<{ ok: true; udid: string; bundleId: string }> {
  const device = discoverDevice(input.udid);
  await withTunnel(device.udid, ["developer", "core-device", "launch-application", input.bundleId], 30_000);
  return { ok: true, udid: device.udid, bundleId: input.bundleId };
}

export async function iosButton(input: IosButtonInput): Promise<{ ok: true; udid: string; button: string }> {
  const device = discoverDevice(input.udid);
  await withTunnel(device.udid, ["developer", "core-device", "hid", "button", input.button], 30_000);
  return { ok: true, udid: device.udid, button: input.button };
}

export async function iosPushFile(input: IosPushFileInput): Promise<{ ok: true; udid: string; path: string; dest: string }> {
  const device = discoverDevice(input.udid);
  const local = assertAllowedPath(input.path);
  const st = await stat(local);
  if (!st.isFile()) throw new Error(`Not a file: ${local}`);
  const name = basename(local);
  if (input.bundleId) {
    const remote = remoteTarget(input.remotePath, `/${name}`);
    await withTunnel(device.udid, ["apps", "push", input.bundleId, local, remote, "--documents"], 180_000);
    return { ok: true, udid: device.udid, path: local, dest: `${input.bundleId}:/Documents${remote}` };
  }
  const remote = remoteTarget(input.remotePath, `/REACH/${name}`);
  await withTunnel(device.udid, ["afc", "push", local, remote], 180_000);
  return { ok: true, udid: device.udid, path: local, dest: `/var/mobile/Media${remote}` };
}
