# REACH — Tell Alexa what you want. Your devices make it happen.

> **Alexa+ understands what you want. REACH gives that intent somewhere to go.**

REACH is a general agent loop for the user's computing environment: it maps
arbitrary natural-language goals onto advertised device capabilities, enforces
a risk-based policy on every action, and reports plan + trace + evidence.
Alexa+ (or any MCP client) handles conversational understanding; REACH expands
where that intent can execute — including capabilities not natively exposed
through Alexa. Truth: `docs/architecture.md`. v1 history: `docs/v1-retired.md`.

**Not a universal remote. Not Jarvis. Not a household concierge.**
Unlike Aura+ (household concierge + memory) or KinSwitch (reassignment between people),
REACH drives **goals through capabilities in your computing environment** via a
planner over an explicitly authorized, pluggable capability set. Unlike
Dwell/SHIFT/RELAY/HomeKeeper (domain planners), REACH is **infrastructure for
arbitrary user goals**: observe → plan → act → verify, with policy enforcement.

## Track / prizes

* Primary: **Alexa+** (self-hosted MCP server, MCP spec `2025-11-25` minimum, **Streamable HTTP**).
* Mini-challenge: **AWS Builder** (Bedrock-only for MVP — meeting transcript → minutes).
* Deadline: **Oct 23, 2026 12:00 PM PDT**. Video `<3min` showing real functioning.

## Architecture (v2 — see `docs/architecture.md` for truth)

```text
                Alexa+ / sim UI / any MCP client
                            │
                   MCP / HTTPS (Streamable HTTP)
                            │
              ┌─────────────▼──────────────┐
              │        REACH Core          │
              │  Planner (Bedrock)         │  goal → plan → propose → observe
              │  Executor + Policy         │  validate → allow/confirm/deny
              │  Tasks + Audit trace       │  plan + trace + evidence
              └──────┬───────────────┬─────┘
                     │               │ (HTTPS REST + polling)
              ┌──────▼─┐          ┌──▼──────┐
              │ Laptop │          │  future │
              │ Agent  │          │ agents  │
              └────┬───┘          └─────────┘
                   │
        files / browser / apps primitives
```

* Agent-facing surface: `execute_on_my_devices(task)` → async `taskId` (<500ms);
  `get_task_status` → status + plan + trace + evidence (`queued → running →
  completed/failed`, plus `awaiting_approval` / `awaiting_input`);
  `decide_approval` → resolve action-specific approvals.
* No raw shell, no per-goal routes. The model proposes; the executor decides.
* Device is `available` = authenticated + recent heartbeat + reachable. Fail safely when offline.

## Repo shape

```text
reach/
├── server/           # REACH Core: planner, executor, policy, MCP, tasks, audit
├── windows-agent/    # Laptop agent: file/browser/app primitives, heartbeat
├── addon-package/    # Alexa+ addon.json stub (fill icons/privacy URLs before deploy)
├── docs/             # architecture (truth), contract, security, checklists, demo script
└── README.md
```

## Prerequisites

* Windows 10/11 + **WSL2 + Ubuntu** (build env): `wsl --status` → Ubuntu, version 2.
* **Node.js 24+** in BOTH Windows and WSL: `node --version` must be ≥24.
  * Current repo pins `24` in `.nvmrc`. With nvm: `nvm install 24 && nvm use 24`.
  * Repo was scaffolded on Node 22.19.0 — upgrade required before `alexa-ai` work.
* Git, MCP Inspector (`npx @modelcontextprotocol/inspector`), `cloudflared` (tunnel for local MCP dev).
* Accounts: Amazon/Alexa developer + **Alexa+ Private Preview request**, AWS account (+ $150 credit request by Oct 21 12pm PT), GitHub.

## Setup / run (skeleton)

