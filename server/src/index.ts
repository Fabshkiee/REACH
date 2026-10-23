import express from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireAgentAuth } from "./auth.js";
import { loadEnv, requireAgentToken } from "./config.js";
import { decideApproval, executeOnMyDevices, getTaskStatus, listTasks, cancelTaskById, answerInput } from "./mcp/tools.js";
import { registerAgentActions } from "./actions/agent.js";
import { registerBrowserActions } from "./actions/browser.js";
import { registerWebActions } from "./actions/web.js";
import { registerAudioActions } from "./actions/audio.js";
import { toolsForPlanner } from "./planner/tools.js";
import { getTask } from "./tasks/taskStore.js";
import { createMcpServer } from "./mcp/server.js";
import { createMcpTransport } from "./mcp/transport.js";
import { listCapabilities } from "./registry/capabilityGraph.js";
import { heartbeat, isDeviceAvailable, listDevices, pauseDevice, registerDevice, resumeDevice, revokeDevice } from "./registry/deviceStore.js";
import { handleTtsRequest, EMOTION_PRESETS } from "./tts/edgeVoice.js";

const app = express();
app.use(express.json());

export const BUILD_STAMP = "2026-10-01T10:46:00Z";

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "reach-server", mcp: "streamable-http", buildStamp: BUILD_STAMP });
});

// Narrative marketing homepage (GET /) and the operational console (GET /sim).
// Single static files; the console talks to the task mirrors below. Both work
// under tsx (server/public) and compiled output (dist/public, copied at build).
function staticCandidates(name: string): string[] {
  return [
    join(dirname(fileURLToPath(import.meta.url)), "..", "public", name),
    join(dirname(fileURLToPath(import.meta.url)), "public", name),
  ];
}
function sendStatic(res: import("express").Response, name: string): unknown {
  const found = staticCandidates(name).find((p) => existsSync(p));
  if (!found) return res.status(500).json({ error: `${name} missing: run npm run build or start via tsx` });
  res.sendFile(found);
}
app.get("/", (_req, res) => {
  sendStatic(res, "index.html");
});
app.get("/sim", (_req, res) => {
  sendStatic(res, "sim.html");
});
app.get("/sim.css", (_req, res) => {
  sendStatic(res, "sim.css");
});
app.get("/sim.js", (_req, res) => {
  sendStatic(res, "sim.js");
});

// Neural AI Text-to-Speech endpoint (Microsoft Jenny Neural AI Voice)
// Supports emotional prosody presets (cheerful, excited, calm, serious, urgent, friendly)
app.get("/api/tts", (req, res) => {
  void handleTtsRequest(req, res);
});
app.post("/api/tts", (req, res) => {
  void handleTtsRequest(req, res);
});
app.get("/api/tts/emotions", (_req, res) => {
  res.json({ default: "friendly", presets: Object.keys(EMOTION_PRESETS) });
});

// Canonical MCP surface: Streamable HTTP (MCP 2025-11-25), stateless.
// Inspector, Alexa+, and any MCP client speak here. Per the SDK's stateless
// pattern, each POST gets a fresh server + transport (no sessions exist).
app.post("/mcp", (req, res) => {
  void (async () => {
    const server = createMcpServer();
    try {
      const transport = createMcpTransport();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close();
        void server.close();
      });
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  })();
});
app.get("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
});
app.delete("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "stateless mode: no sessions to terminate" }, id: null });
});

// Legacy HTTP mirrors of the MCP tools (curl-friendly; canonical surface is /mcp).
app.post("/tools/execute_on_my_devices", (req, res) => {
  try {
    res.json(executeOnMyDevices(req.body as { task: string }));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "invalid input" });
  }
});
app.get("/tools/task/:id", (req, res) => {
  res.json(getTaskStatus({ taskId: req.params.id }));
});
app.get("/tools/tasks", (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 20) || 20, 100);
  res.json(listTasks(limit));
});

// User channel for approvals and answers (localhost browser/sim UI).
// Trusted the same way as other read/status surfaces; remote callers use the
// decide_approval MCP tool or Phase-4 OAuth. `decidedBy` is always recorded.
app.post("/approvals/:id/approve", (req, res) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] ?? "" : rawId;
  void decideApproval({ approvalId: id, decision: "approve" }, "http:sim-ui").then((out) => res.json(out));
});
app.post("/approvals/:id/deny", (req, res) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] ?? "" : rawId;
  void decideApproval({ approvalId: id, decision: "deny" }, "http:sim-ui").then((out) => res.json(out));
});
app.post("/tasks/:id/input", (req, res) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] ?? "" : rawId;
  const { text } = req.body as { text?: unknown };
  const out = answerInput(id, text);
  if (!out.ok) {
    const status = out.code === "unknown" ? 404 : out.code === "not_waiting" ? 409 : 400;
    return res.status(status).json({ error: out.error });
  }
  res.json({ ok: true, taskId: id, resumed: true });
});
app.post("/tasks/:id/cancel", (req, res) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] ?? "" : rawId;
  const { reason } = (req.body ?? {}) as { reason?: unknown };
  const task = getTask(id);
  if (!task) return res.status(404).json({ error: `unknown task ${id}` });
  const cancelled = cancelTaskById(id, typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : undefined);
  res.json({ ok: true, taskId: id, status: cancelled?.status ?? "cancelled" });
});
app.get("/debug/capabilities", (_req, res) => res.json(listCapabilities()));

