# AWS Builder — documented integration

> Current truth (v2). v1 history: `docs/v1-retired.md`.

Mini-challenge: any primary-track project incorporating AWS services with documented integration.
REACH uses **Bedrock as the planner brain** (plus drafted document content from the same calls).

## What / where

* Code hook (runtime, not README-only): `server/src/aws/bedrock.stub.ts`
  imports `BedrockRuntimeClient` today; live Converse calls land in the A-series
  planner loop (goal → plan → proposed actions) and in structured drafting for
  `create_document` sections.
* Model: `BEDROCK_MODEL_ID` env, default `anthropic.claude-haiku-4-5-20251001-v1:0`
  (fast/cheap, strong tool use; Sonnet fallback documented if plans get hard),
  `AWS_REGION` default `us-east-1` (confirm model access in console once credits land).
* Meeting-transcription hero (Transcribe + S3) is **parked**, not cut — minutes-style
  drafting happens through the planner instead.
* Kiro/CLI use during dev also counts toward Builder narrative — note in Product Feedback.

## Setup

1. AWS account + $150 credit request (by Oct 21 12pm PT) + Bedrock model access enable.
2. `AWS_REGION`, `BEDROCK_MODEL_ID`, credentials via env (never commit).
3. Wire Converse into the planner loop, document latency/cost per plan.

## For Product Feedback answer

State service (Bedrock), SDK (`@aws-sdk/client-bedrock-runtime`), purpose (planning +
drafting), input/output shape, and why Bedrock vs local LLM (tool-use quality +
managed access + credit eligibility).
