# MCP Validation (Phase 3 — reproduced 2026-09-17)

Endpoint: `http://localhost:3000/mcp` (stateless Streamable HTTP, JSON responses).
Requires header `Accept: application/json, text/event-stream` on POSTs.

## Curl transcript

```bash
H="-H Content-Type:application/json -H Accept:application/json,text/event-stream"

# initialize → 2025-11-25, serverInfo reach/0.1.0
curl -X POST localhost:3000/mcp $H -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"reach-verify","version":"0.1.0"}}}'

# initialized notification → 202, empty
curl -X POST localhost:3000/mcp $H -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# tools/list → execute_on_my_devices, get_task_status (with Zod-derived schemas)
curl -X POST localhost:3000/mcp $H -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# valid call → {"taskId":"task_..."} in ~60ms; poll get_task_status → completed + evidence
curl -X POST localhost:3000/mcp $H -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"execute_on_my_devices","arguments":{"task":"Create a document on my laptop for my mcp protocol test"}}}'
```

## Invalid-case matrix (all verified)

| Case | Result |
|---|---|
| Unknown tool `run_command` | `result.isError: true`, `-32602 Tool run_command not found` |
| Missing `task` arg | `result.isError: true`, `-32602` input validation error |
| Unknown method `tools/nope` | JSON-RPC `-32601 Method not found` |
| Unknown `taskId` | Transport success + `{status:"failed", error:"unknown task ..."}` (task layer, by design) |
| Malformed JSON body | HTTP 400 |
| `GET /mcp`, `DELETE /mcp` | HTTP 405 (stateless: no streams/sessions) |

## Client interop (verified)

* **SDK client** (`@modelcontextprotocol/sdk` Client + StreamableHTTPClientTransport):
  list → call → poll → `completed` + real `.docx` evidence.
* **MCP Inspector CLI** (`npx @modelcontextprotocol/inspector --cli <url> --method tools/list`):
  connects, lists both tools with full input schemas.
