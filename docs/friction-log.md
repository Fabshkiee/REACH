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

## 2026-09-18 — Stale detached servers shadowed verification (false negative)
* Task: verify new input validation; garbage inputs all ACCEPTED despite correct code.
* Steps: ran full matrix → 4/4 accepted + task files created; checked `Win32_Process` → found old detached `node.exe` instances (from an earlier "run it" session) still holding ports 3000/3001, so test jobs silently talked to stale code.
* Expected vs actual: expected fresh-code behavior; actual stale processes won the port race with zero errors surfaced.
* Severity: Medium (verification integrity — a false negative here could have shipped doubt about correct code).
* Workaround (kept): kill all REACH node processes before verification runs; re-ran → 4/4 HTTP 400, zero files, MCP `-32602`. Purged the 6 junk task files the false run created.
* Suggestion: n/a (harness discipline — always confirm process table before trusting a verify run).

---

## 2026-09-19 — Test runner hung with zero output (unawaited handler promise)
* Task: run new `npm test` suites for A1 policy/executor.
* Steps: `tsx --test` timed out at 180s with no output at all.
* Expected vs actual: expected pass/fail lines; actual infinite hang — the executor's timeout only called `ctrl.abort()` but still `await`ed the handler, and the test handler pends forever, so the abort signalled nothing and the await never settled.
* Severity: High (suite looked broken; real product bug too — a hanging primitive would hang a task forever).
* Workaround (kept): race handler against a rejecting timeout gate (`Promise.race`), abort + reject together. Also added `--test-timeout=30000` to the test script so any future hang fails fast instead of hanging CI.
* Suggestion: n/a (product + harness fix in one).

## 2026-09-20 — Heartbeat never re-advertised: planner saw yesterday's capabilities
* Task: A2 verify — boot with 9 advertised capabilities, read back the device record.
* Steps: `GET /devices` showed the previous session's 4-cap record with a stale timestamp, even though the agent logged "heartbeat steady".
* Expected vs actual: expected fresh advertisement; actual heartbeat only touched the timestamp, so capability/app changes never propagated — planner would reason over a stale world.
* Severity: High (silent staleness in the exact data planning depends on).
* Workaround (kept): every beat carries `{capabilities, knownApps}`; server merges well-formed arrays idempotently. Re-verified: 9 caps + app map live after one beat.
* Suggestion: n/a (protocol fix — heartbeat is now advertise-or-nothing).

## 2026-09-20 — Shell-free open took three tries (PowerShell 5.1 argv rules)
* Task: replace `cmd /c start` with injection-proof opening.
* Steps: (1) base64 `-EncodedCommand` + trailing path arg → rejected ("no other arguments permitted"); (2) `-Command -` with stdin script → same rejection on 5.1; (3) static `-File` script + path as `$args[0]` → `opened: true`.
* Expected vs actual: expected any argv-passing form to work; actual 5.1 is strict about `-Command` companions.
* Severity: Low (dev-only iteration, final form has zero quoting layers by construction).
* Workaround (kept): temp-dir static script (`Start-Process -LiteralPath $args[0]`), `-ExecutionPolicy Bypass`, argv target, dir removed in `finally`.
* Suggestion: n/a.

## 2026-09-20 — xlsx ESM wrapper hides readFile off-namespace
* Task: read `.xlsx` in agent file primitive.
* Steps: `import * as XLSX` → `XLSX.readFile is not a function`, while `XLSX.writeFile` worked from the same style import.
* Expected vs actual: expected uniform namespace; actual node-only fns live on the default export.
* Severity: Low.
* Workaround (kept): read bytes with fs, parse via namespace `XLSX.read(buf, {type:"buffer"})` — stable across interop shapes.
* Suggestion: n/a.

## 2026-09-20 — Bedrock rejects dotted tool names on EVERY turn, not just definitions
* Task: A3 live proof — first Bedrock call failed `-32602`-style validation on all 9 tools.
* Steps: initial failure at `toolConfig.tools.N.toolSpec.name` (`[a-zA-Z0-9_-]+` only); mapped definitions to `files__read` form; second failure at `messages.2...toolUse.name` — history echoes re-validated per turn.
* Expected vs actual: expected name rules to apply at registration; actual Bedrock validates names on every message leg, both directions.
* Severity: Medium (would have shipped a planner that dies on step 2 of every run).
* Workaround (kept): reversible wire mapping (`toBedrockToolName`/`fromBedrockToolName` against the offered set); unmappable names fall through to the loop's unknown-tool recovery. Registry keeps dotted names everywhere else.
* Suggestion: n/a.

## 2026-09-20 — 41-char secret key caused SignatureDoesNotMatch
* Task: A3 live proof — first Bedrock call failed auth despite correct key ID.
* Steps: `doctor` measured the stored secret at 41 chars (AWS secrets are always 40); user re-copied via the console copy button; proof proceeded.
* Expected vs actual: expected paste fidelity; actual drag-selection grabbed one extra character.
* Severity: Low (user-side, 2-minute fix) — but the failure mode (cryptic signing dump) is worth designing against.
* Workaround (kept): always use the console copy button, never drag-select; Bedrock error dumps now truncated to the head line before reaching task evidence (a full canonical-string dump is camera noise).
* Suggestion: n/a.

