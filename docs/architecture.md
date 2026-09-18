# Architecture (v2 — current truth)

> Current truth: agent-loop architecture. v1 history lives only in `docs/v1-retired.md`
> and git history — nothing below describes v1 behavior.

REACH is a **control plane for the user's computing environment**: a general
agent loop that maps arbitrary natural-language goals onto advertised device
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
              │           (+ awaiting_approval / awaiting_input)
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

Three unrelated goals, zero special cases — if any needs custom routing, the
architecture failed: (1) browser+file (find + download), (2) local organize
(find + rename + move, with an approval beat), (3) application inspect + report.
Demo spine: `docs/demo-script.md`.

## Build status (what exists vs what is planned — read before citing anything above)

* **Built and verified:** Streamable HTTP MCP (`/mcp`, 2025-11-25), file-backed
  task/device stores, heartbeat mesh with re-register, Bearer channel auth,
  fail-fast task model, sim UI shell, Inspector + SDK-client validation.
* **Planned in A-series:** planner loop (A3), generic primitives (A2), policy
  engine + approvals/ask_user (A1), fail-closed boot + shell-free open (A1/A2),
  keyword-router deletion (A3), live Bedrock calls (A3).
* Anything in this doc without a "planned" mark describes intent shared by both
  layers only where the built code already supports it; when in doubt, the code
  wins and the doc gets fixed.

## Positioning (unchanged)

Not a universal remote, not Jarvis, not a household concierge. Unlike domain
agents, REACH is infrastructure: the impressive part is a real non-native
capability executing through a general loop — prowess proven by *unrelated*
goals succeeding on the *same* engine.
