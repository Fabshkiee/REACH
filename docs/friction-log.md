# Friction Log (LIVE — bonus up to 10%)

Required fields per entry: task attempted / steps taken / expected vs actual / severity /
workaround / actionable suggestion. Add one entry per obstacle; never fabricate.

---

## 2026-09-17 — Node 22 vs required 24+ (skeleton env check)
* Task: verify local toolchain against Alexa requirement (Node 24+ in WSL2 Ubuntu).
* Steps: ran `node --version` (got `v22.19.0`), `wsl --status` (Ubuntu v2 OK), `git --version` (2.48.1 OK).
* Expected vs actual: expected Node ≥24 ready; actual Node 22 — upgrade still required in Win + WSL.
* Severity: Medium (blocks `alexa-ai` phase, not skeleton files).
* Workaround: pinned `24` in `.nvmrc`, documented `nvm install 24 && nvm use 24` in README; skeleton uses no Node-24-only APIs.
* Suggestion: Amazon docs should fail fast with a version check in `alexa-ai` CLI with an upgrade hint.

## 2026-09-17 — Empty workspace, no repo (skeleton start)
* Task: confirm starting point at `O:\Coding\REACH`.
* Steps: listed directory (0 entries); verified no git repo, no code.
* Expected vs actual: expected possible leftover scaffold; actual clean greenfield — full skeleton needed.
* Severity: Low (informational).
* Workaround: scaffolded workspaces (`server`, `windows-agent`), MIT license, base configs from scratch.
* Suggestion: n/a (project-side, not platform friction).

## 2026-09-17 — Alexa+ Private Preview gating (anticipated)
* Task: plan `alexa-ai configure` + `deploy` path.
* Steps: reviewed QuickStart; `configure` needs Preview-granted developer account (not yet requested/confirmed).
* Expected vs actual: expected immediate CLI auth; actual blocked until access granted — simulator fallback per rules.
* Severity: High if access delayed (blocks Phase 4, not skeleton/Phases 1–3).
* Workaround: build Phases 1–3 locally (agent → core → MCP Inspector); keep simulation path as backup; stub well-known auth routes now.
* Suggestion: publish current Preview wait-time estimate + a checklist for “no-access” teams to stay unblocked.

## 2026-09-17 — Missing Express types broke strict typecheck
* Task: run `npm run typecheck --workspaces` on fresh skeleton (strict TS).
* Steps: `npm install --workspaces` OK (182 pkgs, EBADENGINE warn for Node 22 vs required 24); typecheck failed `TS7016` for `express` + implicit-`any` params in both workspaces.
* Expected vs actual: expected clean typecheck; actual missing `@types/express` (express ships no bundled types).
* Severity: Low (skeleton-only, 5-min fix).
* Workaround: `npm install --save-dev @types/express --workspace=server/windows-agent`; re-ran typecheck → pass; verified `GET /health` 200 on :3000/:3001.
* Suggestion: template TS+Express scaffolds should include `@types/express` by default alongside `express`.

## 2026-09-17 — Shell defaulted to Node 22 after user upgraded to 24
* Task: run Phase 1 build/verify after user reported Node v24.21.0.
* Steps: `node --version` in fresh shell still showed v22.19.0 (`nvm list` → 22 active); ran `nvm install 24` + `nvm use 24.21.0` in-session.
* Expected vs actual: expected upgraded Node everywhere; actual nvm default still 22 per-shell until default is set.
* Severity: Low (one-time env fix).
* Workaround: prefix session commands with `nvm use 24.21.0`; `.nvmrc` (24) already pins the repo.
* Suggestion: run `nvm alias default 24.21.0` once on dev machine so every shell starts on 24.

## 2026-09-17 — Background jobs die between shell invocations
* Task: start server+agent, then test endpoints in a later command.
* Steps: `Start-Job` servers in one call → next call `Invoke-RestMethod` → connection refused; `Get-Job` empty.
* Expected vs actual: expected jobs persist; actual each tool call spawns a fresh shell, jobs die with it.
* Severity: Low (test-harness only, not product code).
* Workaround: run start + sleep + all checks + stop in a single command invocation.
* Suggestion: n/a (project-side harness note; useful for future agent-driven testing).

## 2026-09-17 — Title derivation kept "My Laptop" in filename
* Task: E2E `"Create a document on my laptop for my biology homework"` produced `My Biology Homework.docx`.
* Steps: first run produced `My Laptop For My Biology Homework.docx`; traced to laptop-strip regex requiring leading whitespace, so it missed string-start and the `^(for|on|…)` strip then ate only `on`.
* Expected vs actual: expected `My Biology Homework`; actual `My Laptop For My Biology Homework`.
* Severity: Medium (demo-visible filename).
* Workaround: reorder strips — remove `on my laptop` anywhere FIRST, then verbs, then leading prepositions. Re-ran E2E → `My Biology Homework.docx`, completed + evidence.
* Suggestion: n/a (project-side parsing note; full capability graph in Phase 2 replaces keyword routing).

