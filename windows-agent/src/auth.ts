import type { NextFunction, Request, Response } from "express";

/**
 * Same shared secret as the core — set AGENT_TOKEN identically on both sides.
 * Fail-closed like the core: unset means refuse, never trust.
 */
export function requireAgentAuth(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.AGENT_TOKEN;
  if (token && req.header("authorization") === `Bearer ${token}`) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized: valid Bearer token required" });
}
