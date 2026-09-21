# Reference projects — verified facts vs queued study

> Anti-hallucination rule: nothing below is claimed unless fetched from source
> in-session. Items marked UNVERIFIED are study tasks, not facts.

## Microsoft Playwright MCP — VERIFIED (README + LICENSE + live spike, 2026-09-19/20)

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
* License: **Apache-2.0, Microsoft Corporation — verified from source LICENSE.**
  Pin: `@playwright/mcp@0.0.82`. Attribution kept here + README credits at consume time.
* **Live spike (2026-09-20, headless Chromium): 25 tools over HTTP, readOnly
  hints present, navigate + 465-byte snapshot verified.** Planner-visible
  whitelist: navigate, snapshot, find, click, type, select_option, press_key,
  wait_for, tabs. Never exposed: evaluate, run_code_unsafe, route/unroute,
  file drop/upload, network config, screenshots (text planner can't use them).
* **Download proof (2026-09-21, hermetic local server):** `outputDir` wired to
  `~/Documents/REACH/browser-downloads`; navigate → download event →
  `fetch_download` collected a 2048-byte file **byte-identical** to the served
  payload (settle-check + size verify). External download test skipped: this
  sandbox's DNS does not resolve the test host — environment limit, not product
  behavior.
* **Connection lessons (2026-09-21, all verified by bisection):**
  `npx.cmd` cannot be spawned without a shell on Windows (EINVAL) — the pinned
  npm dependency is spawned via `process.execPath` instead, so no shell exists
  in the path at all. The upstream server binds IPv6 loopback (`::1`) — probes
  must use hostname `localhost`, never literal `127.0.0.1`. Child pipes are
  drained (backpressure would hang a long-lived server) with an stderr tail
  surfaced on boot failure. Concurrent boots share one promise; failed boots
  kill the orphan (a leaked holder once shadowed every later attempt).
* **Canva rehearsal (needs you, once):** run with `PLAYWRIGHT_HEADED=1`,
  sign into Canva in the opened browser, close it — the persistent profile
  (`server/data/browser-profile/`, gitignored) keeps the session. Never store
  or transmit those credentials; the profile never leaves the laptop.

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
