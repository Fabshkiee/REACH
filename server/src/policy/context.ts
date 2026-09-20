import { defaultPolicyContext } from "./engine.js";
import { isDeviceAvailable, listDevices } from "../registry/deviceStore.js";
import type { PolicyContext } from "./types.js";

/**
 * Policy context for dispatches to a device: the device's advertised
 * known-safe apps feed launch decisions, so policy tracks what the agent
 * actually exposes — no duplicated app list on the core side.
 */
export function policyContextFor(deviceId?: string): PolicyContext {
  const base = defaultPolicyContext();
  if (!deviceId) return base;
  const device = listDevices().find((d) => d.id === deviceId);
  if (!device?.knownApps?.length) return base;
  return { ...base, knownApps: device.knownApps };
}

/** Union of known-safe apps across all currently available devices. */
export function policyContextForAvailable(): PolicyContext {
  const base = defaultPolicyContext();
  const apps = [
    ...new Set(
      listDevices()
        .filter((d) => isDeviceAvailable(d))
        .flatMap((d) => d.knownApps ?? []),
    ),
  ];
  if (apps.length === 0) return base;
  return { ...base, knownApps: apps };
}
