# MCP Contract (Alexa-facing, stable)

Spec: MCP `2025-11-25` (negotiated live). Transport: **Streamable HTTP, stateless**.
Endpoint: `POST /mcp` (GET/DELETE → `405`). Remote HTTPS URL required for Alexa+
(`cloudflared` for local dev). Server code: `server/src/mcp/server.ts` (tools),
`server/src/mcp/transport.ts` (stateless + JSON responses), wired in `server/src/index.ts`.

## Error layering rule

* **Protocol errors** (unknown tool/method, bad args, malformed envelope) → JSON-RPC
  errors (`-32601`/`-32602`) or `result.isError: true`. The transport stays healthy.
* **Task failures** (device offline, no capable device, unknown taskId) → transport
  **success** with `{status:"failed", error:...}` in the tool result content.
  Failures live in the task model, never in the protocol. Full matrix: `docs/mcp-inspector.md`.

## Tools (2 only — no generic exec, no per-capability tools)

### `execute_on_my_devices`
* Input: `{ task: string }` (3–2000 chars). Natural-language goal.
* Output: `{ taskId: string }`. MUST return fast (<500ms); queue + dispatch async.
* Example: `{"task": "Create a document on my laptop for my biology homework"}` → `{"taskId": "task_..."}`

### `get_task_status`
* Input: `{ taskId: string }`.
* Output: `{ status: queued|running|completed|failed, result?, evidence?, error? }`.
* `evidence`: `{ deviceId, capabilityId, artifactUri?, note? }`.

## Core ↔ agent (MVP: HTTPS REST + polling)

* Agent → Core: `POST /devices/register {id,name,capabilities}`, `POST /devices/:id/heartbeat` every 30s.
* Core → Agent: `POST /jobs/dispatch {capability, args}`; implemented: `create_document`.
  Guard returns `403 capability not allowed` for anything outside allowlist, `501` for allowlisted-but-unimplemented.
* Available = registered + heartbeat <90s. Otherwise task → `failed` with clear error.

## Failure cases (validated Phase 3 — see `docs/mcp-inspector.md`)

* Unknown taskId → `{status:"failed", error:"unknown task ..."}` (transport success).
* Device offline → task `failed`, Alexa speaks safe fallback (never hang).
* Invalid input (empty task) → Zod validation error.
