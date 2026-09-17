import { isDeviceAvailable, listDevices } from "./deviceStore.js";

export interface CapabilityDefinition {
  id: string;
  deviceId: string;
  /** OAuth-style scopes or local permission labels required to invoke. */
  scopes: string[];
  authorized: boolean;
  description: string;
}

/**
 * Static seed: known capability metadata (scopes, descriptions) so the graph
 * is meaningful before any agent has registered. Live registrations supply
 * the device side — see listCapabilities().
 */
const SEED: Omit<CapabilityDefinition, "deviceId">[] = [
  {
    id: "create_document",
    scopes: ["documents:write"],
    authorized: true,
    description: "Create and open a real .docx on the Windows laptop.",
  },
];

function seedFor(capabilityId: string): Omit<CapabilityDefinition, "deviceId"> | undefined {
  return SEED.find((s) => s.id === capabilityId);
}

/**
 * Capability graph: required capabilities → available devices.
 * Providers come from live agent registrations; the seed fills in metadata
 * for known capabilities. Unknown advertised capabilities are included with
 * a generic description so new agent features surface without a core deploy.
 */
export function listCapabilities(): CapabilityDefinition[] {
  const out: CapabilityDefinition[] = [];
  const seen = new Set<string>();
  for (const device of listDevices()) {
    for (const capId of device.capabilities) {
      const key = `${device.id}:${capId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const seed = seedFor(capId);
      out.push({
        id: capId,
        deviceId: device.id,
        scopes: seed?.scopes ?? [],
        authorized: seed?.authorized ?? true,
        description: seed?.description ?? `Advertised by ${device.id}.`,
      });
    }
  }
  // Pre-registration fallback so the graph is never empty on a fresh core.
  if (out.length === 0) {
    for (const seed of SEED) out.push({ ...seed, deviceId: "windows-laptop" });
  }
  return out;
}

/** Providers for a capability; pass onlyAvailable to require a live heartbeat. */
export function findProviders(capabilityId: string, opts: { onlyAvailable?: boolean } = {}): CapabilityDefinition[] {
  return listCapabilities().filter((c) => {
    if (c.id !== capabilityId || !c.authorized) return false;
    if (!opts.onlyAvailable) return true;
    const device = listDevices().find((d) => d.id === c.deviceId);
    return !!device && isDeviceAvailable(device);
  });
}
