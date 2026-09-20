/**
 * Planner backend contract. The Bedrock implementation spends real calls;
 * the scripted mock proves loop logic for $0.00. Both speak this shape and
 * nothing else — the ReAct loop never imports an SDK directly.
 */
export interface PlannerToolDef {
  name: string;
  description: string;
  /** Flat JSON Schema: {type:"object", properties, required}. Nova-compatible. */
  inputSchema: Record<string, unknown>;
}

export interface PlannerToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface PlannerTurn {
  /** Assistant text preceding any tool calls (may be empty). */
  text: string;
  toolCalls: PlannerToolCall[];
}

export interface ToolOutcome {
  toolCallId: string;
  /** Rendered result (or error) handed back to the model. */
  content: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface HistoryEntry {
  role: "user" | "assistant";
  text?: string;
  toolCalls?: PlannerToolCall[];
  toolResults?: ToolOutcome[];
}

export interface PlannerBackend {
  readonly backendName: string;
  converse(input: {
    system: string;
    history: HistoryEntry[];
    tools: PlannerToolDef[];
    maxTokens?: number;
  }): Promise<{ turn: PlannerTurn; usage: TokenUsage }>;
}