// Device mesh: agents register + heartbeat here. Mutations require the shared
// secret; the read-only status view stays public for dashboards/debugging.
app.post("/devices/register", requireAgentAuth, (req, res) => {
  const { id, name, capabilities, knownApps } = req.body as {
    id?: unknown;
    name?: unknown;
    capabilities?: unknown;
    knownApps?: unknown;
  };
  if (typeof id !== "string" || !id || typeof name !== "string" || !Array.isArray(capabilities)) {
    return res.status(400).json({ error: "invalid registration: need {id, name, capabilities[]}" });
  }
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: "invalid registration: id must match [A-Za-z0-9_-]+" });
  }
  res.json(
    registerDevice({
      id,
      name,
      capabilities: capabilities.filter((c): c is string => typeof c === "string"),
      ...(Array.isArray(knownApps)
        ? { knownApps: knownApps.filter((a): a is string => typeof a === "string").slice(0, 100) }
        : {}),
    }),
  );
});
app.post("/devices/:id/heartbeat", requireAgentAuth, (req, res) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] ?? "" : rawId;
  // Optional re-advertisement: the store merges only well-formed arrays,
  // so empty/old-style beats change nothing.
  const { capabilities, knownApps } = (req.body ?? {}) as { capabilities?: unknown; knownApps?: unknown };
  const device = heartbeat(id, { capabilities: capabilities as string[], knownApps: knownApps as string[] });
  if (!device) return res.status(404).json({ error: `unknown device ${id}: re-register` });
  res.json(device);
});
app.get("/devices", (_req, res) => {
  res.json(listDevices().map((d) => ({ ...d, available: isDeviceAvailable(d), paused: !!d.disabled })));
});

// User channel (localhost sim UI, same trust as approvals/input): pause stops
// dispatch while the heartbeat continues; resume re-enables; revoke deletes
// the record (a still-running agent re-registers on its next heartbeat —
// pause is the control that holds while the agent is alive).
function deviceIdParam(req: { params: unknown }): string {
  const raw = (req.params as { id?: unknown }).id;
  return Array.isArray(raw) ? (raw[0] ?? "") : ((raw as string) ?? "");
}
app.post("/devices/:id/pause", (req, res) => {
  const device = pauseDevice(deviceIdParam(req));
  if (!device) return res.status(404).json({ error: "unknown device" });
  res.json({ ...device, available: isDeviceAvailable(device), paused: true });
});
app.post("/devices/:id/resume", (req, res) => {
  const device = resumeDevice(deviceIdParam(req));
  if (!device) return res.status(404).json({ error: "unknown device" });
  res.json({ ...device, available: isDeviceAvailable(device), paused: false });
});
app.post("/devices/:id/revoke", (req, res) => {
  if (!revokeDevice(deviceIdParam(req))) return res.status(404).json({ error: "unknown device" });
  res.json({ ok: true });
});

// Reserved well-known routes for Alexa+ OAuth 2.1 PKCE (Phase 3/4). Stub 404 for now.
app.get("/.well-known/oauth-protected-resource", (_req, res) => res.status(404).json({ error: "todo-phase-3" }));
app.get("/.well-known/oauth-authorization-server", (_req, res) => res.status(404).json({ error: "todo-phase-3" }));

const port = Number(process.env.PORT ?? 3000);
// Localhost-only by construction: remote access requires an explicit tunnel
// (documented). Never change this to a wildcard bind without route-auth review:
// /tools/*, /approvals/*, /tasks/*/input and device pause/revoke are
// same-origin user-channel routes, not internet-authenticated endpoints.
if (process.env.NODE_ENV !== "test") {
  loadEnv();
  requireAgentToken("reach-server");
  registerAgentActions();
  registerBrowserActions();
  registerWebActions();
  registerAudioActions();
  // Fail at BOOT, not at the first task. The planner rebuilds its tool list
  // from the live registry on every turn, so one action whose schema the
  // Nova converter cannot express makes every task fail with a planner
  // crash — after the server happily accepted connections. Building the list
  // once here turns that into a startup error with a usable message.
  try {
    toolsForPlanner();
  } catch (err) {
    console.error(
      `[reach-server] FATAL: the planner tool set could not be built — ${err instanceof Error ? err.message : String(err)}\n` +
        `Every task would fail at its first planner turn. This is a schema/registry bug, not a runtime condition.`,
    );
    process.exit(1);
  }
  app.listen(port, "127.0.0.1", () => console.log(`reach-server on 127.0.0.1:${port} (mcp: streamable-http stateless)`));
}

export default app;
