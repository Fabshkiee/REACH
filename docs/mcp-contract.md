# MCP Contract (client-facing, stable surface)

> Current truth (v2). v1 history: `docs/v1-retired.md`.

Spec: MCP `2025-11-25` (negotiated live). Transport: **Streamable HTTP, stateless**.
Endpoint: `POST /mcp` (GET/DELETE → `405`). Remote HTTPS URL required for Alexa+
(`cloudflared` for local dev). Server code: `server/src/mcp/server.ts` (surface),
`server/src/mcp/transport.ts` (stateless + JSON responses), planner/executor/policy
behind it — see `docs/architecture.md`.

## Error layering rule

* **Protocol errors** (unknown tool/method, bad args, malformed envelope) → JSON-RPC
  errors (`-32601`/`-32602`) or `result.isError: true`. The transport stays healthy.
* **Task failures** (device offline, unplannable goal, unknown taskId) → transport
  **success** with `{status:"failed", error:...}` in the tool result content.
* **Policy outcomes** are task-level, never protocol-level: denials fail with the
  reason quoted; confirmation-gated actions pause the task (`awaiting_approval`)
  with the proposed action quoted. Full matrix: `docs/mcp-inspector.md`.

## Tools (semantic surface — never per-goal routes)

### `execute_on_my_devices`
* Input: `{ task: string }` (trimmed, 3–2000 chars, placeholders refused). Any natural-language goal.
* Output: `{ taskId: string }`. MUST return fast (<500ms); planning + execution run async.
* Every goal runs the same planner → executor → policy loop (lands in A3, which
  deletes goal-string routing; until then the v1 router serves doc goals only —
  see `docs/v1-retired.md`). No per-goal routes in v2, ever.

### `get_task_status`
* Input: `{ taskId: string }`.
* Output: `{ status, plan?, trace?, evidence?, error?, pendingApproval?, pendingInput? }`.
* `status`: `queued → running → completed/failed`, plus `awaiting_approval` / `awaiting_input`.
* `evidence`: `{ plan, steps[{action, result, verifiedAt}], artifacts[], reasoning }`.

### `decide_approval`
* Input: `{ approvalId: string, decision: "approve" | "deny" }`.
* Resolves one action-specific, expiring approval. Approving grants exactly the
  quoted action instance — never a blanket permission.

## Resources & prompts

* `reach://capabilities` — advertised capabilities across online devices.
* `reach://tasks/recent` — recent tasks with statuses.
* `make-meeting-minutes` prompt — structured minutes workflow (parked with the hero; landing in A-series).

## Core ↔ agent (executor channel, Bearer-authed)

* Agent → Core: `POST /devices/register {id,name,capabilities}`, `POST /devices/:id/heartbeat` every 30s.
* Core → Agent: validated primitive invocations (files/browser/apps), each schema-checked,
  timed, audited, and result-verified. No raw shell exists on either side.
* Available = registered + heartbeat <90s. Otherwise tasks fail (or ask) with clear reasons.

## Failure cases (validated Phase 3 — see `docs/mcp-inspector.md`)

* Unknown taskId → `{status:"failed", error:"unknown task ..."}` (transport success).
* Device offline → task `failed`, client speaks safe fallback (never hang).
* Invalid input (empty/placeholder task) → Zod validation error, no task created.
