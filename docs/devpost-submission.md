# Devpost submission text

Everything below is ready to paste. Three fields on the form need a decision
from you (marked ⚠️); everything else is written.

---

## Project name

**REACH** — *Tell Alexa what you want. Your devices make it happen.*

## Tagline / one-liner

REACH is a general-purpose agent loop for your own computers: describe the
outcome, and it plans the work, acts through explicitly authorised
capabilities, and hands back verified evidence.

## Description (paste into the form)

REACH is the layer between what you *say* and what your machines can *do*.

Alexa+ (or any MCP client) understands intent. REACH expands that intent into
work on the devices you actually own — and refuses, with a reason, to do
anything you have not authorised.

**The loop:** goal → inspect the environment → reason about the next action →
propose → **policy check** → execute → verify the result → continue, replan or
recover → report plan, trace and evidence.

The model *proposes*. The code *decides*. Every action is schema-validated,
classified by risk, timed, audited and independently verified before and
after it runs. A task cannot report success unless it cites actions whose
verifiers passed — a task that did nothing cannot report success, and one
that paused and resumed keeps the *results* of its earlier actions, not just
a summary of them.

### What it does today

One engine, four capabilities classes, no goal-specific routing:

* **Files** — search (by name *or* inside `.docx`/`.pdf`/`.xlsx`), read, list,
  write, move, delete, verify. Paths are guarded against system locations,
  other users' data and credential files.
* **Documents** — a real `.docx` with real structure. The body is Markdown and
  becomes headings, bullet and numbered lists, tables, emphasis, quotes and
  rules — the model plans the document's shape, the agent renders it.
* **Browser** — a generic Playwright-MCP adapter with a fixed tool allowlist.
  Evaluate, code execution, cookies and uploads are structurally unreachable.
* **Audio** — transcribe a recording with **Amazon Transcribe** (via S3; the
  recording is deleted from S3 afterwards) and turn it into minutes.

### The demo

1. **A meeting recording becomes minutes.** Type *"Transcribe the product sync
   recording in my Downloads and write the meeting minutes to my laptop"*.
   REACH asks before your recording leaves the machine, transcribes it with
   Amazon Transcribe, reasons over the transcript with Bedrock, and writes a
   real `.docx` with attendees, decisions, action items **with owners** and
   open questions.
2. **A different domain, same engine** — a read-only GitHub query, answered
   from the page snapshot, using the handle from your local environment
   rather than a guessed placeholder.
3. **Policy on camera** — a delete pauses, quotes the exact target, and asks.
   Ordinary actions never ask.
4. **Honest failure** — a read of a system location is refused with a reason.

### Under it

* **AWS Bedrock** (`amazon.nova-pro-v1:0`) is the planner: a ReAct loop that
  offers one tool per turn, resumes across approvals and questions, and
  accounts for every token it spends. Bedrock also drafts the body of every
  generated document.
* **Amazon Transcribe + S3** transcribe the recording. **Amazon S3** is where
  it lives for the eight seconds the job needs, and not after that.
* **MCP** (`2025-11-25`, Streamable HTTP) is the client surface:
  `execute_on_my_devices` → `get_task_status` → `decide_approval`. Two
  resources (`reach://capabilities`, `reach://tasks/recent`) and a
  `make-meeting-minutes` prompt.
* **@modelcontextprotocol/sdk** for the server, **@playwright/mcp** for the
  browser, **docx** for real Word output, **pdf-parse** and **xlsx** for
  reading real files.

### What it will not do

No raw shell anywhere. No per-goal routes. No permission that outlives a
single approved action. No capability the connected device does not
advertise. Data leaving the machine is its own policy case and always asks.

---

## "Significantly updated" note

*Paste this in the "what changed" field.*

Rebuilt the core around an agent loop and made every claim verifiable: the
planner is a Bedrock ReAct loop with server-side finish validation (a task
cannot report success without cited, verified evidence), approvals are
single-use and expiring, and approving an action *executes* it rather than
asking again. Added a cross-platform laptop agent (macOS, Linux and Windows
from one codebase), a Markdown-to-`.docx` renderer so generated documents have
real structure, word-scored search that reads inside `.docx`/`.pdf`/`.xlsx`,
a generic Playwright-MCP browser adapter, and meeting transcription with
Amazon Transcribe and S3. The engine now runs on macOS, Linux and Windows,
and the E2E suite is 187 tests with no network dependency.

---

## ⚠️ Three decisions for you

1. **The Alexa+ integration is a simulation.** The Alexa+ MCP Toolkit is
   partner-gated and this account has no consumer access, so there is **no
   live Alexa+ route** and the video does not claim one. REACH exposes an
   Alexa+-compatible MCP surface and the sim UI is the demo client. Confirm
   you are comfortable stating that plainly on the form — the friction log
   records it as a deliberate, documented boundary, and judges score
   honesty.

2. **The repository must be public.** It is currently private
   (`github.com/Fabshkiee/REACH` returns 404). Either flip it to public, or
   share it with `testing@devpost.com` and `@AmazonAppDev` as the checklist
   allows.

3. **The AWS Builder mini-challenge.** The $150 credit request window closed
   on 21 Oct at 12pm PT. If you submitted it, claim the prize and answer the
   Product Feedback with the three services (Bedrock, Transcribe, S3). If you
   did not, the mini-challenge may be out of reach — the AWS story still
   stands for the main track, so the form text above does not depend on it.

---

## Answers to the Product Feedback questions

Full draft: [`docs/product-feedback.md`](./product-feedback.md). The short
version:

**What worked well** — the evidence rule (a success claim must cite
verified actions); approve-means-execute; errors that teach rather than
blind-retry; and the cost — a full plan is fractions of a cent at Nova
pricing, with every token accounted for in the task's `usage`.

**What needs work** — the agent was Windows-only until 21 Oct and its path
handling silently disabled a security guard on POSIX hosts; the E2E scorecard
reported 0% on a suite that was 97% green because it parsed the wrong
reporter format; a task could report success by citing a *previous* task's
actions; and a resumed task lost the results of its earlier actions and
invented a meeting nobody had. All four are fixed, and all four are in the
friction log.

**Onboarding** — `git clone` → `npm install` → copy `.env.example` to `.env`
and fill it → `npm run doctor` → `npm run dev:server` + `npm run dev:agent` →
open `http://localhost:3000/sim`. About 15 minutes if Bedrock model access
is already enabled.

**Rebuild again? Yes** — the load-bearing idea (the model proposes, the code
decides, every success points at independently verified evidence) held up
under every failure we hit.
