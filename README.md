# REACH — Tell Alexa what you want. Your devices make it happen.

> **Alexa+ understands what you want. REACH gives that intent somewhere to go.**

REACH is a general agent loop for the user's computing environment: it maps
arbitrary natural-language goals onto advertised device capabilities, enforces
a risk-based policy on every action, and reports plan + trace + evidence.
Alexa+ (or any MCP client) handles conversational understanding; REACH expands
where that intent can execute — including capabilities not natively exposed
through Alexa. Truth: `docs/architecture.md`. v1 history: `docs/v1-retired.md`.

REACH is a general-purpose, Jarvis-like agent for your connected computing
environment — with a load-bearing boundary: it acts only through a capability
that is installed, reachable, and authorized for the exact target and scope.
Unlike Aura+ (household concierge + memory) or KinSwitch (reassignment between
people), REACH drives **goals through capabilities in your computing
environment** via a planner over an explicitly authorized, pluggable capability
set. Unlike Dwell/SHIFT/RELAY/HomeKeeper (domain planners), REACH is
**infrastructure for arbitrary user goals**: observe → plan → act → verify,
with policy enforcement.

## Track / prizes

* Primary: **Alexa+** (self-hosted MCP server, MCP spec `2025-11-25` minimum, **Streamable HTTP**).
* Mini-challenge: **AWS Builder** (Bedrock as planner brain — Nova Pro, planning + drafting).
* Deadline: **Oct 23, 2026 12:00 PM PDT**. Video `<3min` showing real functioning.
* Demo client: **sim locked** (Alexa+ toolkit partner-gated, no live integration in video). REACH is Alexa+-compatible MCP (simulated in video): `execute_on_my_devices → get_task_status → decide_approval`. No Amazon marks in REACH UI.

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
* No raw shell in v2; no per-goal routes in v2 (keyword router deleted in A3).
* Device is `available` = authenticated + recent heartbeat + reachable. Fail safely when offline.
* The planner is only offered capabilities a connected device **advertises** —
  a primitive the machine cannot run is never on the table.

## Repo shape

```text
reach/
├── server/           # REACH Core: planner, executor, policy, MCP, tasks, audit
├── windows-agent/    # Laptop agent: file/browser/app primitives, heartbeat
├── addon-package/    # Alexa+ addon.json stub (fill icons/privacy URLs before deploy)
├── docs/             # architecture (truth), contract, security, checklists, demo script
├── tests/e2e/        # independent 4-tier black-box suite (187 tests, no network needed)
├── assets/           # sample-meeting.mp3 — the demo input, so the hero runs from a clean clone
└── README.md
```

> The folder is still called `windows-agent` — a v1 leftover. The agent itself
> runs on **macOS, Linux and Windows**: the file primitives are cross-platform,
> and the Windows-only desktop-control primitives are advertised on Windows only.

## Prerequisites

* **Node.js 24+** on the machine that runs the core and the agent. Repo pins `24` in `.nvmrc`.
* Git; MCP Inspector (`npx @modelcontextprotocol/inspector`) for protocol checks.
* Accounts: Amazon/Alexa developer (+ Alexa+ Private Preview request), AWS account
  with **Bedrock model access enabled** for `amazon.nova-pro-v1:0`, GitHub.
* macOS: `npx playwright install chromium` once, for the browser adapter.

## Setup / run

```bash
cd /path/to/REACH
nvm use 24               # or install Node 24 LTS
npm install
npm run typecheck
npm run doctor           # preflight: .env, AWS keys, live Bedrock probe, ports, data dir
npm test                 # server suite (130 tests)
npm run test:agent       # laptop agent suite (51 tests)
npm run test:e2e         # 4-tier black-box suite (187 tests, all offline)

# The demo input — the hero workflow transcribes this recording
cp assets/sample-meeting.mp3 ~/Downloads/product-sync-2026-10-21.mp3

# Terminal 1 — REACH Core (MCP on :3000, sim UI, device mesh)
npm run dev:server       # → http://localhost:3000/health → 200 {"ok":true}

# Terminal 2 — Laptop agent (registers + heartbeats, does the real work on :3001)
npm run dev:agent        # → http://localhost:3001/health → 200 {"ok":true}

# Browser — simulated Alexa+ interaction (text stand-in for voice, real backend)
# → http://localhost:3000/sim
```

