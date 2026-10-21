# REACH — Product and Build Roadmap

Status date: 2026-10-21. This roadmap is based on the checked-out repository on
`main` at `984fb57` (engine) plus the 2026-10-21 cross-platform work. It
separates current implementation from the product direction so a proposed
capability is never described as already built.

Implementation blueprint: [`implementation-guide.md`](./implementation-guide.md).

> **Where the hackathon build stands (2026-10-21).** Phases 0–2 are DONE and
> verified; the hero workflow (one dependable task, rehearsed and filmed) is
> the remaining work before the Oct 23 submission. The agent and the policy
> engine now run on macOS, Linux and Windows from one codebase — the old
> "Windows-only" constraint is gone, which also removes the platform excuse
> for not having built a desktop adapter. Audio capture and long-running
> execution are still unbuilt, and the meeting-minutes use case needs both.
>

## Product direction

REACH is a general-purpose computer-use agent. The user describes an outcome;
REACH discovers connected capabilities, plans the work, executes through typed
adapters, checks each result, and reports evidence. The same planner should
compose local computer actions, browser actions, APIs, and connected devices.
The product grows through capability coverage, not a route or skill for each
sentence a user might say.

The practical boundary is always:

> REACH can act only through a capability that is installed, reachable, and
> authorized for the requested target and scope, with maturity evidence
> sufficient for the action's risk.

When a requirement is ambiguous, REACH asks. When a capability is absent,
offline, or unauthorized, it reports the specific boundary. It does not invent
an action from the user's intent alone.

## System shape

```text
User clients: Alexa+ / web / sim / desktop / mobile / inbound MCP client
                              │
                  authenticated user + goal
                              ↓
                         REACH core
       identity, outcome, task state, plan, policy, audit
                              │
              typed capability call + approval gate
                              ↓
Capability adapters: local agent / Playwright / scoped API /
                     device / external MCP server
                              │
                 independent verification
                              ↓
          evidence + event trail → client response
```

The planner proposes; the executor and policy layer decide. The planner never
receives credentials, runs arbitrary code, grants approval, or marks an action
verified. A workflow can span many adapters while each actual action remains
typed, policy-checked, and auditable.

An inbound MCP client is a user-facing way to submit a REACH task. An external
MCP server is an execution dependency behind a REACH adapter. Neither type of
MCP connection replaces the REACH planner or bypasses its policy.

## Repository baseline

### Present in the code

* A Bedrock-backed ReAct loop offers one registered tool at a time and routes
  actions through the executor and policy engine.
* File actions include search, read, write, move, delete, verify, and DOCX
  creation. App actions open known applications, URLs, and documents.
* The Windows agent uses an explicit capability allowlist and has no generic
  `run_command`, shell, or `eval` capability.
* The browser adapter consumes Playwright MCP through a fixed upstream-tool
  allowlist. Planner-visible browser actions cover navigation, observation,
  page find, click, type, select, key press, wait, and download collection.
* The core has device registration and heartbeat, task persistence, action
  traces, policy decisions, and single-use expiring approvals.
* The sim provides a text client for the real task engine.

### Not present yet

* Audio capture and transcription — **no `audio.*` capability exists**. This is
  the first adapter the meeting-minutes use case needs.
* Long-running tasks: a task is capped at `TASK_MAX_ELAPSED_MS` (default 10
  minutes), so a one-hour meeting cannot be one agent loop. Phase 9's
  checkpoint-and-resume execution model is the real gap, not a timeout value.
* Push delivery of results: nothing notifies the user when a task ends; results
  are polled via `get_task_status`.
* General desktop UI control beyond the Windows-only window/keystroke
  primitives (those exist on Windows only and are advertised on Windows only).
* Image understanding or image search, camera actions, mobile control,
  smart-home/TV/Matter adapters, and a general external-MCP connector.
* Browser upload is deliberately blocked. There are no general browser
  screenshot, arbitrary page-code, or unsafe evaluation actions exposed to the
  planner.
* Direct Alexa+ deployment and OAuth account linking are not complete. Alexa
  should remain a client integration, separate from the REACH core.
* There is no supported long-running scheduler, event trigger, or routine
  engine.

## Core contract for every capability

Every adapter registers a capability definition with:

* Stable capability ID, adapter, device/account, and live availability.
* Typed input and output schemas, plus preconditions and required scopes.
* Target extraction, data sensitivity, side-effect class, reversibility,
  estimated cost, timeout, and cancellation behavior.
