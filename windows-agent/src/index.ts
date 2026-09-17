import express from "express";
import { AGENT_ID, registrationPayload } from "./agent.js";
import { ALLOWED_CAPABILITIES, isAllowed } from "./capabilities/index.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "windows-agent", agentId: AGENT_ID });
});

app.get("/capabilities", (_req, res) => {
  res.json({ agentId: AGENT_ID, capabilities: ALLOWED_CAPABILITIES });
});

// Skeleton dispatch guard — Phase 1 implements per-capability handlers.
app.post("/jobs/dispatch", (req, res) => {
  const { capability } = req.body as { capability?: string };
  if (!capability || !isAllowed(capability)) {
    return res.status(403).json({ error: `capability not allowed: ${capability ?? "missing"}` });
  }
  return res.status(501).json({ error: "not_implemented: Phase 1 wires handlers", registration: registrationPayload() });
});

const port = Number(process.env.AGENT_PORT ?? 3001);
if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => console.log(`windows-agent skeleton on :${port}`));
}

export default app;
