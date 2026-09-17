import type { CapabilityDefinition } from "./deviceRegistry.js";

/**
 * Capability graph skeleton.
 * Phase 2: goal → required capabilities → available devices → execution plan.
 * MVP seeds: windows-laptop offers create_document (authorized), others TBD.
 */
const capabilities: CapabilityDefinition[] = [
  {
    id: "create_document",
    deviceId: "windows-laptop",
    scopes: ["documents:write"],
    authorized: true,
    description: "Create and open a real .docx on the Windows laptop.",
  },
];

export function listCapabilities(): CapabilityDefinition[] {
  return capabilities;
}

export function findProviders(capabilityId: string): CapabilityDefinition[] {
  return capabilities.filter((c) => c.id === capabilityId && c.authorized);
}
