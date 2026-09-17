/** Explicit capability allowlist — the agent exposes ONLY these. No generic run_command. */
export const ALLOWED_CAPABILITIES = ["create_document", "open_document", "open_url", "launch_application"] as const;
export type AllowedCapability = (typeof ALLOWED_CAPABILITIES)[number];

export function isAllowed(capability: string): capability is AllowedCapability {
  return (ALLOWED_CAPABILITIES as readonly string[]).includes(capability);
}
