# Architecture (v2 — current truth)

> Current truth: agent-loop architecture. v1 history lives only in `docs/v1-retired.md`
> and git history — nothing below describes v1 behavior.

REACH is a **general-purpose, Jarvis-like agent for the user's connected
computing environment** with a load-bearing boundary: it acts only through a
capability that is installed, reachable, and authorized for the exact target
and scope. It maps arbitrary natural-language goals onto advertised device
capabilities, enforces a risk-based policy on every action, and reports
plan + trace + evidence. Capabilities are plugged in, never hardcoded into routing.

```text
                Alexa+ / sim UI / any MCP client
                            │
                   MCP / HTTPS (Streamable HTTP, 2025-11-25)
                            │
              ┌─────────────▼──────────────┐
              │        REACH Core          │
              │                            │
              │  Layer 1  Planner (Bedrock)│  goal → plan → propose → observe
              │  Layer 2  Executor         │  validate → dispatch → verify
              │  Layer 3  Policy engine    │  allow / confirm / deny per action
│  Tasks    queued → running → completed/failed
│           (+ awaiting_approval / awaiting_input; complete/partial/cannot/unverified
│            outcomes land in Slice B — today only completed/failed, see Build status)
              │  Audit    every action: schema-checked, timed, logged, verified
              └──────┬───────────────┬─────┘
                     │               │  HTTPS REST + polling
              ┌──────▼─┐          ┌──▼──────┐
              │ Laptop │          │  future │
              │ Agent  │          │ agents  │
              └────┬───┘          └─────────┘
                   │
        files / browser / apps primitives
```

## The loop (the core product)

```text
Goal → inspect environment → reason next action → propose
     → policy check → execute → verify result → continue / replan / recover
     → report plan + trace + evidence
```

* The model **proposes**; the executor **decides**. No action runs unvalidated.
* The planner can emit `ask_user` when a target genuinely can't be inferred —
  the only questionnaire, per-decision, never setup.
* Verification is mandatory after meaningful actions; the full trace ships in evidence.

## Layer 2 — generic primitives (typed, not task skills)

Capabilities are uniform `{id, schema, scopes, handler}` entries: files
(search/read/write/move/verify, incl. pdf/xlsx readers), browser
(goto/snapshot/act/download via Playwright), apps (launch known-safe +
open-by-association). Adding one is ~20 lines; routing never names goals.

## Layer 3 — policy (risk × target × scope × intent)

* **Auto:** ordinary user-owned operations with clear intent (find in Downloads,
  move to the tax folder, save to Desktop).
* **Confirm:** delete, overwrite, send/submit/publish/purchase, unknown binaries,
  ambiguous or sensitive targets. Action-specific, scoped, expiring approvals.
* **Deny:** system dirs, other users' data, known secret locations, code execution.
  No raw shell exists anywhere in the system.
* User-owned space is **inferred** (profile minus deny patterns), never configured
  per folder. See `docs/security.md`.

## Proving generality (acceptance, not features)

One dependable hero plus two supporting tests on the same engine — if any needs
custom routing, the architecture failed: (1) hero: find → understand/transform →
create local DOCX → verify (locked v1 scope), (2) read-only browser (e.g. GitHub
issues), (3) safety: clean `CANNOT` or exact approval boundary. Demo spine:
`docs/demo-script.md` (to be rewritten to hero; current script still shows old 3-proof cut).

## Build status (what exists vs what is planned — read before citing anything above)

* **Built and verified:** Streamable HTTP MCP (`/mcp`, 2025-11-25), file-backed
  task/device stores, heartbeat mesh with re-register **and re-advertisement**,
  Bearer channel auth with fail-closed boot gate (note: middleware still skips if
  constructed without token — boot gate is the enforcement layer), `.env` + `doctor`, sim UI shell,
  Inspector + SDK-client validation, policy engine + action framework + executor
  with audit trace, approvals/input model with single-use expiring nonces,
  `decide_approval` tool, `npm test` green (both workspaces), agent file/app
  primitives (search/read/write/move/verify/delete/open/launch) with sandbox +
  shell-free open, executor action defs for all of them, browser adapter live
  (navigate/observe/download proven end-to-end; whitelist enforced; `browser_tabs`
  allowed at MCP gate but unwired to planner; `package.json` uses `^0.0.82`, exact
  pin enforced by test + lockfile; Canva
  rehearsal pending your one-time login), **Bedrock planner loop live on
  `amazon.nova-lite-v1:0` (ReAct, registry-generated tools, resume, uniform routing — keyword
  router deleted, proven by structural test), approve-executes semantics,
  narrated-only finishes fail, per-plan token accounting**.
* **Planned next (finished v1, single-user local, laptop-only):** Slices B–E DONE
  (B: honest outcomes/budgets/cancel; C: mandatory verifiers, event trail,
  full-detail approvals, sim timeline; D: no-phantom graph, pause/revoke,
  127.0.0.1 bind, fail-closed middleware, approval guards; E: teaching errors,
  reflect-and-retry loop, files.list, paged files.read; server 96/96 + agent
  24/24 green 2026-09-24, live Bedrock Q&A proven over HTTP).
  Next: one local DOCX hero rehearsal. Sim approval/question cards are built;
  v1 hero is local-only.
* Anything in this doc without a "planned" mark describes intent shared by both
  layers only where the built code already supports it; when in doubt, the code
  wins and the doc gets fixed.

## Positioning (unchanged, Jarvis-like vision)

REACH is a Jarvis-like general agent with a hard authorization boundary — not a
universal remote with no permissions. Unlike domain
agents, REACH is infrastructure: the impressive part is a real non-native
capability executing through a general loop — prowess proven by *unrelated*
goals succeeding on the *same* engine.
