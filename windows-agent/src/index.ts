import express from "express";
import { AGENT_ID, registrationPayload } from "./agent.js";
import { ALLOWED_CAPABILITIES, CreateDocumentSchema, createDocument, isAllowed } from "./capabilities/index.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "windows-agent", agentId: AGENT_ID });
});

app.get("/capabilities", (_req, res) => {
  res.json({ agentId: AGENT_ID, capabilities: ALLOWED_CAPABILITIES });
});

// Dev-only direct test route for create_document (no dispatch envelope needed).
app.post("/capabilities/create_document", async (req, res) => {
  const parsed = CreateDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid input", issues: parsed.error.issues });
  }
  try {
    const result = await createDocument(parsed.data);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "create failed" });
  }
});

app.post("/jobs/dispatch", async (req, res) => {
  const { capability, args } = req.body as { capability?: string; args?: unknown };
  if (!capability || !isAllowed(capability)) {
    return res.status(403).json({ error: `capability not allowed: ${capability ?? "missing"}` });
  }
  if (capability === "create_document") {
    const parsed = CreateDocumentSchema.safeParse(args);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid args for create_document", issues: parsed.error.issues });
    }
    try {
      const result = await createDocument(parsed.data);
      return res.json({ ok: true, capability, ...result, registration: registrationPayload() });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "create failed" });
    }
  }
  return res.status(501).json({ error: `not_implemented: ${capability}`, registration: registrationPayload() });
});

const port = Number(process.env.AGENT_PORT ?? 3001);
if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => console.log(`windows-agent skeleton on :${port}`));
}

export default app;
