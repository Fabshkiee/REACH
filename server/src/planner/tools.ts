import { listActionDefs } from "../executor/registry.js";
import type { PlannerToolDef } from "./backend.js";
import { toFlatJsonSchema } from "./schema.js";

/** Internal finish tool: intercepted by the loop, never executor-dispatched. */
export const FINISH_TOOL_NAME = "reach.finish";

export type FinishKind = "complete" | "partial" | "unverified" | "failed" | "cannot";

export interface FinishArgs {
  kind: FinishKind;
  /** What was achieved (complete/partial) — one short paragraph. */
  summary?: string;
  /** Why it stopped (failed/cannot/unverified) — one short paragraph. */
  reason?: string;
  /** Trace actionIds grounding the claim. Required for complete/partial/unverified. */
  evidenceActionIds?: string[];
  /** For `cannot`: which capabilities were missing. */
  missingCapabilities?: string[];
  /** For `partial`: what remains undone. */
  remaining?: string[];
}

export function finishToolDef(): PlannerToolDef {
  return {
    name: FINISH_TOOL_NAME,
    description:
      "Declare the task outcome when no more actions are needed. Cite trace actionIds as evidence — narration alone is rejected. complete needs verified actions; partial keeps prior evidence and lists remaining work; cannot/unverified/failed explain why.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["complete", "partial", "unverified", "failed", "cannot"] },
        summary: { type: "string", maxLength: 2000 },
        reason: { type: "string", maxLength: 2000 },
        evidenceActionIds: { type: "array", items: { type: "string" } },
        missingCapabilities: { type: "array", items: { type: "string" } },
        remaining: { type: "array", items: { type: "string" } },
      },
      required: ["kind"],
    },
  };
}

export const MILESTONE_TOOL_NAME = "reach.checkpoint_milestone";

export interface CheckpointMilestoneArgs {
  completed: string;
  next?: string;
}

export function milestoneToolDef(): PlannerToolDef {
  return {
    name: MILESTONE_TOOL_NAME,
    description:
      "Record progress on a composite goal milestone. Call this when a sub-goal is achieved (e.g. 'found 3 dog photos', 'downloaded images', 'created document') before moving to the next milestone.",
    inputSchema: {
      type: "object",
      properties: {
        completed: { type: "string", minLength: 1, maxLength: 500, description: "Description of the milestone completed." },
        next: { type: "string", maxLength: 500, description: "Next sub-goal to execute." },
      },
      required: ["completed"],
    },
  };
}

/**
 * Planner-visible tools, generated from the executor registry — the single
 * source of truth. The model can only ever propose registered actions;
 * anything else fails closed at proposal time, not at execution.
 */
export function toolsForPlanner(): PlannerToolDef[] {
  const tools = listActionDefs().map((d) => ({
    name: d.name,
    description: d.description,
    inputSchema: toFlatJsonSchema(d.schema),
  }));
  // Framework-level input request: handled by the executor before any registry
  // lookup, listed here so the model can propose it like any other tool.
  tools.push({
    name: "reach.ask_user",
    description:
      "Ask the user a clarifying question when the target of an action is genuinely ambiguous. Use instead of guessing.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", minLength: 1, maxLength: 2000 },
      },
      required: ["question"],
    },
  });
  // Framework-level milestone checkpoint for two-tier decomposition:
  tools.push(milestoneToolDef());
  // Structured terminal reply: intercepted in planner/loop.ts, never dispatched
  // through the executor as a device action.
  tools.push(finishToolDef());
  return tools;
}