```bash
# WSL2 Ubuntu (recommended)
cd /mnt/o/Coding/REACH   # adjust to your mount
nvm use 24               # or install Node 24 LTS
npm install
npm run typecheck

# Terminal 1 — REACH Core (MCP on :3000, sim UI, device mesh)
npm run dev:server       # → http://localhost:3000/health → 200 {"ok":true}

# Terminal 2 — Windows agent (registers + heartbeats, does the real work on :3001)
npm run dev:agent        # → http://localhost:3001/health → 200 {"ok":true}

# Browser — simulated Alexa+ interaction (text stand-in for voice, real backend)
# → http://localhost:3000/sim
```

Windows PowerShell equivalents work for quick checks, but use WSL for `alexa-ai` CLI later:
`alexa-ai configure` (after Preview granted) → `alexa-ai new mcp` / `deploy` → web simulator test.

## Proven so far (v1 milestones — engine since replaced, see `docs/v1-retired.md`)

> “Create a document on my laptop for my biology homework.”
> → `My Biology Homework.docx` created + opened in `~/Documents/REACH`,
> via Inspector, SDK client, and sim UI; tasks survive restarts; presence via
> heartbeat; MCP 2025-11-25 over Streamable HTTP.

```bash
# Terminal 1 — REACH Core
npm run dev:server

# Terminal 2 — Windows agent (auto-registers + heartbeats every 30s)
npm run dev:agent

# Auth today: set the SAME AGENT_TOKEN on both sides to enforce Bearer auth.
# (Unset = local traffic trusted with a boot warning — v2 direction is fail-closed;
#  lands in the A-series builds. Never commit secrets — see docs/security.md.)
#   $env:AGENT_TOKEN="dev-secret"  (PowerShell) / AGENT_TOKEN=dev-secret (bash)
# Test knobs: DEVICE_TIMEOUT_MS (default 90000), HEARTBEAT_INTERVAL_MS (default 30000),
#   REACH_DATA_DIR (default <server-cwd>/data), DISPATCH_TIMEOUT_MS (default 60000).

# Terminal 3 — direct capability test
curl -X POST localhost:3001/capabilities/create_document `
  -H "content-type: application/json" `
  -d '{"title":"Biology Homework","body":"Cell structure"}'

# End-to-end (same routing Alexa will use)
curl -X POST localhost:3000/tools/execute_on_my_devices `
  -H "content-type: application/json" `
  -d '{"task":"Create a document on my laptop for my biology homework"}'
# → {"taskId":"task_..."} in ~200ms, then:
curl localhost:3000/tools/task/<taskId>
# → {"status":"completed","evidence":{"deviceId":"windows-laptop",
#     "capabilityId":"create_document","artifactUri":"...\\My Biology Homework.docx"}}
```

## AWS Builder plan (Bedrock as the planner brain)

* Bedrock (Converse, Haiku default via `BEDROCK_MODEL_ID`, `us-east-1`) drives the
  ReAct loop — goal → plan → proposed actions — and drafts structured document
  content. Runtime hook exists today (`BedrockRuntimeClient` in
  `server/src/aws/bedrock.stub.ts`); live calls land in the A-series builds.
* Meeting-transcription hero parked; content drafting folded into the planner.
* Document model + usage in `docs/aws-builder.md` + Product Feedback at submission.

## Submission pointers

* License: MIT at repo root (Devpost-detectable).
* Runtime hook: `McpServer` created per request in `server/src/mcp/server.ts`, `BedrockRuntimeClient` imported in stub (live Bedrock in A-series).
* Video (TODO): `<3min` — three unrelated goals on one engine + approval beat. Script: `docs/demo-script.md`.
* Friction log (bonus up to 10%): `docs/friction-log.md` — updated continuously.
* Checklist: `docs/submission-checklist.md`.

## Status

Docs sprint: v2 truth written (`docs/architecture.md` + `docs/v1-retired.md`).
Build order: A1 policy+executor → A2 primitives → A3 planner loop → A4 sim approvals + acceptance → film.
