# REACH — Implementation Guide

This guide translates [`roadmap.md`](./roadmap.md) into an implementation
blueprint for a coding agent. It records the checked-out code as the baseline,
then specifies the target contracts, boundaries, build order, and acceptance
gates. Code examples below are proposed shapes; they are not claims that those
changes have already been implemented.

## 1. Product objective

Build one general agent that can turn an outcome stated in natural language
into a verified sequence of actions across the user’s connected computers,
websites, files, applications, services, and devices. The planner should
compose capabilities at run time. Do not add goal-specific routes such as
`familyLetter()`, `findGithubIssues()`, or `sendPhotoToMessenger()`.

REACH can attempt an action only when an adapter provides that capability, it
is reachable and authenticated as needed, the user has authorized its scope,
and its maturity is sufficient for the action's risk. Some actions remain
supervised until autonomy evidence is approved. A missing capability produces
an explicit `CANNOT`; ambiguity that could change the result produces a
targeted question.

## 2. Current repository baseline

Checked on 2026-09-23: branch `main`, commit `f992245`, with the prior roadmap
present as an untracked documentation change.

### Implemented building blocks

* `server/src/planner/loop.ts`: Bedrock ReAct loop, one proposed action per
  turn, clarification and approval resume.
* `server/src/planner/tools.ts`: planner tools generated from the server action
  registry.
* `server/src/executor/registry.ts`: typed Zod input schemas, action classes,
  handlers, targets, timeouts, optional verifier.
* `server/src/executor/executor.ts`: schema validation, policy decision,
  approval pause, timeout, execution, and trace append.
* `server/src/policy/engine.ts`: deterministic target/risk classifier.
* `server/src/registry/deviceStore.ts` and `capabilityGraph.ts`: device
  registration, heartbeat, availability, and a basic capability listing.
* `windows-agent/src/capabilities/index.ts`: explicit laptop capability
  allowlist; `windows-agent/src/index.ts` dispatches those capabilities.
* `server/src/actions/browser.ts` and `server/src/browser/playwright.ts`:
  Playwright MCP consumer and a deliberately narrow browser tool boundary.
* `server/src/tasks/types.ts` and `taskStore.ts`: persisted task, status,
  approvals, plan, trace, and token usage.
* `server/src/mcp/tools.ts`: public asynchronous task interface.

Current local capabilities include file search/read/write/move/delete/verify,
DOCX text creation, opening known apps/documents/URLs, and a limited browser
surface. Browser upload, arbitrary browser code, phone, media understanding,
general desktop interaction, calendar, smart home, and generic external MCP
connectors are not implemented.

## 3. Target architecture and trust boundaries

```text
User clients: Alexa+ / web / sim / desktop / mobile / inbound MCP client
                              ↓
              authenticated user + goal + task identity
                              ↓
                         REACH core
   target resolution → planner → executor/policy → audit/evidence
                              ↓
              typed capability call + approval boundary
                              ↓
Capability adapters: local agent / Playwright / scoped API /
                     device / external MCP server
                              ↓
             independent verifier → event trail
                              ↓
                       client response
```

An inbound MCP client submits or resumes a REACH task. An external MCP server
is an adapter dependency called by the core. Both remain subject to REACH task
identity, capability scope, policy, approval, and verification.

### Device connection and enrollment flow

Alexa+ is a client surface, not the device-pairing mechanism. The Alexa+ MCP
add-on is a remote service endpoint Alexa+ calls; it does not directly reach a
home LAN or install agents on user devices. Enroll laptop, phone, and TV
capabilities separately in REACH, then let the same task planner compose them.
Amazon currently labels the Alexa+ MCP Toolkit as available to select partners,
so confirm this account's program access before planning a live demo. See
[Alexa+ developer access](https://developer.amazon.com/docs/alexaplus/add-ons/home.html).

The repository's current device flow is development plumbing, not user
pairing: the Windows agent sends `AGENT_ID`, an explicit capability list, and
the shared `AGENT_TOKEN`; it registers with the core and heartbeats every 30
seconds. The core dispatches to a fixed `AGENT_URL`. There is no per-user
enrollment, per-device credential, revoke UI, phone agent, or TV agent.
Alexa+ well-known OAuth routes are stubs. Do not present this as consumer-ready
device setup.

For production, keep Alexa+ account linking and device connections as separate
steps:

1. **Enable REACH in Alexa+.** The deployed add-on is registered with Alexa+.
   The user links a REACH account using account linking. REACH maps that
   authenticated identity to its own user ID and returns an explicit task ID
   for every request. Do not use Alexa conversation history as durable REACH
   identity or task state. Follow Amazon's [MCP authentication](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-authentication.html)
   and [account-linking](https://developer.amazon.com/docs/alexaplus/add-ons/account-linking.html)
   requirements.
2. **Open REACH Settings → Devices → Add device.** Choose Windows, iPhone/iPad,
   Android, or TV/service. REACH displays an expiring QR code or one-time code.
   The user opens the REACH agent/app or service connector and signs in to the
   same REACH account.
3. **Prove possession and approve the device.** The agent exchanges the code
   for a device-specific credential, displays its name and owner, then waits
   for confirmation in a trusted REACH UI. Store credentials in the OS secure
   store. Provide rotate/revoke controls. Never reuse the development-wide
   `AGENT_TOKEN` here.
4. **Choose capabilities and scope.** Show each requested capability in plain
   language. The user chooses laptop folders and approved browser/app
   operations, phone resources the OS exposes to REACH, or commands exposed by
   the TV's vendor/platform integration. Do not grant whole-device access by
   default.
5. **Connect safely.** Agents establish outbound authenticated connections to
   REACH, preferably TLS/WebSocket or a queued relay. Do not require public
   port-forwarding to the agent. A temporary development tunnel is not the
   production connection model.
6. **Verify and show readiness.** Record provider, device, permitted
   capability IDs, last-seen time, authentication, and qualification evidence.
   Run a harmless capability check. “Paired” does not mean “online,” and
   “online” does not mean “approved for unattended use.”

The REACH Settings UI should have a device list with cards like:

```text
Windows laptop     Online · last seen 8 sec ago
  Files: Pictures/Family, Documents/REACH     Manage access · Pause · Revoke
iPhone             Limited · available when the app is open
  Photos: selected items                      Manage access · Reconnect
Android phone      Online · media access granted
  Photos: selected items · background work limited
Living-room TV     Linked · vendor integration
  Power, volume, supported app launch         Manage access · Revoke
```

Each card should show pairing/online/limited/offline/needs-permission states,
scopes, last-seen time, maturity, and revoke controls. The task UI shows the
selected target and event trail. Present approval in Alexa+ only if that
surface shows the exact target and binds the response to the linked user and
pending action; otherwise link to the REACH web/mobile approval view. Alexa+
supports custom MCP App visuals through `ui://` resources. See [MCP client
lifecycle](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html)
and [layout guidance](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-layout-and-rendering.html).

Platform limits shape the product promise:

* **Windows laptop:** install the REACH agent. Start with user-selected folders
  and limited app/browser actions. Remote REACH Cloud requires replacing the
  current core-to-fixed-`AGENT_URL` dispatch with an authenticated outbound
  agent channel/relay. This is the best first full device agent.
* **iPhone/iPad:** yes, it can be an Alexa+ request/approval surface through
  the Alexa app where Alexa+ is available, and REACH can have a companion app.
  The companion can accept selected files/photos, offer share-sheet handoff,
  show task/evidence state, receive notifications, and run its own declared
  app actions. Do not promise unrestricted whole-filesystem access, control of
  arbitrary apps, or an always-on background agent. Use Apple's explicit
  document/photo permissions and supported background modes. See [Apple
  document access](https://developer.apple.com/documentation/uikit/providing-access-to-directories)
  and [background modes](https://developer.apple.com/documentation/Xcode/configuring-background-execution-modes).
* **Android:** a REACH app can submit tasks, receive approvals, and use
  user-selected media/documents. Prefer the Photo Picker or Storage Access
  Framework. Background execution is constrained; a foreground service is
  visible and only appropriate for qualifying work. Do not make generic
  whole-phone UI control a baseline promise. See [Android Photo Picker](https://developer.android.com/training/data-storage/shared/photo-picker)
  and [foreground-service guidance](https://developer.android.com/develop/background-work/services/fgs).
* **TV:** start with a vendor cloud API, a supported Alexa Smart Home/Video
  integration, or a REACH app where the TV platform permits one. Alexa's
  existing TV pairing does not automatically give the REACH add-on an API to
  every TV. Power, volume, input, and supported app launch may be available;
  arbitrary screen reading and UI automation are platform-specific.

Treat the Alexa+ MCP add-on, a Smart Home skill, and a REACH device agent as
different integrations. An Alexa-connected TV is not automatically a
REACH-connected TV. Link a supported vendor account to REACH or explicitly
build a separate Alexa Smart Home integration.

Keep the public MCP contract at three tools: `execute_on_my_devices`,
`get_task_status`, and `decide_approval`. Internal planner controls such as
`reach.ask_user` and `reach.finish` are not new public MCP tools.

Trust rules:

1. The planner receives tool schemas and bounded observations, never secrets or
   raw credential material.
2. Advertisements from devices describe availability; they do not authorize
   arbitrary code or create executable handlers. The core binds advertised
   capability IDs to known, validated server/agent definitions.
3. A page, document, device response, MCP result, or repository file is
   untrusted data. It cannot change policy, grant approval, or override the
   user's goal.
4. Every proposed action is validated and policy-judged immediately before
   execution. Approval is bound to the exact action, target, and arguments.
5. Every meaningful side effect has a verifier. A transport-level `200` or an
   LLM's summary is not sufficient evidence that the requested outcome
   happened.
6. No arbitrary shell, `eval`, or planner-authored script. Future development
   operations use narrow, predefined capabilities with isolated workspaces.

## 4. Contracts to implement

### 4.1 Capability definition

Keep the runtime registry as the single source of planner tool schemas. Extend
`ActionDefinition` rather than creating an unrelated second planner registry.
The Windows agent has its own runtime allowlist; core metadata binds its
advertised IDs to the corresponding known action definitions.

```ts
export type Verification =
  | { status: "verified"; summary: string; artifacts?: ArtifactRef[] }
  | { status: "unverified"; reason: string; artifacts?: ArtifactRef[] }
  | { status: "failed"; reason: string };

export interface ArtifactRef {
  id: string;
  deviceId: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
  sha256?: string;
  uri: string;
  createdByActionId: string;
}

export interface CapabilityManifest {
  id: string;                    // e.g. "files.search"
  version: number;
  adapterId: string;             // e.g. "windows-agent"
  providerId: string;            // device/account instance
  description: string;
  scopes: string[];
  actionClass: ActionClass;
  dataSensitivity: "public" | "user_data" | "sensitive" | "secret";
  sideEffect: "none" | "local_write" | "external_change" | "external_send";
  idempotent: boolean;
  readiness: CapabilityReadiness;
}

export interface CapabilityReadiness {
  implementation: "declared" | "installed";
  connectivity: "unknown" | "reachable" | "unreachable";
  authentication: "not_required" | "missing" | "authenticated";
  availability: "available" | "offline" | "needs_auth" | "disabled";
  qualification: {
    state: "untested" | "tested" | "verified";
    evidenceRefs: string[];
    checkedAt?: string;
    expiresAt?: string;
  };
  autonomy: {
    state: "manual_only" | "approval_required" | "approved";
    scopes: string[];
    evidenceRefs: string[];
    expiresAt?: string;
  };
}

export interface ActionDefinition {
  name: string;
  capabilityId: string;
  manifest: CapabilityManifest;
  schema: z.ZodTypeAny;
  timeoutMs: number;
  targetOf(args: Record<string, unknown>): PolicyTarget;
  handler(args: Record<string, unknown>, ctx: HandlerContext): Promise<unknown>;
  verify(result: unknown, ctx: HandlerContext): Promise<Verification> | Verification;
}
```

Readiness is per capability, provider, and operation. These are evidence-
bearing facts, not a single monotonic enum: authentication may be unnecessary;
`available` is computed from current connectivity, auth, scope, and policy;
test evidence can expire; `verified` means a named acceptance flow passed; and
autonomous-use approval is a separate scoped decision. A capability that is
implemented or reachable can still require approval or be blocked.

`PolicyTarget` should be structured, not only a free-form string. Suggested
fields are `{ kind, display, canonical, origin?, accountId?, artifactIds? }`.
The UI displays `display`; policy compares canonical target/account/origin and
bound artifact IDs. Do not use an LLM-supplied target description as the
authoritative target when the adapter can derive it from validated arguments
and observed state.

Initially, persist capability manifests as trusted build-time definitions and
have devices advertise only `{ capabilityId, version }`. Add operator-approved
dynamic connectors later. Never execute arbitrary schemas or handler code
because an agent announced them in a heartbeat.

### 4.2 Outcome, identity, and target resolution

Resolve identity and references before planning actions. Keep authenticated
identity separate from what the user said; the model cannot choose or forge an
account, contact, device, or provider identity. Store stable opaque IDs and
provenance, not credentials or unnecessary personal data.

```ts
export interface TaskContext {
  actor: {
    userId: string;          // server-authenticated opaque ID
    clientId: string;
    sessionId: string;
  };
  requestedOutcome: {
    text: string;
    constraints: Array<{ key: string; value: string; source: "user" | "resolved" }>;
  };
  deviceId?: string;
  timezone?: string;          // validated IANA name
  targets: ResolvedTarget[];
  unresolved: Array<{
    field: string;
    question: string;
    candidateRefs?: string[];
  }>;
}

export interface ResolvedTarget {
  role: string;               // e.g. "document", "recipient", "calendar"
  kind: string;
  providerId: string;
  accountRef: string;         // opaque account ID, never an access token
  resourceRef: string;        // provider-issued or locally indexed opaque ID
  displayName: string;
  resolvedFrom: "user" | "trusted_account_data" | "provider_result";
  confirmed: boolean;
}
```

Implement `target.resolve` as a core service that gathers candidates through
trusted registries and adapters, binds user-confirmed choices, and returns
unresolved fields for clarification. It is not a goal-specific planner route
and does not execute side effects. Never accept a model-invented `resourceRef`.
Normalize relative dates against the selected account/calendar timezone and
record the interpretation. For “send it to Mom next Friday,” do not proceed
until “it,” the contact, account, timezone, channel, and send-versus-draft
semantics are resolved.

### 4.3 Structured action result and event trail

Replace the current verifier's `string | false` result with the `Verification`
union. Extend `ActionRecord` with bounded structured fields and persist an
append-only, user-visible task event trail:

```ts
interface ActionRecord {
  actionId: string;
  capabilityId: string;
  actionClass: ActionClass;
  target: PolicyTarget;
  policy: { verdict: "allow" | "confirm" | "deny"; reason: string };
  approvalId?: string;
  startedAt: string;
  endedAt?: string;
  outcome: "pending" | "succeeded" | "failed" | "cancelled";
  verification?: Verification;
  artifacts: ArtifactRef[];
  resultSummary?: string; // display/model summary; never the source of truth
}

interface TaskEvent {
  eventId: string;
  taskId: string;
  at: string;
  kind:
    | "goal_received" | "target_resolved" | "clarification_requested"
    | "action_started" | "approval_requested" | "action_finished"
    | "verification_finished" | "artifact_created" | "outcome_set";
  actionId?: string;
  capabilityId?: string;
  target?: PolicyTarget;
  status?: "succeeded" | "failed" | "awaiting_approval" | "unverified";
  summary: string;            // bounded, redacted, safe for the user
  evidenceActionIds?: string[];
  artifactIds?: string[];
}
```

Redact credential-like values and cap any model-facing serialization. Keep
large observations and binary payloads out of the JSON task record; persist
bounded summaries plus local artifact references. Treat artifact paths as
device-owned handles. A downstream action resolves an artifact ID on its
originating device and re-checks path policy and content hash before use.

The event trail is append-only and ordered by server timestamps. The UI derives
current lifecycle state plus outcome from these events; it must distinguish
completed, partially completed, awaiting approval, awaiting clarification,
failed, could not perform, and completed but not independently verified.
Persist safe summaries and references, not raw page contents, secrets, or
unbounded model reasoning.

Example presentation for a multi-step file workflow:

```text
10:02 — Found three candidate images in the selected folder.
10:03 — User selected family-photo.jpeg; path and hash rechecked.
10:04 — Created letter.docx from the selected photo and user constraints.
10:05 — Verified the DOCX contains the expected image relationship.
10:06 — Saved the document to the selected drive folder; verified provider record.
10:07 — Created the calendar follow-up; awaiting approval before any send.
```

Each row must come from a persisted event and link to its action/artifact
evidence. Render `awaiting approval` as a current state, not as a completed
send.

### 4.4 Task outcomes and completion gate

Keep lifecycle states (`queued`, `running`, `awaiting_approval`,
`awaiting_input`) separate from outcome. Add a terminal outcome object rather
than turning every partial task into a misleading success:

```ts
export type TaskOutcome =
  | { kind: "complete"; summary: string; evidenceActionIds: string[] }
  | { kind: "partial"; summary: string; evidenceActionIds: string[]; remaining: string[] }
  | { kind: "unverified"; summary: string; reason: string; evidenceActionIds: string[] }
  | { kind: "failed"; reason: string; evidenceActionIds: string[] }
  | {
      kind: "cannot";
      reason: string;
      missingCapabilities?: string[];
      evidenceActionIds?: string[];
    };
```

Add an internal `reach.finish` planner tool with this schema. Intercept it in
`planner/loop.ts`; never dispatch it through the executor as a device action.
The finalizer checks that every cited action exists, succeeded, and has a
passing verifier. `complete` is rejected if the references do not establish
the claimed work. A `cannot` after partial work preserves that evidence and
returns a partial/cannot outcome; it cannot overwrite the trace as completed.

Only the planner's claim is untrusted. The server owns the final status
transition. Keep the policy engine authoritative and make it impossible for
`reach.finish` or a user-supplied summary to approve or verify an action.

### 4.5 Bounded planner state and budgets

Replace the per-invocation `MAX_STEPS` loop with task-wide limits:

```ts
interface TaskBudget {
  plannerCalls: number;
  inputTokens: number;
  outputTokens: number;
  actionCount: number;
  startedAt: string;
  maxPlannerCalls: number;
  maxElapsedMs: number;
}
```

Before every model call or action, compare the persisted counters to limits.
Persist a call attempt before invoking the backend, then update token usage
when the response arrives. Enforce hard limits in code, not only in the system
prompt. Include bounded budgets for image count/bytes and external side effects
when those adapters are added.

Persist enough task context to resume after approval, clarification, process
restart, or device reconnection. Prefer structured action results and compact
observation summaries over storing whole pages or exposing a generic
`reach.history` tool. Use single-flight execution or a task-version compare and
swap so duplicate resume requests cannot run two planner loops for one task.

## 5. Capability discovery and planning

### 5.1 Discovery flow

1. Load trusted action definitions and their latest maturity evidence.
2. Join each definition with registered providers, authentication state, live
   heartbeat, scopes, qualification records, and autonomy grants.
3. Compute readiness from current evidence. Remove disabled, unauthorized,
   offline, untested-for-this-risk, or otherwise unavailable providers from
   executable tools. Keep a separate explanation list for a useful `CANNOT`.
4. Apply user scopes and policy before exposing sensitive capabilities.
5. Build the planner tool schema from the remaining definitions.
6. Re-check provider availability and authorization immediately before every
   dispatch; tool visibility is not an authorization grant.

The current `toolsForPlanner()` returns the registry without task-specific
availability filtering. Add a provider-aware tool builder and pass its
capability snapshot and maturity evidence into the task trace so the result
explains what was reachable and qualified when planning began. Re-check all
readiness facts before dispatch; stale evidence downgrades the operation to
confirmation or unavailable.

### 5.2 Planner loop

Keep a uniform ReAct loop. Do not add keyword matching or per-goal dispatch.
The planner may maintain a dependency-aware plan, but it proposes one action
at a time. After execution, feed it a bounded structured result with:

* action ID, capability ID, verdict, verification status;
* artifact IDs and safe display names;
* resolved target IDs, account/device context, and resolution provenance;
* errors in a form that supports recovery;
* observations explicitly marked as untrusted external content.

Append a typed task event for each meaningful transition. The event log is the
source for the user's chronological activity view; do not reconstruct claimed
events from the final planner narration.

Planner behavior:

* Ask only when the unresolved choice could change the outcome or risk.
* On one provider failure, re-discover alternatives; never silently change the
  target or broaden scope.
* On an irreversible action, request approval at that exact action boundary.
* On unsupported capability, terminate with the exact missing capability and
  leave earlier evidence intact.
* Never report success based only on natural-language narration.

## 6. Executor, policy, approval, and retry design

The current executor already follows validate → classify → allow/confirm/deny
→ run → verify. Preserve that location as the enforcement boundary.

Required changes:

* Make `verify` required for actions that can claim a meaningful outcome. For
  read-only observation, the verifier checks the response schema and source;
  for mutations, it independently inspects resulting state.
* Bind an approval nonce to a canonical digest of action name, validated
  arguments, target/account, and consequence. Recompute and compare before the
  approved action runs. Expired, changed, or replayed approvals fail closed.
* An approval never overrides a deny. It authorizes only the exact approved
  action once.
* Add idempotency keys for externally visible actions. After a timeout, inspect
  provider state before retrying; a missing response does not prove the action
  did not happen.
* Return `unverified` when the system cannot inspect post-action state. Do not
  convert a successful transport response into a verified task outcome.
* Store the rule/version that made each policy decision so audit evidence can
  be reviewed after policy updates.

For unknown external effects, default to confirmation. Deny protected files,
credential stores, unsafe schemes, arbitrary code execution, and operations
outside the user's authority. Keep user-space inference; do not add a setup
questionnaire for ordinary paths.

## 7. Adapter implementation pattern

Every adapter follows the same vertical slice:

1. Define Zod input/output schemas and a stable capability ID.
2. Declare the manifest, auth scope, action class, target extractor, timeout,
   side-effect and retry properties.
3. Implement one narrow handler. Keep credentials in the adapter/OS store;
   never pass them in planner arguments, logs, or task evidence.
4. Implement an independent verifier and structured artifact output.
5. Register the trusted action definition in the core and, for a device agent,
   add its capability to the explicit local allowlist and dispatch map.
6. Add policy behavior, user-facing approval text, timeout/cancel handling,
   and failure recovery.
7. Add unit, structural, and end-to-end acceptance coverage; update architecture
   and security docs in the same build.

Reference registration pattern:

```ts
defineAction({
  name: "files.search",
  capabilityId: "search_files",
  actionClass: "search",
  description: "Search filenames under user-owned folders.",
  schema: SearchFilesSchema,
  timeoutMs: 60_000,
  targetOf: (args) => pathTarget(args.root),
  handler: async (args, ctx) => callAgent("search_files", args, ctx.signal),
  verify: (result) => verifySearchResult(result),
});
```

Use the same capability ID in the Windows agent advertisement and local
dispatch table. Treat a mismatched version or missing handler as unavailable.

## 8. Adapter plans

### 8.1 Playwright browser adapter

Current integration is `server/browser/playwright.ts` plus
`server/actions/browser.ts`. Preserve the pinned child process, direct Node
spawn, pipes draining, loopback MCP transport, and explicit allowlist.

Implement in this order:

1. Add a per-task browser session snapshot: tab IDs, current origin, observed
   page version, and opaque element refs with role/name/form metadata. Bind
   click/type actions to the snapshot version so stale refs fail.
2. Add a narrow `browser.upload_file` action that accepts an `ArtifactRef`,
   browser file-input ref, and page origin. Resolve the artifact on its owning
   device, check file type/size/path and exact destination, then require a
   single-use `send` approval. Never accept an arbitrary planner-supplied path.
3. Add `browser.submit` as a distinct action with an exact payload preview,
   destination origin, and consequence. Policy must confirm before submission.
   Prevent `browser.click` from bypassing this boundary: classify observed form
   submit controls from server-held page metadata; unknown state-changing
   controls require confirmation or are refused.
4. Verify via a fresh page observation: success state, resulting record, or
   visible confirmation. If verification is inconclusive, report that state.
5. Add bounded screenshot/page-image observation only as an observation
   capability. No arbitrary JS, `evaluate`, `run_code_unsafe`, cookie access,
   route changes, or untrusted browser tool exposure.
6. Add user takeover: pause the task, present the active origin and reason, let
   the user complete MFA/challenge in the headed browser, then re-observe before
   resuming. Never read typed passwords or expose session cookies to the model.

Before wiring an upstream upload tool, inspect the exact pinned Playwright MCP
version and its behavior. Add only that reviewed operation to the allowlist;
do not remove the existing deny patterns wholesale. If the upstream operation
cannot meet the target/approval contract, implement a narrow typed adapter in
REACH using supported Playwright APIs, not dynamic page code.

### 8.2 Desktop adapter

Create `windows-agent/src/capabilities/desktop.ts` for Windows accessibility
tree operations. Start with `list_windows`, `observe_controls`, `focus_window`,
`set_text`, `invoke_control`, and `verify_window_state`. Inputs use observed
opaque refs and app/window identity, never model-generated coordinates alone.
Register only those operations in `capabilities/index.ts`; add server actions
and policy definitions in `server/src/actions/desktop.ts`.

The handler must revalidate the window/control ref immediately before acting.
Unknown app/process, stale window, UAC, secure desktop, and login prompts pause
or fail closed. No keystroke macro may type into an unverified foreground app.

### 8.3 Files, documents, and media

Keep path normalization and sandbox checks on the Windows agent. Extend artifact
results so downstream actions can reference prior outputs by opaque ID.

For image search, add `media.search_images` over a user-selected directory:

1. Enumerate supported image files locally and compute content hashes.
2. Reuse a local index for unchanged hashes; never upload an entire library by
   default.
3. Explain the folder, candidate count, provider, and purpose before sending
   private images to a cloud vision/embedding service. Enforce count, byte, and
   cost budgets in code.
4. Return ranked candidates with paths, previews, and confidence; let the user
   select when identity, relationship, or exact content matters.
5. On selection, recheck existence and hash before passing the artifact to a
   document or browser action.

Extend DOCX creation with structured image artifact references, not raw model
paths. Verify the generated DOCX archive contains the expected media and
relationship entries, then verify the saved file exists and has valid ZIP/DOCX
magic bytes. Keep image understanding separate from document assembly.

### 8.4 External services and MCP

Use official, scoped APIs for services where they are available and provide
stable IDs/receipts. Use browser UI for other sites. Both are adapters behind
the same registry; neither changes planner logic.

For external MCP, add an operator-configured connector store containing server
identity, transport, auth reference, allowed tool IDs, and policy mapping. At
connect time, validate tool schemas and compare them with the user's approved
allowlist. A server advertising a new or changed tool becomes unavailable
until reviewed. Never expose a connector's raw secrets or every tool by
default.

Read-only scopes can be offered separately from mutation scopes. A send,
purchase, publish, delete, deploy, or device-security operation carries its
exact provider target into the approval and audit record.

### 8.5 Voice clients

#### Alexa+ hackathon access gate

This is a project gate, not an assumption that Alexa+ support is complete. Run
it before investing heavily in a voice demo. Using the current [Alexa+ MCP
QuickStart](https://www.developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html),
the developer account, and the hackathon's current rules, verify:

1. A real Alexa+ request can reach the REACH MCP entry point and receive a
   response through the supported path.
2. Authentication establishes the correct REACH user/account and preserves a
   stable task identity for status, clarification, approval, and response.
3. The account has access to required onboarding, hosting, auth, and
   certification steps within the submission timeline.
4. The sim is accepted as the demo client if Alexa+ access is unavailable.
5. The fallback satisfies the track's required technology use.

Write down evidence and a go/no-go decision. If viable, implement and test the
small end-to-end round trip now. If not, lock the sim as the demo client and
describe Alexa+ as a future integration, not a completed one. Do not spend the
whole demo on Alexa-specific plumbing if the gate fails.

Keep the client contract limited to goal submission, task status, user answers,
and approval decisions. Alexa or a REACH voice app does not own capability
selection or action execution. Use the same task IDs and policy checks for
voice, sim, web, mobile, and MCP clients. When the voice channel cannot bind an
approval to the authenticated account and exact action, send the user to a
trusted REACH approval surface.

Alexa+ remote MCP/OAuth remains gated by the result above; current well-known
routes in `server/src/index.ts` are stubs. Passing the access gate does not
mean the integration is built. Do not describe the sim as a live Alexa
integration.

### 8.6 Long-running tasks and routines

For schedules and event triggers, add a durable job store, explicit owner,
scope, next-run time, expiry, cancellation, idempotency key, and policy
re-evaluation at each run. An approval for a future run expires unless the user
creates a visible scoped recurring grant.

### 8.7 Development and automation work

Keep development automation late in the roadmap because it adds substantial
security complexity and is less central to the first Jarvis workflow than
files, browsers, documents, communication, calendars, and devices.

For repository work, expose narrow actions such as `dev.inspect_repo`,
`dev.run_tests` with an approved test target, and `dev.apply_patch` inside an
isolated worktree. Deploy is a separate confirm-class capability. Never add a
generic `run_command` to make the system appear more capable.

## 9. Concrete build sequence

Each slice should be independently reviewable. Do not begin substantial
hackathon feature work until Slice 0 has a recorded result. A slice is not done
until code, acceptance evidence, and truth docs agree.

### Slice 0 — Alexa+ and hackathon eligibility gate

Files: `docs/alexa-auth-checklist.md`, submission checklist, a short decision
record, and only a disposable spike if credentials are available.

* Verify real request and response paths, authenticated user/task identity,
  access/onboarding timeline, and the current track requirement.
* Verify the sim fallback is acceptable if Alexa+ access is unavailable.
* If viable, run the smallest complete end-to-end voice round trip early. If
  not, lock the sim and remove any claim that Alexa+ is integrated.

Acceptance: a dated go/no-go decision includes evidence and an explicit demo
client. This is an external dependency decision, not a code-completion claim.

### Slice A — Structured outcome, identity, and target resolution

Files: `tasks/types.ts`, `tasks/taskStore.ts`, authenticated client/task
creation, a new core target-resolution service, `planner/loop.ts`, sim task UI.

* Persist authenticated actor, client/session and task identity, requested
  outcome/constraints, device/account context, timezone, resolved target refs,
  and unresolved fields.
* Implement `target.resolve` over trusted account/provider data. Keep it a
  core service; do not introduce goal-string routes or let the model invent
  resource IDs.
* Ask one focused question when a consequential target or interpretation is
  unresolved. Carry the selected answer into approval digests and adapter args.

Acceptance: resume preserves identity and targets; “send it to Mom next Friday”
cannot execute until item, contact, account, timezone, channel, and send-versus-
draft intent are resolved.

### Slice B — Correct terminal outcomes and task-wide budgets

Files: `planner/loop.ts`, `planner/tools.ts`, `tasks/types.ts`,
`tasks/taskStore.ts`, planner/task tests.

* Add internal `reach.finish` and server-side validation of cited verified
  action IDs; keep the public MCP tool surface unchanged.
* Add complete/partial/unverified/failed/cannot outcome data; preserve earlier
  trace, target resolution, and artifacts.
* Enforce cumulative call, elapsed-time, token, and action budgets across
  approval/input resumes; prevent concurrent loops for one task.

Acceptance: a partial action then `CANNOT`, zero-action “done,” a verifier
failure, duplicate resume, or exhausted budget cannot produce false success.

### Slice C — Structured results and visible event trail

Files: `executor/registry.ts`, `executor/executor.ts`, `tasks/types.ts`,
`tasks/taskStore.ts`, sim task timeline, action tests.

* Make verification mandatory for actions that claim meaningful completion.
* Persist typed verifier results, artifact refs, and append-only task events.
* Render completed, partial, awaiting approval, awaiting clarification, failed,
  could not perform, and completed-but-unverified distinctly.
* Add bounded/redacted model serialization and versioned task-record migration.

Acceptance: each visible event has a source action or task transition; an
unverified handler cannot satisfy `complete`; old task records still load.

### Slice D — Capability readiness and autonomous-use gate

Files: `executor/registry.ts`, `registry/capabilityGraph.ts`,
`registry/deviceStore.ts`, device registration/heartbeat, `planner/tools.ts`,
sim capability diagnostics.

* Track implementation, reachability, authentication, availability,
  qualification/test evidence with expiry, and scoped autonomy approval.
* Build planner tools from trusted definitions joined to fresh provider state.
* Re-check maturity, scope, and authorization immediately before dispatch.
* Keep unsupported or unqualified capabilities explainable but non-executable.

Acceptance: offline, unauthorized, stale, or untested-for-risk operations are
not silently executable; planner-visible readiness matches audit evidence.

### Slice E — One rehearsable local/browser workflow

Files: existing file and browser actions, `browser/playwright.ts`, policy,
approval UI, verifier and task event rendering.

Choose the smallest dependable vertical slice through local files and one
unrelated website. For browser upload/submit, use `ArtifactRef`, an exact
origin/payload preview, a separate approval boundary, duplicate protection,
and post-action verification. Do not broaden the browser allowlist wholesale.

Acceptance: read-only browser work stays smooth; consequential actions pause on
the exact target; denial/expiry causes no side effect; task evidence proves the
result.

### Slice F — Document and artifact composition

Files: file/DOCX actions, artifact resolver, verifier, sim previews.

Implement local source selection, transformation, document creation, embedded
artifact references, and independent output verification. Keep media upload and
image understanding separate opt-in actions with explicit budgets.

Acceptance: selected source hashes are rechecked; the DOCX contains the
intended text/media; saved output is reopened and verified; the event trail
links input and output artifacts.

### Slice G — One storage or calendar integration

Files: one provider adapter, scoped auth, target resolver, policy/approval,
provider verifier, reconnect/revoke UI.

Pick storage or calendar based on available account access and strongest
verification; do not attempt both unless the first is stable. Add save or
follow-up scheduling to the hero only when the full path rehearses reliably.

Acceptance: exact account and target are resolved; side effects follow policy;
the created file/event has provider evidence; timeout and retry do not duplicate.

### Slice H — Production client hardening

Files: Alexa+ paths only if Slice 0 passed; otherwise sim client and demo docs.

Slice 0 already builds the minimum round trip early when Alexa+ is viable. Use
this later slice to harden the selected thin client against the stable task API
and prove user/task identity across submit, answer, approval, resume, and final
response. If no-go, keep the sim as the declared client and skip Alexa-specific
polish; don't build a misleading Alexa-shaped mock.

Acceptance: voice cannot bypass policy or lose task identity; sim fallback and
track eligibility are documented.

### Slice I — Long-running tasks and routines

Add durable checkpoints, cancellation, reauthorization, scoped recurring
grants, idempotency, and quiet-unless-action-needed notifications.

Acceptance: restart, missed triggers, expired grants, and retries do not lose
evidence or duplicate external effects.

### Slice J — Broader modalities, services, devices, and development actions

Add media understanding, native desktop accessibility, more APIs, smart-home
devices, external MCP, and repository/development automation only after the
core contracts are stable. Prioritize by user value, official access,
reachability, verification strength, and security cost. Keep development work
behind narrow typed tools and isolated worktrees; never add generic shell.

Acceptance for every new adapter: narrow revocable scope, unambiguous targets,
maturity evidence, risk classification, correct approval, verified results,
and safe timeout/retry/partial-failure behavior.

## 10. System-wide acceptance matrix

Run the full workspace typecheck and test suites before every implementation
commit. Add focused tests with each slice; do not treat a green suite as proof
of live adapter behavior.

Required scenarios:

1. **Novel composition:** combine two existing adapters for a request that has
   no named route; same planner and policy handle it.
2. **Unknown capability:** planner returns a precise `CANNOT`; it never invents
   a tool or claims completion.
3. **Partial result:** first action succeeds, next action is denied/offline;
   outcome is partial and preserves evidence.
4. **Approval integrity:** exact target/args, single-use nonce, expiry, denial,
   replay, and planner self-approval all fail safely.
5. **Untrusted content:** hostile instructions in page/file/MCP results do not
   change policy or user intent.
6. **Verification failure:** handler reports success but the independent
   verifier cannot find the effect; task does not claim completion.
7. **Interruption and retries:** restart, timeout, duplicate request, and
   approval resume do not duplicate irreversible actions.
8. **Identity and targets:** requests preserve authenticated actor/task
   identity; ambiguous account, contact, file, date, or channel is resolved or
   clarified before execution.
9. **Maturity:** declared/installed/reachable/available does not imply tested,
   verified, or approved for autonomous use; expired evidence blocks the unsafe
   mode.
10. **Event trail:** each visible action and result maps to persisted evidence;
    complete, partial, awaiting, failed, cannot, and unverified states render
    distinctly.
11. **Data boundaries:** secret/system/other-user paths are denied; external
   transmission states exact files and destinations; credentials never enter
   planner history or logs.
12. **Budget exhaustion:** model calls, time, bytes, image count, and action
   count stop at hard limits and leave an explainable partial result.
13. **Alexa+ gate:** real request/response, user/task identity, account access,
    sim fallback, and track eligibility are evidenced before the client is
    selected for the submission.
14. **Live acceptance:** each adapter has at least one end-to-end run on its
    real target in addition to mocked handler tests.

## 11. Implementation handoff rules

* Read `docs/architecture.md`, `docs/security.md`, this guide, and local
  `AGENTS.md` before touching a slice. If truth docs conflict with code, inspect
  the code and correct docs in the same build.
* Work on `main` only while it remains clean and every commit gate passes; use
  an isolated worktree when simultaneous work or risky experimentation needs
  separation.
* Do not run a live send, purchase, publish, delete, deployment, or external
  device action as a test without an explicitly prepared safe target and an
  appropriate user approval.
* Keep commits atomic. Record live-test limits and friction honestly.
* Do not mark roadmap items built from types, mocks, or a planner narrative;
  require a verified acceptance flow.
