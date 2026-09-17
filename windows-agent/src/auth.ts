import type { NextFunction, Request, Response } from "express";

/** Same shared secret as the core — set AGENT_TOKEN identically on both sides. */
export function requireAgentAuth(req: Request, res: Response, next: NextFunction): void {
  if (!process.env.AGENT_TOKEN) {
    next();
    return;
  }
  if (req.header("authorization") === `Bearer ${process.env.AGENT_TOKEN}`) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized: valid Bearer token required" });
}
