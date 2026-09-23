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
 * Static metadata (scopes, descriptions) for known capabilities. This is
 * descriptive only — it never confers availability. A capability is
 * executable only when a live, available device advertises it below.
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
 * Capability graph: advertised capabilities → advertising devices.
 * Providers come ONLY from live agent registrations; the seed fills in
 * metadata (scopes, descriptions) for known capabilities. An empty graph is
 * an honest empty graph — tasks fail with "no capable device online" instead
 * of planning against a phantom laptop. Unknown advertised capabilities are
 * included with a generic description so new agent features surface without
 * a core deploy.
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
