# AWS Builder (Bedrock-only) — documented integration

Mini-challenge: any primary-track project incorporating AWS services with documented integration.
REACH uses **Bedrock-only** for MVP to keep the story tight.

## What / where

* Code hook (runtime, not README-only): `server/src/aws/bedrock.stub.ts`
  imports `BedrockRuntimeClient` and exposes `generateMinutes(transcript)`.
* Real call lands in Phase 5 hero workflow:
  `meeting capture → transcript → Bedrock Converse → minutes → saved .docx via windows-agent`.
* Model: `BEDROCK_MODEL_ID` env, default `anthropic.claude-haiku-4-5-20251001-v1:0`
  (confirm availability in `AWS_REGION`, default `us-east-1`, once credits granted).
* Kiro/CLI use during dev also counts toward Builder narrative — note in Product Feedback.

## Setup (later, not skeleton sprint)

1. AWS account + $150 credit request (by Oct 21 12pm PT) + Bedrock model access enable.
2. `AWS_REGION`, `BEDROCK_MODEL_ID`, credentials via env (never commit).
3. Uncomment `ConverseCommand` call in stub, wire into task runner, document latency/cost.

## For Product Feedback answer

State service (Bedrock), SDK (`@aws-sdk/client-bedrock-runtime`), purpose (minutes),
input/output shape, and why Bedrock vs local LLM (quality + managed access + credit eligibility).
