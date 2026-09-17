import { join } from "node:path";
import { dataDir, ensureDir, listJsonBasenames, readJson, writeJsonAtomic } from "../store/jsonFile.js";

export const DEVICE_SCHEMA_VERSION = 1;

export interface DeviceRegistration {
  id: string;
  name: string;
  /** Capabilities this device is explicitly authorized to execute. Allowlist only. */
  capabilities: string[];
  lastHeartbeatAt?: string;
}

export interface DeviceStore {
  register(reg: Omit<DeviceRegistration, "lastHeartbeatAt">): DeviceRegistration;
  heartbeat(deviceId: string): DeviceRegistration | undefined;
  list(): DeviceRegistration[];
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

class FileDeviceStore implements DeviceStore {
  register(reg: Omit<DeviceRegistration, "lastHeartbeatAt">): DeviceRegistration {
    const entry: DeviceRegistration = { ...reg, lastHeartbeatAt: new Date().toISOString() };
    writeJsonAtomic(devicePath(reg.id), { version: DEVICE_SCHEMA_VERSION, ...entry });
    return entry;
  }

  heartbeat(deviceId: string): DeviceRegistration | undefined {
    if (!isSafeId(deviceId)) return undefined;
    const raw = readJson<{ version?: number } & DeviceRegistration>(devicePath(deviceId));
    if (!raw || raw.version !== DEVICE_SCHEMA_VERSION) return undefined;
    const updated: DeviceRegistration = { ...raw, lastHeartbeatAt: new Date().toISOString() };
    writeJsonAtomic(devicePath(deviceId), { version: DEVICE_SCHEMA_VERSION, ...updated });
    return updated;
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

export function heartbeat(deviceId: string): DeviceRegistration | undefined {
  return store.heartbeat(deviceId);
}

export function listDevices(): DeviceRegistration[] {
  return store.list();
}

/**
 * A device is "available" because its agent is authenticated (Bearer-checked
 * at registration) and recently reachable — not because of physical sensing.
 */
export function isDeviceAvailable(
  device: DeviceRegistration,
  now = Date.now(),
  timeoutMs = Number(process.env.DEVICE_TIMEOUT_MS ?? 90_000),
): boolean {
  if (!device.lastHeartbeatAt) return false;
  return now - Date.parse(device.lastHeartbeatAt) < timeoutMs;
}
