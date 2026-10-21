# AWS Builder — documented integration

> Current truth (v2). v1 history: `docs/v1-retired.md`.

Mini-challenge: any primary-track project incorporating AWS services with documented integration.
REACH uses **Bedrock as the planner brain** (plus drafted document content from the same calls).

## What / where

* Code hook (runtime, not README-only): `server/src/planner/bedrock.ts`
  live Converse calls in the planner loop (goal → plan → proposed actions) plus
  structured drafting for `create_document` sections. (`server/src/aws/bedrock.stub.ts`
  is legacy only.) Wire mapping handles Bedrock tool-name rules; unmappable names
  fall through to unknown-tool recovery.
* Model: `BEDROCK_MODEL_ID` env, default `amazon.nova-pro-v1:0`
  (`server/src/config.ts` + `server/src/planner/bedrock.ts` agree). Nova Pro
  replaced Nova Lite on 2026-10-01: Lite looped on unexpected 404s and
  obstacles, Pro does not (see the friction log). Fallback if Pro access is
  not granted: `amazon.nova-lite-v1:0`.
  Region default `us-east-1` (confirm model access in the console once
  credits land). Live evidence: 2026-09-20 full run
  `3678 in / 91 out` — fractions of a cent at Nova pricing (see friction log).
* Meeting-transcription: the **reasoning half is live** — Bedrock reads a
  transcript, reasons over it, drafts the minutes, and the planner writes a
  real `.docx` that is independently verified. The **capture half is not
  built**: there is no `audio.*` capability and no Transcribe call. The next
  adapters are `audio.capture` (agent) → `audio.transcribe` (Amazon Transcribe,
  with S3 for audio longer than Transcribe's 5-minute synchronous limit) →
  the long-running execution model that lets a one-hour job checkpoint and
  resume. Everything needed to *claim* that today is claimed; nothing else.
* Kiro/CLI use during dev also counts toward Builder narrative — note in Product Feedback.

## Setup

1. AWS account + $150 credit request (by Oct 21 12pm PT) + Bedrock model access enable.
2. `AWS_REGION`, `BEDROCK_MODEL_ID`, credentials via env (never commit).
3. Converse is wired into the planner loop; document latency/cost per plan in evidence (`usage` field) + friction log.

## For Product Feedback answer

State service (Bedrock), SDK (`@aws-sdk/client-bedrock-runtime`), purpose (planning +
drafting), input/output shape, and why Bedrock vs local LLM (tool-use quality +
managed access + credit eligibility).
