export interface DeviceRegistration {
  id: string;
  name: string;
  /** Capabilities this device is explicitly authorized to execute. Allowlist only. */
  capabilities: string[];
  lastHeartbeatAt?: string;
}

export interface CapabilityDefinition {
  id: string;
  deviceId: string;
  /** OAuth-style scopes or local permission labels required to invoke. */
  scopes: string[];
  authorized: boolean;
  description: string;
}

const devices = new Map<string, DeviceRegistration>();

export function registerDevice(reg: DeviceRegistration): DeviceRegistration {
  const entry: DeviceRegistration = { ...reg, lastHeartbeatAt: new Date().toISOString() };
  devices.set(reg.id, entry);
  return entry;
}

export function heartbeat(deviceId: string): DeviceRegistration | undefined {
  const existing = devices.get(deviceId);
  if (!existing) return undefined;
  existing.lastHeartbeatAt = new Date().toISOString();
  return existing;
}

export function listDevices(): DeviceRegistration[] {
  return [...devices.values()];
}

/** A device is available when authenticated/reachable: here = registered + heartbeat within 90s. */
export function isDeviceAvailable(device: DeviceRegistration, now = Date.now()): boolean {
  if (!device.lastHeartbeatAt) return false;
  return now - Date.parse(device.lastHeartbeatAt) < 90_000;
}
