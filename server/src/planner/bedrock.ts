import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";
import { ConfigurationError } from "../config.js";
import type { HistoryEntry, PlannerBackend, PlannerToolCall, PlannerToolDef } from "./backend.js";

export const DEFAULT_MODEL_ID = "amazon.nova-lite-v1:0";

function toConverseMessages(history: HistoryEntry[]): Message[] {
  const out: Message[] = [];
  for (const h of history) {
    if (h.role === "user" && !h.toolResults?.length) {
      out.push({ role: "user", content: [{ text: h.text ?? "" }] });
      continue;
    }
    if (h.role === "assistant") {
      const content: ContentBlock[] = [];
      if (h.text) content.push({ text: h.text });
      for (const tc of h.toolCalls ?? []) {
        content.push({ toolUse: { toolUseId: tc.id, name: tc.name, input: tc.args as never } });
      }
      out.push({ role: "assistant", content });
      continue;
    }
    // user turn carrying tool results (content is a list per the SDK shape)
    out.push({
      role: "user",
      content: (h.toolResults ?? []).map((r) => ({
        toolResult: { toolUseId: r.toolCallId, content: [{ text: r.content }] },
      })),
    });
  }
  return out;
}

/**
 * Live Bedrock backend (Nova default). Temperature 0 per AWS tool-use guidance.
 * AccessDenied surfaces as ConfigurationError naming the fix — never a raw dump.
 */
export class BedrockPlannerBackend implements PlannerBackend {
  readonly backendName = "bedrock";
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;

  constructor(region?: string, modelId?: string) {
    const r = region ?? process.env.AWS_REGION ?? "us-east-1";
    const m = modelId ?? process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL_ID;
    this.client = new BedrockRuntimeClient({ region: r });
    this.modelId = m;
  }

  async converse(input: {
    system: string;
    history: HistoryEntry[];
    tools: PlannerToolDef[];
    maxTokens?: number;
  }): Promise<{
    turn: { text: string; toolCalls: PlannerToolCall[] };
    usage: { inputTokens: number; outputTokens: number };
  }> {
    let res;
    try {
      res = await this.client.send(
        new ConverseCommand({
          modelId: this.modelId,
          system: [{ text: input.system }],
          messages: toConverseMessages(input.history),
          inferenceConfig: { maxTokens: input.maxTokens ?? 2000, temperature: 0 },
          toolConfig: {
            // The SDK types this as smithy's internal DocumentType; our schemas
            // are plain JSON by construction (asserted in schema.test.ts).
            tools: input.tools.map((t) => ({
              toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema as never } },
            })),
          },
        }),
      );
    } catch (err) {
      throw toFriendlyError(err, this.modelId);
    }
    let text = "";
    const toolCalls: PlannerToolCall[] = [];
    for (const block of res.output?.message?.content ?? []) {
      if ("text" in block && typeof block.text === "string") text += block.text;
      if ("toolUse" in block && block.toolUse) {
        toolCalls.push({
          id: block.toolUse.toolUseId ?? `tc_${Math.random().toString(36).slice(2, 10)}`,
          name: block.toolUse.name ?? "",
          args: (block.toolUse.input as Record<string, unknown> | undefined) ?? {},
        });
      }
    }
    return {
      turn: { text, toolCalls },
      usage: {
        inputTokens: res.usage?.inputTokens ?? 0,
        outputTokens: res.usage?.outputTokens ?? 0,
      },
    };
  }
}

function toFriendlyError(err: unknown, modelId: string): Error {
  const name = (err as { name?: string })?.name ?? "";
  const message = err instanceof Error ? err.message : String(err);
  if (name === "AccessDeniedException" || /accessdenied|not authorized|verification/i.test(message)) {
    return new ConfigurationError(
      `Bedrock refused the call (${name || "auth"}): ${message.slice(0, 200)}`,
      `Fix: confirm model access for ${modelId} (Bedrock console → Model catalog → open in playground once), ` +
        `check AWS keys/region, and if the account banner persists past 2h, mail aws-verification@amazon.com.`,
    );
  }
  if (name === "ValidationException") {
    return new Error(`Bedrock rejected the request shape: ${message.slice(0, 300)}`);
  }
  // Generic failures (e.g. SignatureDoesNotMatch from a bad secret key) carry
  // multi-KB canonical-string dumps — quote the head, never the whole thing.
  return err instanceof Error ? new Error(`${err.name || "Bedrock error"}: ${message.slice(0, 300)}`) : new Error(`Bedrock call failed: ${message.slice(0, 200)}`);
}
