# Product Feedback (DRAFT — finalize at submission with evidence)

Devpost requires this per tool/API/SDK used. Draft early, finalize with evidence.

## Tools used and for what
* Alexa+ MCP Toolkit (`alexa-ai` CLI, Streamable HTTP, web simulator): sim path only — toolkit partner-gated, no live Alexa+ integration in video. REACH exposes Alexa+-compatible MCP (`execute_on_my_devices → get_task_status → decide_approval`); well-known OAuth routes stub 404 (`server/src/index.ts`), `addon.json` still example.com scaffolding.
* MCP SDK (`@modelcontextprotocol/sdk`): tool registration — `server/src/mcp/server.ts` (3 tools, stateless per-request).
* Bedrock (`@aws-sdk/client-bedrock-runtime`, `amazon.nova-lite-v1:0`): planner brain + document drafting — `server/src/planner/bedrock.ts` (live Converse) + `server/src/planner/loop.ts`.
* `docx` (npm): real `.docx` on laptop — `windows-agent/src/capabilities/createDocument.ts`.
* `cloudflared`: local HTTPS tunnel for dev MCP URL: TBD (needed for remote judge access; not yet rehearsed).

## What worked well
* TBD (setup, docs, testing, performance, reliability — with specifics). See friction log for live evidence (Nova cost fractions-of-a-cent, Inspector/SDK validation, approval-executes fix).

## What needs work
* TBD (errors, doc gaps, missing features, compat, workarounds). Known: outcome kinds binary (Slice B), verifiers optional (Slice C), bind-host + route auth hardening (Slice D).

## Onboarding (zero → hello world)
* TBD (steps + time + friction refs). Draft path: `npm install → typecheck → dev:server + dev:agent → /sim → Inspector tools/list → DOCX E2E`.

## Rebuild again? Yes/No + why
* TBD (answer at freeze with finished-v1 evidence).
