import type { NextFunction, Request, Response } from "express";

export function agentToken(): string | undefined {
  return process.env.AGENT_TOKEN || undefined;
}

/**
 * Shared-secret auth for the Core ↔ agent channel. Fail-closed: when
 * AGENT_TOKEN is unset, every guarded request is refused — the boot gate
 * (`requireAgentToken`) normally prevents reaching this state, and this
 * middleware holds the line if the process was ever constructed without it
 * (tests/dev). Full OAuth 2.1 PKCE arrives with the Alexa-facing surface
 * (Phase 3/4); this only ever guards the private device channel.
 */
export function requireAgentAuth(req: Request, res: Response, next: NextFunction): void {
  const token = agentToken();
  if (token && req.header("authorization") === `Bearer ${token}`) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized: valid Bearer token required" });
}

let warned = false;
export function warnIfAuthDisabled(service: string): void {
  if (!agentToken() && !warned) {
    warned = true;
    console.warn(`[${service}] AGENT_TOKEN unset — device channel refuses all requests until it is set.`);
  }
}
