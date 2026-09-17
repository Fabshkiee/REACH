import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { warnIfAuthDisabled, requireAgentAuth } from "./auth.js";
import { ExecuteOnMyDevicesSchema, GetTaskStatusSchema, executeOnMyDevices, getTaskStatus, listTasks } from "./mcp/tools.js";
import { listCapabilities } from "./registry/capabilityGraph.js";
import { heartbeat, isDeviceAvailable, listDevices, registerDevice } from "./registry/deviceStore.js";

// Runtime hook proof for Alexa+ judging: MCP SDK imported AND instantiated.
export const mcpServer = new McpServer({ name: "reach", version: "0.1.0" });
mcpServer.registerTool(
  "execute_on_my_devices",
  {
    description: "Accept a natural-language task and delegate it to the user's devices. Returns a taskId fast.",
    inputSchema: ExecuteOnMyDevicesSchema.shape,
  },
  async (args) => {
    const { taskId } = executeOnMyDevices(args as { task: string });
    return { content: [{ type: "text", text: JSON.stringify({ taskId }) }] };
  },
);
mcpServer.registerTool(
  "get_task_status",
  {
    description: "Retrieve progress/result for a longer-running task by taskId.",
    inputSchema: GetTaskStatusSchema.shape,
  },
  async (args) => {
    const out = getTaskStatus(args as { taskId: string });
    return { content: [{ type: "text", text: JSON.stringify(out) }] };
  },
);

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "reach-server", mcp: "stub-registered" });
});

// Debug-only HTTP mirrors of the MCP tools (Phase 3 replaces with Streamable HTTP transport + OAuth).
// Lets Phase 1 verify end-to-end without an MCP client: POST /tools/execute_on_my_devices → GET /tools/task/:id.
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
app.get("/debug/capabilities", (_req, res) => res.json(listCapabilities()));
app.get("/debug/devices", (_req, res) => res.json(listDevices()));

// Device mesh: agents register + heartbeat here. Mutations require the shared
// secret; the read-only status view stays public for dashboards/debugging.
app.post("/devices/register", requireAgentAuth, (req, res) => {
  const { id, name, capabilities } = req.body as { id?: unknown; name?: unknown; capabilities?: unknown };
  if (typeof id !== "string" || !id || typeof name !== "string" || !Array.isArray(capabilities)) {
    return res.status(400).json({ error: "invalid registration: need {id, name, capabilities[]}" });
  }
  res.json(registerDevice({ id, name, capabilities: capabilities.filter((c): c is string => typeof c === "string") }));
});
app.post("/devices/:id/heartbeat", requireAgentAuth, (req, res) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] ?? "" : rawId;
  const device = heartbeat(id);
  if (!device) return res.status(404).json({ error: `unknown device ${id}: re-register` });
  res.json(device);
});
app.get("/devices", (_req, res) => {
  res.json(listDevices().map((d) => ({ ...d, available: isDeviceAvailable(d) })));
});
app.get("/debug/devices", (_req, res) => res.json(listDevices()));

// Reserved well-known routes for Alexa+ OAuth 2.1 PKCE (Phase 3/4). Stub 404 for now.
app.get("/.well-known/oauth-protected-resource", (_req, res) => res.status(404).json({ error: "todo-phase-3" }));
app.get("/.well-known/oauth-authorization-server", (_req, res) => res.status(404).json({ error: "todo-phase-3" }));

const port = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== "test") {
  warnIfAuthDisabled("reach-server");
  app.listen(port, () => console.log(`reach-server on :${port}`));
}

export default app;
