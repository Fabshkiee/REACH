import { listActionDefs } from "../executor/registry.js";
import type { PlannerToolDef } from "./backend.js";
import { toFlatJsonSchema } from "./schema.js";

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
  return tools;
}
