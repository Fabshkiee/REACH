import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DecideApprovalSchema,
  ExecuteOnMyDevicesSchema,
  GetTaskStatusSchema,
  decideApproval,
  executeOnMyDevices,
  getTaskStatus,
} from "./tools.js";

/**
 * Fresh MCP server per request (stateless mode). Tool handlers are pure
 * functions over the shared file-backed stores, so per-request instances are
 * cheap and correct — no session state exists to share.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "reach", version: "0.1.0" });
  server.registerTool(
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
  server.registerTool(
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
  server.registerTool(
    "decide_approval",
    {
      description:
        "Approve or deny one pending action. Approvals are single-use and expiring; approving grants exactly the quoted action instance.",
      inputSchema: DecideApprovalSchema.shape,
    },
    async (args) => {
      const out = decideApproval(args as { approvalId: string; decision: "approve" | "deny" }, "mcp:decide_approval");
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    },
  );
  return server;
}
