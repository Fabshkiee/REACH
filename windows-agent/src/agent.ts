import { ALLOWED_CAPABILITIES, KNOWN_APPS } from "./capabilities/index.js";

export const AGENT_ID = process.env.AGENT_ID ?? "windows-laptop";
export const CORE_URL = process.env.CORE_URL ?? "http://localhost:3000";
export const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 30_000);

export function registrationPayload() {
  return {
    id: AGENT_ID,
    name: "Windows Laptop Agent",
    capabilities: [...ALLOWED_CAPABILITIES],
    knownApps: Object.keys(KNOWN_APPS),
  };
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.AGENT_TOKEN) headers.authorization = `Bearer ${process.env.AGENT_TOKEN}`;
  return headers;
}

async function registerOnce(): Promise<boolean> {
  const res = await fetch(`${CORE_URL}/devices/register`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(registrationPayload()),
  });
  return res.ok;
}

async function beatOnce(): Promise<void> {
  let res = await fetch(`${CORE_URL}/devices/${AGENT_ID}/heartbeat`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (res.status === 404) {
    // Core restarted and lost us (or never saw us) — re-register, then beat.
    if (await registerOnce()) {
      res = await fetch(`${CORE_URL}/devices/${AGENT_ID}/heartbeat`, {
        method: "POST",
        headers: authHeaders(),
      });
    }
  }
}

/**
 * Register on boot, then heartbeat forever. Every failure is logged and
 * retried next tick — the agent MUST survive core downtime, because an agent
 * that crashes when the core is away can never report back when it returns.
 *
 * Timing: one attempt immediately at boot, then every 5s until the first
 * success (covers "core starts after agent"), then the steady interval.
 * Without the fast lane, a fresh boot could read as offline for up to a full
 * HEARTBEAT_INTERVAL_MS — bad for demos and for fail-fast routing accuracy.
 */
export function startHeartbeat(): void {
  let steady: ReturnType<typeof setInterval> | undefined;
  const logErr = (phase: string, err: unknown) =>
    console.error(`[agent] ${phase} failed: ${err instanceof Error ? err.message : err}`);

  const tick = () => {
    void beatOnce()
      .then(() => {
        if (!steady) {
          console.log("[agent] core reachable — heartbeat steady");
          steady = setInterval(() => {
            void beatOnce().catch((err) => logErr("heartbeat", err));
          }, HEARTBEAT_INTERVAL_MS);
          steady.unref();
        }
      })
      .catch((err) => logErr("register/heartbeat", err));
  };

  tick();
  const fastLane = setInterval(() => {
    if (steady) clearInterval(fastLane);
    else tick();
  }, 5_000);
  fastLane.unref();
}