## Configuration

`.env` at the repo root (copy `.env.example`). **Never commit it** — it is gitignored.

* `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (default `us-east-1`),
  `BEDROCK_MODEL_ID` (default `amazon.nova-pro-v1:0`) — live planning.
* `AGENT_TOKEN` — **required**; the core and the agent refuse to boot without it
  (test env is exempt). Same value on both sides.
* Knobs: `DEVICE_TIMEOUT_MS` (90000), `HEARTBEAT_INTERVAL_MS` (30000),
  `REACH_DATA_DIR` (default `<server-cwd>/data`), `DISPATCH_TIMEOUT_MS` (60000),
  `APPROVAL_TTL_MS` (600000), `PLANNER_MAX_STEPS` (8), `TASK_MAX_ELAPSED_MS` (600000).

## Working with it

```bash
# End-to-end through the same routing Alexa uses
curl -X POST localhost:3000/tools/execute_on_my_devices \
  -H "content-type: application/json" \
  -d '{"task":"Create a document on my laptop for my biology homework"}'
# → {"taskId":"task_..."} in ~200ms, then:
curl localhost:3000/tools/task/<taskId>
# → {"status":"completed","outcome":{...},"evidence":{...}}
```

The sim at `http://localhost:3000/sim` shows the plan, the per-step trace, the
event trail and the approval card for the same engine.

## AWS Builder plan (Bedrock as the planner brain)

* Bedrock (Converse, `amazon.nova-pro-v1:0` by default, `BEDROCK_MODEL_ID` to
  change, `us-east-1`) drives the ReAct loop — goal → plan → proposed actions —
  and drafts the body of every generated document. Live planner loop is checked
  in (`server/src/planner/bedrock.ts` + `loop.ts`).
* Nova Pro replaced Nova Lite on 2026-10-01: Lite looped on unexpected 404s
  and obstacles. Fallback: `amazon.nova-lite-v1:0`.
* Meeting-transcription hero is parked — the transcript→minutes *reasoning* is
  live in the planner, the audio capture and Transcribe are the next adapters.
* Document model + usage in `docs/aws-builder.md` + Product Feedback at submission.

## Submission pointers

* License: MIT at repo root (Devpost-detectable).
* Runtime hook: `McpServer` created per request in `server/src/mcp/server.ts`,
  live Bedrock planner (`server/src/planner/bedrock.ts`, default `amazon.nova-pro-v1:0`).
* Video (`docs/demo-script.md`): `<3min` — one hero workflow (turn a meeting
  transcript into verified minutes on the laptop) + a read-only browser task +
  an approval beat, all on one engine. Sim locked, simulated — not live Alexa+.
* Friction log (bonus up to 10%): `docs/friction-log.md` — updated continuously.
* Checklist: `docs/submission-checklist.md`.

## Status

* **Engine**: planner loop, policy engine, executor with mandatory verifiers,
  approvals (single-use, expiring, approve-executes), honest outcomes
  (`complete` / `partial` / `unverified` / `failed` / `cannot`), event trail,
  resumable tasks with cumulative budgets — all live and tested. A success
  claim must cite evidence from *that* task: a task that executed nothing
  cannot report success. A task that pauses and resumes keeps the **results**
  of its earlier actions, not just a summary of them.
* **Agent**: files (search/read/list/write/move/delete/verify), real `.docx`
  creation from **Markdown** (headings, lists, tables, emphasis — the model
  plans the document's structure, the agent renders it), browser adapter
  (Playwright MCP), web search, app/document openers, microphone recording.
* **Audio**: `audio.transcribe` reads a recording from the laptop, uploads it
  to S3 and runs **Amazon Transcribe**; the audio is deleted from S3
  afterwards. Uploading is confirm-tier — REACH asks before your recording
  leaves the machine.
* **Cross-platform**: the agent and the policy engine run on macOS, Linux and
  Windows. Windows-only primitives (window focus, keystrokes, clipboard) are
  advertised on Windows only.
* **Not built**: audio capture and transcription, long-running (>10 min) jobs,
  push delivery, live Alexa+ integration (partner-gated), external MCP
  connectors, smart-home.
* Next: rehearse the hero end to end, film it, then build the long-running
  execution model that the meeting use case needs.
