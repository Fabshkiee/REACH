import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listCapabilities } from "../registry/capabilityGraph.js";
import { isDeviceAvailable, listDevices } from "../registry/deviceStore.js";
import {
  DecideApprovalSchema,
  ExecuteOnMyDevicesSchema,
  GetTaskStatusSchema,
  decideApproval,
  executeOnMyDevices,
  getTaskStatus,
  listTasks,
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
      const out = await decideApproval(args as { approvalId: string; decision: "approve" | "deny" }, "mcp:decide_approval");
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    },
  );

  // Resources: what this installation can actually do right now. A client
  // (today the sim, later Alexa+) asks before it promises the user anything.
  server.registerResource(
    "capabilities",
    "reach://capabilities",
    {
      title: "Advertised capabilities",
      description:
        "Every capability advertised by a connected device, with the device that offers it and whether it is available right now.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              devices: listDevices().map((d) => ({
                id: d.id,
                name: d.name,
                available: isDeviceAvailable(d),
                paused: d.disabled === true,
                capabilities: d.capabilities,
              })),
              capabilities: listCapabilities(),
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "recent-tasks",
    "reach://tasks/recent",
    {
      title: "Recent tasks",
      description: "The most recent tasks with their status, newest first.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(listTasks(20), null, 2),
        },
      ],
    }),
  );

  // Prompt: the meeting-minutes entry point. The audio capture and
  // transcription adapters are not built yet — this prompt starts from a
  // transcript file, which is what the planner can actually reason over.
  server.registerPrompt(
    "make-meeting-minutes",
    {
      title: "Turn a meeting transcript into minutes",
      description:
        "Ask REACH to turn a meeting transcript on this laptop into a verified minutes document (decisions, owners, action items, unresolved questions).",
      argsSchema: {
        transcript: z.string().describe("Path to the transcript file (.txt, .docx, .pdf) on the laptop."),
        outputTitle: z.string().optional().describe("Title for the minutes document."),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Read the meeting transcript at ${args.transcript} and write meeting minutes from it — ` +
              `decisions, who owns each action item, and anything left unresolved — into a document titled ` +
              `"${args.outputTitle ?? "Meeting Minutes"}" on my laptop, then open it.`,
          },
        },
      ],
    }),
  );
  return server;
}
