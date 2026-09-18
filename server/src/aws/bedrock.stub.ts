import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

/**
 * AWS Builder (Bedrock-only) stub — proves runtime SDK hook for judging.
 * Real content generation lands in the hero workflow (transcript → minutes).
 * Requires AWS_REGION + Bedrock model access; never called until the planner loop lands (A-series).
 */
const region = process.env.AWS_REGION ?? "us-east-1";
export const bedrockClient = new BedrockRuntimeClient({ region });

export const MINUTES_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-haiku-4-5-20251001-v1:0";

export async function generateMinutes(transcript: string): Promise<string> {
  if (!transcript.trim()) throw new Error("empty transcript");
  // TODO Phase 5: uncomment real call once AWS credits + model access confirmed.
  // const res = await bedrockClient.send(new ConverseCommand({
  //   modelId: MINUTES_MODEL_ID,
  //   messages: [{ role: "user", content: [{ text: `Summarize into meeting minutes:\n${transcript}` }] }],
  // }));
  // return res.output?.message?.content?.map((b) => ("text" in b ? b.text : "")).join("") ?? "";
  void ConverseCommand;
  throw new Error("not_implemented: Bedrock wiring lands in Phase 5 hero workflow");
}
