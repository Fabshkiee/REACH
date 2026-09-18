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
  *(planned: fail-closed boot — refuse to start unset. Today: warn-and-trust-localhost.)*
* Services bind `127.0.0.1` by default; remote access only via explicit tunnel (Phase 4).
* No secrets in the repo (`.env` gitignored, `.env.example` only); `npm audit` clean at every commit.

## Guarantees / assumptions / non-goals

* **Guarantees:** no action outside allow/confirm/deny adjudication; no shell
  interpretation of any argument; every mutation auditable from task evidence.
* **Assumptions:** the laptop owner runs their own agent; whoever holds
  `AGENT_TOKEN` controls the mesh; localhost is trusted at the network layer.
* **Non-goals:** TLS on localhost, multi-user separation, full OAuth 2.1 PKCE
  (arrives with Alexa onboarding, Phase 4), sandboxing a hostile local operator.
