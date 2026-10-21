# Product Feedback (Devpost form)

Devpost requires this per tool/API/SDK used. Written against the shipped code.

## Tools used and for what
* **AWS Bedrock** (`@aws-sdk/client-bedrock-runtime`, `amazon.nova-pro-v1:0`): the planner
  brain and the document drafter — `server/src/planner/bedrock.ts` (live Converse API calls)
  and `server/src/planner/loop.ts` (the ReAct loop that drives them). One model call per turn;
  the model *proposes* actions, the executor and policy engine *decide* them. Bedrock is also
  what drafts the body of every generated document, so the same call stream plans the work and
  writes the deliverable.
* **MCP SDK** (`@modelcontextprotocol/sdk`): the agent-facing surface —
  `server/src/mcp/server.ts` builds an `McpServer` per request over Streamable HTTP
  (spec `2025-11-25`) and `server/src/mcp/transport.ts` carries it. Three tools:
  `execute_on_my_devices`, `get_task_status`, `decide_approval`.
* **Playwright MCP** (`@playwright/mcp`, pinned `0.0.82`): the generic browser adapter —
  `server/src/browser/playwright.ts` runs it as a managed subprocess behind a fixed tool
  allowlist (`browser_navigate`, `browser_snapshot`, `browser_find`, `browser_click`,
  `browser_type`, `browser_select_option`, `browser_press_key`, `browser_wait_for`).
  Evaluate/code-execution/cookie/upload upstream tools are structurally unreachable.
* **`docx`**: real `.docx` files on the laptop, not renamed text —
  `windows-agent/src/capabilities/createDocument.ts` (paragraph model, images via `ImageRun`).
* **Alexa+ MCP Toolkit**: **sim path only.** The toolkit is partner-gated and this account has
  no consumer access, so there is no live Alexa+ integration and none is claimed. REACH exposes
  an Alexa+-compatible MCP surface; the sim UI is the demo client. Well-known OAuth routes
  stub 404 (`server/src/index.ts`); `addon.json` is still example.com scaffolding.
* **`pdf-parse` / `xlsx`**: reading real PDFs and spreadsheets as text, so "understand this
  file" is a typed capability rather than a prompt hope.

## What worked well
* **The evidence rule.** A task cannot report success without citing action IDs that a
  *verifier* passed. Narration is rejected server-side (`server/src/planner/loop.ts`,
  `validateFinish`). The failure log records the moment this mattered: a model narrated a
  refusal and the task was marked completed — now it is `failed`.
* **Approve-means-execute.** The first implementation re-paused with a fresh approval after
  approval, which made the approval card feel like a snooze button. Fixing it (`decide_approval`
  runs the approved action immediately, then resumes) was the single highest-value change to
  the demo.
* **Failures that teach.** Every error carries a recovery hint and a bounded autonomous-retry
  budget; after two blind retries the planner asks the user with concrete options instead of
  guessing (`server/src/executor/recovery.ts`).
* **Cost.** A full plan is fractions of a cent at Nova pricing (live measurement:
  3678 in / 91 out tokens). Token accounting ships in every task's `usage` field.

## What needs work
* **The laptop agent was Windows-only and now runs on macOS.** The path layer resolved
  backslash separators through POSIX `path.resolve`, so `"notes\a.txt"` became one literal
  filename. That broke ~25 tests and — more seriously — silently disabled the "another user's
  data" guard on every POSIX host. It is fixed and both path styles are now judged by one
  rule set, but the class of bug (OS assumptions in a security path) deserves a platform
  matrix in CI.
* **The E2E scorecard runner lied.** It parsed `# tests 85` while Node's reporter emits
  `ℹ tests 85`, so a 182/187 suite was reported as 0%. Fixed; the lesson is that a reporting
  tool that cannot fail is worse than no reporting tool.
* **Outcome kinds are still coarse** in places, and the browser adapter has no file-upload
  path (deliberately).
* **No long-running execution.** A task is capped at 10 minutes by default
  (`TASK_MAX_ELAPSED_MS`). A one-hour meeting cannot be transcribed end-to-end in one agent
  loop — long jobs need checkpoint-and-resume, which is Phase 9 of the roadmap, not a flag.

## Onboarding (zero → hello world)
* `git clone` → `npm install` → `cp .env.example .env` (fill AWS keys + `AGENT_TOKEN`) →
  `npm run typecheck` → `npm run test` → `npm run dev:server` + `npm run dev:agent` →
  open `http://localhost:3000/sim` → type a goal. About **15 minutes** if Bedrock model
  access is already enabled; the first attempt at `npm install` on a fresh clone is where
  people lose time, and `npm run doctor` (in `server/`) names the missing piece.
* `npm run doctor` is the preflight: it checks Node ≥24, `.env`, the AWS keys, the data dir
  and the two ports, and prints a fix line per failure.

## Rebuild again? Yes.
* The load-bearing idea — *the model proposes, the executor decides, every success claim
  points at independently verified evidence* — held up under every failure we hit. The
  friction log has ~30 entries and most of them are the same lesson from different angles:
  the hard part is not making the agent do something, it is making it fail honestly.
