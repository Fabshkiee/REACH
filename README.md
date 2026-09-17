# REACH — Tell Alexa what you want. Your devices make it happen.

> **Alexa+ understands what you want. REACH gives that intent somewhere to go.**

REACH is an MCP-powered capability bridge between Alexa+ and the user's personal devices.
Alexa+ handles conversational understanding; REACH expands where that intent can execute —
including capabilities not natively exposed through Alexa (e.g. creating a real `.docx` on your laptop).

**Not a universal remote. Not Jarvis. Not a household concierge.**
Unlike Aura+ (household concierge + memory) or KinSwitch (reassignment between people),
REACH delegates across **devices/capabilities in your computing environment** via an explicitly
authorized capability allowlist. Unlike Dwell/SHIFT/RELAY/HomeKeeper (domain planners),
REACH is **infrastructure for arbitrary user goals**: required capabilities → available devices → execution.

## Track / prizes

* Primary: **Alexa+** (self-hosted MCP server, MCP spec `2025-11-25` minimum, **Streamable HTTP**).
* Mini-challenge: **AWS Builder** (Bedrock-only for MVP — meeting transcript → minutes).
* Deadline: **Oct 23, 2026 12:00 PM PDT**. Video `<3min` showing real functioning.

## Architecture

```text
                Alexa+
                  │
             MCP / HTTPS (Streamable HTTP)
                  │
        ┌─────────▼─────────┐
        │    REACH Core     │  server/
        │ Intent / Tasks    │
        │ Capability Graph  │
        │ Device Registry   │
        └──────┬──────┬─────┘
               │      │ (HTTPS REST + polling for MVP)
        ┌──────▼─┐  ┌─▼───────┐
        │ Laptop │  │  iPhone │ (later)
        │ Agent  │  │  Agent  │
        └────┬───┘  └────┬────┘
             │            │
      Files / Apps   Photos / Shortcuts
```

* Alexa-facing surface (stable, semantic, 2 tools only):
  * `execute_on_my_devices(task: string) → { taskId }` — async, returns fast (<500ms).
  * `get_task_status(taskId) → { status, result? }` — `queued → running → completed/failed`.
* No `run_command`, no per-capability Alexa tools.
* Device is `available` = authenticated + recent heartbeat + reachable. Fail safely when offline.

## Repo shape

```text
reach/
├── server/           # REACH Core + MCP (Streamable HTTP) + registry + tasks + Bedrock stub
├── windows-agent/    # Laptop agent: health, heartbeat, capability allowlist (create_document first)
├── addon-package/    # Alexa+ addon.json stub (fill icons/privacy URLs before deploy)
├── docs/             # contract, checklists, friction log, demo script, submission checklist
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

# Terminal 1 — REACH Core skeleton (health only)
npm run dev:server       # → http://localhost:3000/health → 200 {"ok":true}

# Terminal 2 — Windows agent skeleton (health + stubs)
npm run dev:agent        # → http://localhost:3001/health → 200 {"ok":true}
```

Windows PowerShell equivalents work for quick checks, but use WSL for `alexa-ai` CLI later:
`alexa-ai configure` (after Preview granted) → `alexa-ai new mcp` / `deploy` → web simulator test.

## MVP proof (Phase 1, not yet implemented)

> “Alexa, create a document on my laptop for my biology homework.”
> → `Biology Homework.docx` created/opened on the Windows laptop.

Skeleton currently returns `not_implemented` for capabilities — wiring is Phase 1.

## AWS Builder plan (Bedrock-only)

* `server/src/aws/bedrock.stub.ts` imports `BedrockRuntimeClient` (runtime hook) and exposes
  `generateMinutes(transcript)` TODO. Real call lands in hero workflow:
  meeting capture → transcript → Bedrock → minutes → saved `.docx`.
* Document model + usage in `docs/aws-builder.md` + Product Feedback at submission.

## Submission pointers

* License: MIT at repo root (Devpost-detectable).
* Runtime hook: `McpServer` instantiated in `server/src/index.ts`, `BedrockRuntimeClient` imported in stub.
* Video (TODO): `<3min`, film real `.docx` on laptop + simulator. Script: `docs/demo-script.md`.
* Friction log (bonus up to 10%): `docs/friction-log.md` — updated continuously.
* Checklist: `docs/submission-checklist.md`.

## Status

Skeleton sprint: health endpoints + type stubs only. See `docs/*` for contracts and next phases.