* Policy defaults and whether a specific approval is required.
* An execution handler, idempotency strategy, independent verifier, and
  structured evidence fields.
* Known limits and a safe user-takeover path when automation becomes uncertain.

The registry becomes the planner's live map of what this installation can do.
Unavailable capabilities remain explainable but cannot be selected for
execution. The planner receives only the tools available for the current task
and authorized account/device scopes. New adapters must not add goal-string
routing.

Artifacts should flow between adapters by stable references carrying path,
origin, content type, size, and content hash. The planner should not have to
copy arbitrary paths out of prose. Verifiers produce structured results, not
only a success sentence.

## Build order

### Phase -1 — Alexa+ access and hackathon eligibility gate

Run this immediately, before investing heavily in an Alexa+ demo. Treat
platform access, account eligibility, and track rules as external dependencies
that must be checked, not as capabilities the repository can guarantee.

Verify with the current Alexa+ documentation, the signed-in developer account,
and the hackathon rules or organizer:

1. Can a real Alexa+ request reach REACH through the supported integration
   path, and can REACH return a result through that same path?
2. Can the integration authenticate the speaker and preserve user, account,
   and task identity across request, resume, and response?
3. Is access available to this account now, including required onboarding,
   certification, hosting, and authentication prerequisites?
4. If access is unavailable, is the REACH sim acceptable for judging?
5. Does that fallback satisfy the track's required technology use and
   submission rules?

