# MCP Contract (Alexa-facing, stable)

Spec: MCP `2025-11-25` minimum. Transport: **Streamable HTTP**. Remote HTTPS URL required
(`cloudflared` for local dev). Server code: `server/src/mcp/tools.ts`, wired in `server/src/index.ts`.

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
* Core → Agent: `POST /jobs/dispatch {capability, args}` → `501 not_implemented` until Phase 1;
  guard returns `403 capability not allowed` for anything outside allowlist.
* Available = registered + heartbeat <90s. Otherwise task → `failed` with clear error.

## Failure cases (validate with MCP Inspector in Phase 3)

* Unknown taskId → `{status:"failed", error:"unknown task ..."}`.
* Device offline → task `failed`, Alexa speaks safe fallback (never hang).
* Invalid input (empty task) → Zod validation error.
