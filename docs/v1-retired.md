# v1 — retired (archive, not truth)

> This is the ONLY place v1 is described. Everything else in `docs/` and
> `README.md` describes the v2 agent-loop architecture. For v1 code, see git
> history before the A-series builds.

**What v1 was:** a task router over fixed capabilities — one keyword regex
matched goals to a single hardcoded path (`create_document`), backed by an
explicit capability allowlist, file-backed task/device stores, heartbeat
presence, shared-secret auth that defaulted to trusting localhost, and a
Streamable HTTP MCP surface with two tools.

**What v1 proved (kept):** real `.docx` on a real laptop, durable tasks across
restarts, presence via heartbeat, MCP 2025-11-25 negotiation verified by
Inspector and an SDK client, fail-fast errors, the sim UI shell.

**Why retired:** routing named goals instead of reasoning about them; the skill
list was fixed rather than pluggable; trust-localhost was the wrong default;
document bodies echoed the request instead of carrying real content. v2 replaces
routing with a planner, skills with generic primitives, and defaults with
fail-closed policy — see `docs/architecture.md`.