## 2026-09-17 — Word locks the .docx after auto-open (cleanup blocked)
* Task: delete Phase 1 test artifacts from `~/Documents/REACH/`.
* Steps: `Remove-Item` on 3 test files; 2 deleted, `My Biology Homework.docx` → "being used by another process".
* Expected vs actual: expected free files; actual Word holds the auto-opened doc open (proves open works).
* Severity: Low (informational; close Word to release).
* Workaround: left that one file; close Word manually before demo re-takes.
* Suggestion: n/a (platform behavior, not a bug — open-failure path already best-effort in code).

## 2026-09-17 — Agent boot raced core boot: "no devices online" on fresh start
* Task: Phase 2 verify — boot core+agent together, expect immediate registration.
* Steps: started both via background jobs, waited 14s; `GET /devices` → `[]`; E2E doc → `failed "no capable device online"`.
* Expected vs actual: expected register-on-boot to land; actual agent's single register hit a still-starting core, next retry only 30s later (after the test window).
* Severity: High (demo-visible: fresh boot reads as offline; also skews fail-fast routing).
* Workaround (kept): immediate attempt at boot + retry every 5s until first success, then steady 30s (`startHeartbeat` fast lane in `windows-agent/src/agent.ts`). Re-ran → registered + available on first check.
* Suggestion: n/a (project-side timing design; worth remembering for any future multi-agent rollout).

## 2026-09-17 — DEVICE_TIMEOUT_MS shorter than heartbeat interval = permanent "offline"
* Task: Phase 2 expiry test with `DEVICE_TIMEOUT_MS=4000` and default 30s heartbeat.
* Steps: agent registered, but every `GET /devices` read `available: false` — last beat always older than 4s.
* Expected vs actual: expected available-then-expired; actual always expired between beats.
* Severity: Medium (test-harness config error, not product code).
* Workaround: test with `HEARTBEAT_INTERVAL_MS=2000` + `DEVICE_TIMEOUT_MS=6000` → available=true live, false 8s after kill. Production defaults (30s/90s) keep a 3x margin.
* Suggestion: n/a (project-side note — document the timeout > 2×interval invariant; done in README knobs).

## 2026-09-17 — PowerShell blank table on single-element JSON arrays
* Task: read `GET /devices` via `Select-Object id, available | Format-Table`.
* Steps: `ConvertTo-Json` showed the fields; `Select-Object` rendered an empty row (twice, incl. `Select -ExpandProperty`).
* Expected vs actual: expected table; actual blank — `Invoke-RestMethod` single-object array deserialization quirk.
* Severity: Low (harness display only; `ConvertTo-Json` output verified the data both times).
* Workaround: verify with `ConvertTo-Json` instead of `Select-Object` for these endpoints.
* Suggestion: n/a (tooling note for future agent-driven testing).

## 2026-09-17 — Shared-transport MCP: post-initialize calls 500'd with no server log
* Task: Phase 3 — expose the existing McpServer over Streamable HTTP with one shared transport.
* Steps: wired single `StreamableHTTPServerTransport` + `connect()` at boot; `initialize` negotiated `2025-11-25` fine, then `tools/list` and everything after → HTTP 500, nothing in server logs.
* Expected vs actual: expected shared transport to serve all requests; actual the single connected protocol instance rejects session-less follow-ups — stateless requires fresh server+transport per request (confirmed in SDK's `simpleStatelessStreamableHttp` example).
* Severity: High (core Phase 3 design, found in first test).
* Workaround (kept): `createMcpServer()` + `createMcpTransport()` factories, per-POST construction, `transport.close()`/`server.close()` on response close. Re-ran full matrix → green.
* Suggestion: SDK docs should call out "shared transport + connect-at-boot is stateful-only" next to the stateless example.

## 2026-09-17 — Windows `timeout` is not GNU timeout (Inspector attempt)
* Task: timebox the MCP Inspector CLI run.
* Steps: prefixed with `timeout 60 npx ...` → `ERROR: Invalid syntax` (Windows `timeout` is a delay command).
* Expected vs actual: expected GNU behavior; actual arg error before Inspector even started.
* Severity: Low (harness only).
* Workaround: `Start-Job` + `Wait-Job -Timeout 90` instead. Inspector CLI then worked first try.
* Suggestion: n/a (tooling note).

## 2026-09-18 — Impeccable critique scored sim.html 14/40; detector named the slop
* Task: run dual-agent critique (design review + mechanical detector) on `server/public/sim.html` before the 1:1 rewrite.
* Steps: Assessment A (heuristics, cognitive load, personas) + Assessment B (`detect.mjs`, 2 warnings) + user screenshot evidence.
* Expected vs actual: expected "close, needs polish"; actual 14/40 Poor — split empty state, log-dump evidence card, raw IDs on camera, dead-end failures. Detector precisely named two tells: 3px side-tab status borders, colored focus glow.
* Severity: Medium (demo surface is filmed; code was always fine).
* Workaround (kept): full rewrite to the 1:1 echo — unified empty state, receipt-style evidence with `<details>` IDs, recovery chips, SR announcer + focus management, poll timeout, Alexa-blue accent. Detector re-run: clean (exit 0). Critique re-run deferred to filmed-screenshot round.
* Suggestion: n/a (process note — critique-before-rewrite caught real issues eyeballing missed).

---

## Template for new entries
* Task:
* Steps:
* Expected vs actual:
* Severity: Critical / High / Medium / Low
* Workaround:
* Suggestion:
