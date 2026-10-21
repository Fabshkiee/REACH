# Security model (v2 — current truth)

> Current truth. v1 history: `docs/v1-retired.md`. Anything here marked
> *(planned)* lands in the A-series builds; everything else is enforced today.

## Posture in one paragraph

REACH is safe for a judge to run because **the model proposes and the code
disposes**: every action is schema-validated, policy-classified, timed, audited,
and result-verified before and after execution. There is no raw shell, no
per-goal backdoor, and no permission that outlives a single approved action.

## Policy classes

| Class | Examples | Handling |
|---|---|---|
| Auto | read/search user files; write/move with clear intent; browser navigate/read; download into the work dir; launch known-safe apps | Run immediately, audit entry |
| Confirm | delete, overwrite, send/submit/publish/purchase, unknown binaries, ambiguous or sensitive targets | Pause (`awaiting_approval`); action-specific, expiring approval quoting exact target + consequence |
| Deny | system dirs, other users' data, known secret locations (browser profiles, keys, `.env`/credential files), code execution | Refuse with reason; refusal is audited |

User-owned space is **inferred** (profile minus deny patterns) — never a setup
questionnaire. The planner may emit `ask_user` only when a target genuinely
can't be inferred or a real boundary is crossed.

## Channel security

* Core ↔ agent: Bearer token (`AGENT_TOKEN`, same value both sides).
  Boot is fail-closed (both refuse to start without it, test exempt) AND the
  middleware is fail-closed (unconfigured token refuses instead of trusting).
* Services bind `127.0.0.1` explicitly (`server/src/index.ts`,
  `windows-agent/src/index.ts`); remote access only via explicit tunnel. Never
  widen the bind without route-auth review: `/tools/*`, `/approvals/*`,
  `/tasks/*/input`, and device pause/revoke are same-origin user-channel routes.
* Devices: user pause stops dispatch (heartbeat continues, pause survives
  heartbeats and re-registration); resume re-enables; revoke deletes the record
  (a still-running agent re-registers — pause is the control that holds while
  the agent is alive). Stale heartbeats (>90s) and paused devices read as
  unavailable everywhere; empty capability graph is empty (no phantom laptop).
* No secrets in the repo (`.env` gitignored, `.env.example` only); `npm audit` clean at every commit.

## Guarantees / assumptions / non-goals

* **Guarantees:** no action outside allow/confirm/deny adjudication; no shell
  interpretation of any argument; every mutation auditable from task evidence.
* **Assumptions:** the laptop owner runs their own agent; whoever holds
  `AGENT_TOKEN` controls the mesh; localhost is trusted at the network layer.
* **Non-goals:** TLS on localhost, multi-user separation, full OAuth 2.1 PKCE
  (arrives with Alexa onboarding, Phase 4), sandboxing a hostile local operator.

## Known limits (stated, not hidden)

These are boundaries the current build does **not** close. They are listed
because a security model that only lists what it got right is not a security
model.

* **DNS rebinding against `web.request`.** Policy confirms any target whose
  host is a bare IP or `localhost`, but a *public hostname that resolves to a
  loopback address* (`…nip.io`, `localtest.me`) is a "named web target" and
  is allowed. The proper fix is to resolve the hostname and reject private
  and loopback ranges — that needs I/O, which would break the policy engine's
  "pure function, no I/O" property, so it belongs in the executor as a
  pre-dispatch check rather than in the classifier. Until then: the core and
  the agent bind `127.0.0.1` only, the mesh requires `AGENT_TOKEN`, and
  `web.request` is not used by any demonstrated flow.
* **The planner can read any file the user owns.** That is the product, not a
  bug — but it means the trust boundary is the *device*, not the agent. Anyone
  who can talk to the core with a valid token inherits read access to the
  user's documents.
* **One shared token.** `AGENT_TOKEN` authenticates every agent to the core.
  There is no per-device credential, no rotation, and no revocation short of
  restarting the core. Per-device credentials and an outbound relay are
  post-v1 (named in the roadmap).
* **A confirmed action is trusted for the shape it was approved with.** The
  approval quotes the exact validated arguments and the approval is
  single-use and expiring, but a capability that mutates something *other*
  than its stated target is not detectable by the core.
* **The model reads page text as data.** Browser output is untrusted input. It
  cannot change policy or grant an approval, but it *can* mislead the planner
  into proposing a different action — which is why every action still passes
  policy and, for consequential classes, a human.
