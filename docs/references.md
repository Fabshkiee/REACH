# Reference projects — verified facts vs queued study

> Anti-hallucination rule: nothing below is claimed unless fetched from source
> in-session. Items marked UNVERIFIED are study tasks, not facts.

## Microsoft Playwright MCP — VERIFIED (README fetched 2026-09-19)

* Accessibility snapshots with structured element refs; no screenshots needed.
* Every tool carries a `Read-only: true/false` flag → adopted as `readOnly`
  thinking in our action model (read-only leans auto, mutating leans confirm/deny).
* Human-readable `element` description + exact snapshot `target` refs → matches
  our proposal shape (explanation + exact target for approval cards).
* Persistent profile (`--user-data-dir`) → confirms the one-time-login approach
  for session sites (Canva). HTTP transport (`--port` + `url`) → consuming it as
  an external MCP server is viable; build-vs-consume spikes in A2.
* "Playwright MCP is NOT a security boundary." `browser_evaluate` (arbitrary JS)
  and `browser_run_code_unsafe` (RCE-equivalent) exist → our policy must sit
  above it: those tools are never exposed to the planner (structural ban).
* Token-efficiency note → snapshot size/depth caps for planner context (A3).
* License: verify Apache-2.0 (or current) from source before consuming in A2.

## lastmile-ai/mcp-agent — VERIFIED (README fetched 2026-09-19)

* Agent = instruction + scoped server list → same shape as planner-over-declared-tools.
* `request_human_input` pausing workflows → our `awaiting_approval`/`awaiting_input`
  (they use Temporal; we use file-backed stores — same concept, no new infra).
* Orchestrator-workers + evaluator-optimizer patterns → our planner + verify-step
  vocabulary. Secrets YAML gitignored → matches our `.env` practice.
* Structured JSONL logging → adopted as `server/data/audit.jsonl`.
* Python + Temporal weight → patterns only; framework NOT adopted (TS project).

## browser-use/browser-use — VERIFIED (README fetched 2026-09-19, MIT license)

* Custom tools via decorator returning `ActionResult` → validates our
  handler-registry shape (`defineAction` + verify).
* Profile reuse (`from_system_chrome`) → second confirmation of the persistent-profile login story.
* System prompt auto-supplied, goal in `task=` → planner prompt note for A3.
* Python library → patterns only from TS; harness-js noted as A2 evaluation candidate.

## domdomegg/computer-use-mcp — VERIFIED (README fetched 2026-09-19, master)

* Explicit danger warning: prompt injection + full computer control ("hyperactive
  toddler", supervise, sandboxed account) → quoted rationale for policy-outside-execution.
* Desktop control via nut.js → pixels possible later; we stay snapshot/data-first.
* Ships `npm run test` → tests-as-norm, matches our `npm test` gate.

## anthropics/computer-use-demo — UNVERIFIED (raw + page fetch 404'd twice)

* Queued as an A2 study task (agent/tool loop, screenshot handling, recovery,
  confirmation patterns). Nothing claimed from it until fetched.