If Alexa+ is viable, build and rehearse the smallest complete round trip early.
If it is not, lock the sim as the demo client, document the limitation, and do
not describe Alexa+ as implemented. Re-check the official [Alexa+ MCP
QuickStart](https://www.developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html)
and track requirements at the time of the gate; they can change.

Gate: record evidence, account/access result, task-identity behavior, fallback
decision, and track-eligibility result before committing to the demo client.

### Phase 0 — Outcome, identity, and target resolution

Make the intended result and authority to act explicit in structured task
state. Resolve, as applicable, the outcome and constraints; authenticated
speaker; account; device or computer; exact file, folder, repository, calendar,
contact, document, or service; timezone; delivery channel; timing; and
confirmation requirements.

Treat `target.resolve` as a first-class core service, not a goal-specific route
or an adapter guess. Bind trusted identity and provider records to explicit
target references and record provenance. Ask a focused clarification when a
missing or ambiguous target could change the result or cause a side effect.

For example, “Send it to Mom next Friday” must resolve what “it” refers to,
which contact is “Mom,” which account/calendar/timezone applies, the delivery
channel, and whether the user means draft, schedule, or send. Do not turn an
ambiguous phrase into external delivery.

Gate: every adapter receives validated target references, scoped identity, and
constraints; ambiguous contact/account/date/channel choices pause for the user.

### Phase 1 — Make outcomes trustworthy and observable

Fix the loop before increasing action breadth. The current loop has a fixed
per-invocation step limit, reconstructs only a summary on resume, and can mark a
task complete after any earlier action succeeded even if the final planner
response is a refusal or an incomplete summary. Final task evidence currently
uses a generic planner note rather than aggregating action artifacts.

Build:

1. Add a structured terminal reply (`complete`, `partial`, or `cannot`) as an
   internal planner contract. Keep the public MCP surface unchanged.
2. Permit `complete` only when the reply references successful actions whose
   independent verifiers passed. Preserve partial artifacts and explain what
   remains when a later step fails.
3. Make planner-call and token budgets cumulative across pauses and resumes.
   Save bounded, schema-versioned task context needed to resume; do not add a
   general memory tool as a substitute for durable task state.
4. Store typed action outputs and artifact references in task evidence. Show
   real saved paths and results in the sim. Add an append-only user-visible
   event trail with timestamps, action, target, verification, and artifacts.
5. Require verifiers for every registered action that can claim successful
   completion. A transport response alone is not proof of a completed effect.

Gate: a partial action followed by `CANNOT`, timeout, denied action, or resume
cannot produce a false completed task; an approved action executes once; every
completed claim points to verified evidence. Users can distinguish completed,
partial, awaiting approval, awaiting clarification, failed, could not perform,
and completed but not independently verified.

### Phase 2 — Capability graph and maturity

Extend the current device/capability graph with the full contract above. Model
capability maturity using evidence-bearing dimensions such as declared,
installed, reachable, authenticated, available, tested, verified, and approved
for autonomous use. These are not interchangeable or one linear ladder:
authentication may not be required, a test may expire, and autonomy approval
is a separate policy decision. Compute availability from fresh state; do not
infer reliability from “implemented in code.”

Let the planner discover prerequisites and alternatives at runtime. A user
grants authority to a capability; the grant does not create a missing device
or integration. A capability may support supervised use while remaining
blocked from autonomous use until its verifier, retry behavior, and duplicate
protection are proven.

Add capability preflight so a task can detect early that a required operation
is absent. Plans remain dependency-aware and recoverable, but execution remains
one action at a time. Preserve action-specific, expiring approvals and
single-use nonces.

Gate: adding or removing an adapter changes the planner's available tools
without adding a goal-specific route; stale or insufficient maturity evidence
prevents unsafe execution or success claims; every unavailable path produces
an honest, useful reason.

### Phase 3 — Reliable local-computer and browser workflow

#### Browser

Build on Playwright MCP as the generic website adapter. Keep the allowlist and
add only typed, necessary operations:

* Stronger tab/session state and page-bound element references.
* File upload from a verified REACH artifact reference, not an unrestricted
  planner-supplied local path.
* A distinct submit/commit action so sending, publishing, purchasing, and
  account changes reach policy before the irreversible boundary.
* Target-origin and account/session evidence, duplicate-action protection,
  download/upload limits, cancellation, and post-action page verification.
* A pause-and-takeover path when a challenge, unexpected page, or ambiguous
  confirmation appears.

Treat all page text as untrusted data. Keep arbitrary browser code execution,
cookie extraction, and generic shell access out of the planner's toolset.

#### Desktop

Add a Windows accessibility adapter for inspecting windows and controls,
setting text, invoking named controls, and verifying visible state. Bind every
action to the observed application/window. Use accessible names and UI
structure before coordinates. Keep pixel-grounded computer use as a separate
post-hackathon research track with its own security review.

Gate: one rehearsed task can move through local files and an unrelated web app
without site-specific planner routing, while every externally visible
submit/upload requires the correct approval. Broader desktop control remains
gated on a reliable accessibility implementation.

### Phase 4 — Documents, artifacts, and composition

Build reliable artifact handoff and document composition on top of local file
capabilities. A workflow can find a user-selected source, transform or summarize
it, create a document with verified embedded artifacts, and retain stable
evidence references. Keep private media local unless the user approves the
exact cloud-processing scope.

Gate: source and output identities are verified; the generated document
contains the intended content and media; downstream capabilities consume
artifact IDs instead of planner-authored paths.

### Phase 5 — One external storage or calendar integration

Choose one service with a viable scoped API and strong verification. Add
storage or calendar through the shared capability contract, with explicit
account/target resolution and side-effect approval. The hackathon hero may
include a save or follow-up scheduling step only if this integration is
available and reliable in time.

Gate: authorization, target selection, approval, retries, and the resulting
saved file/event can all be demonstrated and independently verified.

### Phase 6 — Perception and media

Add image search/classification, OCR, audio transcription, screen observation,
and later video-frame analysis as typed capabilities. Prefer local metadata and
incremental indexes. Before cloud processing, show the user which folder or
files will be sent, to which provider, for what purpose, and under what budget.
Persist indexes with content hashes, support deletion, and never silently
reprocess a whole library.

Return ranked candidates with confidence and provenance. Ask the user to
select when an inference could materially change the result. Do not claim that
visual similarity proves identity, relationship, or intent.

Gate: search results identify the source files and method; a user can inspect
the candidate; declined cloud processing leaves the files local.

### Phase 7 — Services, devices, and external MCP

Use an official scoped API when it is stable and provides better verification.
Use the generic browser adapter for services without a suitable API. Register
both through the same contract and policy engine.

Build service families in order of user value and integration reliability:

1. Email, calendar, tasks, and cloud storage.
2. Supported messaging, CRM, ticketing, and business services.
3. Smart-home and media-device adapters, beginning with read/state operations
   and low-risk controls; require confirmation for consequential controls.
4. Selected external MCP servers, with explicit server trust, per-tool
   allowlists, schema checks, credential isolation, policy mapping, and
   untrusted-result handling.

Do not make a one-off planner for each service. A provider-specific adapter is
acceptable when its API is the right execution path; it should still expose
the shared capability contract.

Gate: each connector has a clear authentication scope, target, verifier,
approval rule, timeout/retry behavior, and useful failure result.

### Phase 8 — Voice and other clients

Make Alexa, the web sim, desktop, mobile, and future voice interfaces thin
clients of the same core. A client submits goals and renders results; it does
not contain its own action planner or bypass policy. Keep OAuth account linking
and remote MCP deployment as a separately gated Alexa integration. The Phase
-1 gate decides whether Alexa+ is the hackathon client; this later phase covers
a production-quality client after identity, task, and evidence contracts are
stable.

Voice approvals must identify the exact pending action and bind the response
to the authenticated user/session. If the channel cannot prove that binding,
ask for confirmation in a trusted REACH UI.

Gate: all clients discover and invoke the same capabilities, and all share the
same policy, approval, task, and evidence records.

### Phase 9 — Long-running tasks and routines

Add scheduling and event-triggered tasks only after task persistence,
idempotency, cancellation, and authorization expiry are reliable. Store a
checkpoint after each verified action. Require users to configure a visible
scope and expiry for recurring grants. Notify on material changes, failures,
or decisions needed; do not create hidden blanket permissions.

Gate: interruption, restart, offline devices, and safe retries do not duplicate
external side effects or lose the audit trail.

### Phase 10 — Development and automation capabilities

Support repository inspection, known test runners, patch application, and
approved deployment as specialized capabilities. The planner must not receive
an arbitrary command or shell tool. Use isolated worktrees/containers, explicit
workspace and network scopes, resource limits, captured outputs, and human
approval before deploy or other external release actions.

Gate: the run is attributable to a task and exact repository state, results
are retained, and deploy cannot be triggered by untrusted repository content
or a planner-only approval.

## Hackathon sequence to 2026-10-23

The submission deadline is too close to finish every capability family. Use
the remaining window to prove the general architecture and create a reliable
starting point for the longer roadmap.

1. **Alexa+ go/no-go:** complete Phase -1 immediately. If viable, test the
   authenticated request/response round trip early. Otherwise use the sim and
   verify the track accepts it.
2. **Core correctness:** finish Phases 0–2 and reconcile `README.md`,
   `docs/architecture.md`, `docs/security.md`, `docs/demo-script.md`,
   `docs/aws-builder.md`, `docs/alexa-auth-checklist.md`, and the submission
   checklist with current implementation.
3. **Hero workflow:** select one dependable workflow: find a file, understand
   or transform it, create a document, save it through one connected service,
   and schedule a follow-up only if a verified calendar capability is ready.
4. **Two supporting tests:** (a) a read-only browser task such as inspecting
   recent GitHub issues; (b) an unsupported or consequential request that shows
   a truthful `CANNOT` or exact approval boundary.
5. **Acceptance and demo:** show the same planner composing actions, the
   chronological event trail, verified results, and any partial/unverified
   state. Do not claim integrations that were not used in the rehearsed run.
6. **Freeze:** stop adding capabilities early enough to rehearse, film, correct
   the docs, and submit before noon PDT on Oct 23.

Do not attempt to demonstrate desktop control, image understanding, Alexa,
external MCP, smart-home devices, scheduling, and development automation all
in one video. The roadmap covers them; the submission needs one hero workflow
and two supporting tests that prove the shared architecture.

Each build is a reviewable slice with typecheck and the full workspace suite
green before commit. No capability is promoted to “built” until its live or
representative acceptance flow, policy behavior, and verifier have been
checked.

## Quality gates across all phases

* No goal-string router or per-example special case.
* No arbitrary shell, dynamic code execution, or planner-held credentials.
* Policy runs for every proposed action; approvals are exact, single-use, and
  never granted by the planner.
* Results distinguish complete, partial, cannot, awaiting approval, awaiting
  input, and uncertain verification.
* Every meaningful action records target, rule/reason, approval or grant,
  execution result, verifier result, and artifact references.
* Page/device/API output is untrusted input. It cannot change system policy or
  authorize a side effect.
* Retries are bounded and idempotent where an external side effect could be
  duplicated.
* Every demo claim has a reproducible acceptance flow and matches current docs.

## Product language

**Promise:** “REACH turns natural-language intent into verified action across
the systems you connect.”

**Tagline:** “Connected. Capable. Authorized. Verified.”

The public claim always carries the boundary: connected capabilities are what
REACH can reach; user intent and authorization do not manufacture absent
capabilities.
