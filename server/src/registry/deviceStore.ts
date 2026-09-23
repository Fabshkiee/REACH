import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { dataDir, ensureDir, listJsonBasenames, readJson, writeJsonAtomic } from "../store/jsonFile.js";

export const DEVICE_SCHEMA_VERSION = 1;

export interface DeviceRegistration {
  id: string;
  name: string;
  /** Capabilities this device is explicitly authorized to execute. Allowlist only. */
  capabilities: string[];
  /** Known-safe launch names advertised by the agent (feeds policy context). */
  knownApps?: string[];
  lastHeartbeatAt?: string;
  /** Paused by the user in REACH Settings/Devices: heartbeat continues, but the
   *  device is never dispatched to until resumed. Survives heartbeats and
   *  re-registration; only resume clears it. */
  disabled?: boolean;
}

export interface Advertisement {
  capabilities?: string[];
  knownApps?: string[];
}

export interface DeviceStore {
  register(reg: Omit<DeviceRegistration, "lastHeartbeatAt">): DeviceRegistration;
  heartbeat(deviceId: string, ad?: Advertisement): DeviceRegistration | undefined;
  list(): DeviceRegistration[];
  pause(deviceId: string): DeviceRegistration | undefined;
  resume(deviceId: string): DeviceRegistration | undefined;
  revoke(deviceId: string): boolean;
}

function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id);
}

function devicesDir(): string {
  const dir = join(dataDir(), "devices");
  ensureDir(dir);
  return dir;
}

function devicePath(id: string): string {
  return join(devicesDir(), `${id}.json`);
}

function readRaw(deviceId: string): ({ version?: number } & DeviceRegistration) | undefined {
  if (!isSafeId(deviceId)) return undefined;
  const raw = readJson<{ version?: number } & DeviceRegistration>(devicePath(deviceId));
  if (!raw || raw.version !== DEVICE_SCHEMA_VERSION) return undefined;
  return raw;
}

class FileDeviceStore implements DeviceStore {
  register(reg: Omit<DeviceRegistration, "lastHeartbeatAt">): DeviceRegistration {
    if (!isSafeId(reg.id)) throw new Error(`invalid device id "${reg.id}"`);
    // Preserve a user pause across agent restarts: re-registration never
    // silently re-enables a device the user paused.
    const prev = readRaw(reg.id);
    const entry: DeviceRegistration = {
      ...reg,
      disabled: prev?.disabled ?? reg.disabled ?? false,
      lastHeartbeatAt: new Date().toISOString(),
    };
    writeJsonAtomic(devicePath(reg.id), { version: DEVICE_SCHEMA_VERSION, ...entry });
    return entry;
  }

  heartbeat(deviceId: string, ad: Advertisement = {}): DeviceRegistration | undefined {
    const raw = readRaw(deviceId);
    if (!raw) return undefined;
    // Merge re-advertised fields so capability/app changes propagate without
    // a fresh registration. Only well-formed arrays are accepted. A user pause
    // is sticky: heartbeats refresh liveness, never clear `disabled`.
    const capabilities = Array.isArray(ad.capabilities)
      ? ad.capabilities.filter((c): c is string => typeof c === "string").slice(0, 100)
      : raw.capabilities;
    const knownApps = Array.isArray(ad.knownApps)
      ? ad.knownApps.filter((a): a is string => typeof a === "string").slice(0, 100)
      : raw.knownApps;
    const updated: DeviceRegistration = {
      ...raw,
      capabilities,
      ...(knownApps !== undefined ? { knownApps } : {}),
      lastHeartbeatAt: new Date().toISOString(),
    };
    writeJsonAtomic(devicePath(deviceId), { version: DEVICE_SCHEMA_VERSION, ...updated });
    return updated;
  }

  pause(deviceId: string): DeviceRegistration | undefined {
    const raw = readRaw(deviceId);
    if (!raw) return undefined;
    const updated: DeviceRegistration = { ...raw, disabled: true };
    writeJsonAtomic(devicePath(deviceId), { version: DEVICE_SCHEMA_VERSION, ...updated });
    return updated;
  }

  resume(deviceId: string): DeviceRegistration | undefined {
    const raw = readRaw(deviceId);
    if (!raw) return undefined;
    const updated: DeviceRegistration = { ...raw, disabled: false, lastHeartbeatAt: new Date().toISOString() };
    writeJsonAtomic(devicePath(deviceId), { version: DEVICE_SCHEMA_VERSION, ...updated });
    return updated;
  }

  revoke(deviceId: string): boolean {
    if (!isSafeId(deviceId)) return false;
    const path = devicePath(deviceId);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  }

  list(): DeviceRegistration[] {
    const dir = devicesDir();
    return listJsonBasenames(dir)
      .map((f) => readJson<{ version?: number } & DeviceRegistration>(join(dir, f)))
      .filter((d): d is { version?: number } & DeviceRegistration => !!d && d.version === DEVICE_SCHEMA_VERSION);
  }
}

// Singleton behind the classic function API — same swap-one-line story as tasks.
const store: DeviceStore = new FileDeviceStore();

export function createDeviceStore(): DeviceStore {
  return store;
}

export function registerDevice(reg: Omit<DeviceRegistration, "lastHeartbeatAt">): DeviceRegistration {
  return store.register(reg);
}

export function heartbeat(deviceId: string, ad?: Advertisement): DeviceRegistration | undefined {
  return store.heartbeat(deviceId, ad);
}

export function listDevices(): DeviceRegistration[] {
  return store.list();
}

/** Pause (user): heartbeat continues, dispatch stops until resumed. */
export function pauseDevice(deviceId: string): DeviceRegistration | undefined {
  return store.pause(deviceId);
}

/** Resume a paused device. */
export function resumeDevice(deviceId: string): DeviceRegistration | undefined {
  return store.resume(deviceId);
}

/**
 * Revoke (user): deletes the record. Note the agent re-registers on its next
 * heartbeat when it is still running (404 → re-register by design), so revoke
 * sticks only once the agent is stopped — pause is the control that holds
 * while the agent is alive. The sim states this next to the button.
 */
export function revokeDevice(deviceId: string): boolean {
  return store.revoke(deviceId);
}

/**
 * A device is "available" because its agent is authenticated (Bearer-checked
 * at registration), recently reachable, and not paused by the user — not
 * because of physical sensing. Paused and stale devices read as unavailable
 * everywhere: planner context, capability providers, and the sim panel.
 */
export function isDeviceAvailable(
  device: DeviceRegistration,
  now = Date.now(),
  timeoutMs = Number(process.env.DEVICE_TIMEOUT_MS ?? 90_000),
): boolean {
  if (device.disabled) return false;
  if (!device.lastHeartbeatAt) return false;
  return now - Date.parse(device.lastHeartbeatAt) < timeoutMs;
}