## 2026-09-20 — Live planner cost: 3678 in / 91 out for a full run
* Task: record real spend for the Builder story.
* Steps: completed 2-turn run surfaced via new `usage` field (itself a fix — the field existed but was never returned by `get_task_status`, and call counting was wired but never incremented).
* Expected vs actual: expected dollars of uncertainty; actual fractions of a cent per run at Nova pricing. Full verification session: single-digit cents.
* Severity: Informational.
* Workaround: none needed — per-plan token accounting now ships in every evidence payload.
* Suggestion: n/a.

## 2026-09-20 — Router deletion orphaned doc creation (no planner path to .docx)
* Task: user asked for a beaver document through the uniform loop.
* Steps: realized `files.create_document` had no executor def — the v1 runner's capability died with it, so the planner could only write `.txt`. Added the def (write class, title/body schema, target from title) + test-list entry.
* Expected vs actual: expected all v1 capabilities to survive the refactor; actual the refactor commit never mapped `create_document` into the registry.
* Severity: Medium (would have read as a regression: "create a document" → `.txt` file).
* Workaround (kept): 15-line def; live proof now ends in a real opened `.docx` with model-drafted content, verified by independent OOXML read.
* Suggestion: refactor checklists should enumerate capability coverage before/after (added to this entry as the template).

## 2026-09-20 — Search found nothing on a machine holding the file (recall starvation)
* Task: "open the Beavers document" → planner searched profile-wide → zero hits → asked user.
* Steps: reproduced locally; walk was correct code-wise but collected-then-filtered with a 5k cap — a 90k-file "Coding Projects" folder (node_modules etc.) exhausted the budget before Documents was entered. Fixed in layers: filter-during-walk, priority dirs first, smallest-first ordering near the top, build-output skips (node_modules/dist/Library/Temp/DerivedDataCache/...). Verified: Beavers found.
* Expected vs actual: expected search to just work; actual default DFS order starves user locations on real dev machines.
* Severity: High (core primitive silently blind).
* Workaround (kept): ordering + skips + regression test (3000-file junkheap vs Desktop needle, limit:1 proves early find by visit count).
* Suggestion: n/a.

## 2026-09-20 — I hallucinated a task ID from status output
* Task: answer the pending `awaiting_input` question.
* Steps: called `/tasks/task_mua4hhfq_sll7/input` → "unknown task". The ID never existed — `get_task_status` output carries no ID field, and I reconstructed one from memory instead of the data dir. Real ID (`task_mua4he2q_t5eyca`, from `server/data/tasks/` listing) worked first try.
* Expected vs actual: expected the ID I "remembered"; actual it was confabulated.
* Severity: Medium (my error, 5-minute detour; also a UX note: status responses should include the task ID).
* Workaround (kept): always copy IDs from `server/data/tasks/` or the original `execute` response, never from memory. Filed as process rule, not code.
* Suggestion: n/a — owned, not the system's fault.

## 2026-09-20 — Agent root cage contradicted core policy (O: drive unreachable)
* Task: user goal needed a file on `O:\Downloads`; loop correctly tried `files.read`, agent refused "path escapes allowed root".
* Steps: the refusal was honest but wrong-layered — core policy already judges outside-profile reads as confirmable, yet the agent caged everything to homedir, making that verdict unexecutable. No error, just a capability gap shaped like a refusal.
* Expected vs actual: expected layered defense (agent blocks secrets/system, policy judges risk); actual agent duplicated policy as a tighter cage.
* Severity: High (silently shrank the reachable world; would have failed the same way for any second drive).
* Workaround (kept): agent now enforces DENY patterns only (system roots, other users, secret material, traversal-resolved); risk calls stay with core policy + approval. Live re-run: read → draft → create+open, all verified.
* Suggestion: layered controls must be tested against each other, not just alone — add a cross-layer test (core allows + agent allows) in A4.

## 2026-09-21 — Browser calls timed out; four wrong theories before IPv6
* Task: P2 live proof — every browser def timed out at exactly its call timeout.
* Steps: blamed shared transport, then stdio handling (`ignore` vs pipe correlated 4/4 in early trials), then orphans, then warm-up — each "fix" changed nothing. Instrumented stage-by-stage: spawn succeeded, port never opened. `netstat` finally showed the server on `[::1]:8931` — IPv6-only bind; the probe used literal `127.0.0.1` and could never connect.
* Expected vs actual: expected localhost ≡ 127.0.0.1; actual the upstream binds `::1` and only hostname-form probes connect.
* Severity: High (blocked the entire browser track; also burned an hour on a spurious stdio correlation).
* Workaround (kept): probe hostname `localhost`; drain child pipes with stderr tail; single-flight boots; kill-on-failed-boot. Lesson recorded: correlate across single-variable trials, and distrust any theory with fewer than three varied data points — the stdio story fit four trials and was still wrong.
* Suggestion: n/a.

## Template for new entries
* Task:
* Steps:
* Expected vs actual:
* Severity: Critical / High / Medium / Low
* Workaround:
* Suggestion:
