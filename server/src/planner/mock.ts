import type { HistoryEntry, PlannerBackend, PlannerToolDef } from "./backend.js";

/**
 * Scripted backend for tests: returns queued turns, fails loudly when dry.
 * Zero spend, deterministic. Never used outside NODE_ENV=test-driven suites.
 */
export class ScriptedPlannerBackend implements PlannerBackend {
  readonly backendName = "scripted-mock";
  private readonly queue: Array<{ text?: string; toolCalls?: Array<{ name: string; args?: Record<string, unknown> }> }>;
  private readonly strict: boolean;
  readonly calls: Array<{ system: string; history: HistoryEntry[]; tools: PlannerToolDef[] }> = [];

  constructor(
    steps: Array<{ text?: string; toolCalls?: Array<{ name: string; args?: Record<string, unknown> }> }>,
    opts: { strict?: boolean } = {},
  ) {
    this.queue = [...steps];
    // Strict (default): scripted calls must name offered tools — catches drift.
    // Non-strict: lets hallucinated names through so recovery paths get tested.
    this.strict = opts.strict ?? true;
  }

  async converse(input: { system: string; history: HistoryEntry[]; tools: PlannerToolDef[] }): Promise<{
    turn: { text: string; toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> };
    usage: { inputTokens: number; outputTokens: number };
  }> {
    this.calls.push(input);
    const next = this.queue.shift();
    if (!next) throw new Error("scripted backend exhausted: test planned more turns than scripted");
    // Tool names must exist in the offered set — catches test/model drift.
    // Non-strict mode passes hallucinations through so loop recovery is testable.
    for (const tc of next.toolCalls ?? []) {
      if (this.strict && !input.tools.some((t) => t.name === tc.name)) {
        throw new Error(`scripted call to unknown tool "${tc.name}" (not in offered set)`);
      }
    }
    return {
      turn: {
        text: next.text ?? "",
        toolCalls: (next.toolCalls ?? []).map((tc, i) => ({
          id: `mock_tc_${this.calls.length}_${i}`,
          name: tc.name,
          args: tc.args ?? {},
        })),
      },
      usage: { inputTokens: 100, outputTokens: 50 },
    };
  }
}
