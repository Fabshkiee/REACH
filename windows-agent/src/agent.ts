import { ALLOWED_CAPABILITIES } from "./capabilities/index.js";

export const AGENT_ID = process.env.AGENT_ID ?? "windows-laptop";
export const CORE_URL = process.env.CORE_URL ?? "http://localhost:3000";
export const HEARTBEAT_INTERVAL_MS = 30_000;

export function registrationPayload() {
  return { id: AGENT_ID, name: "Windows Laptop Agent", capabilities: [...ALLOWED_CAPABILITIES] };
}

/** Phase 2: POST /devices/register then interval POST /devices/:id/heartbeat against CORE_URL. */
export function heartbeatPayload() {
  return { id: AGENT_ID, at: new Date().toISOString() };
}
