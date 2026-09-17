import type { NextFunction, Request, Response } from "express";

export function agentToken(): string | undefined {
  return process.env.AGENT_TOKEN || undefined;
}

/**
 * Shared-secret auth for the Core ↔ agent channel. When AGENT_TOKEN is unset
 * (default local dev), localhost traffic is trusted and a warning is logged
 * at boot — set AGENT_TOKEN (same value on core + agent) to enforce Bearer
 * auth. Full OAuth 2.1 PKCE arrives with the Alexa-facing surface (Phase 3/4);
 * this only ever guards the private device channel.
 */
export function requireAgentAuth(req: Request, res: Response, next: NextFunction): void {
  const token = agentToken();
  if (!token) {
    next();
    return;
  }
  if (req.header("authorization") === `Bearer ${token}`) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized: valid Bearer token required" });
}

let warned = false;
export function warnIfAuthDisabled(service: string): void {
  if (!agentToken() && !warned) {
    warned = true;
    console.warn(`[${service}] AGENT_TOKEN unset — device channel trusts local traffic. Set AGENT_TOKEN to enforce.`);
  }
}
