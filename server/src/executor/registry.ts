import { z } from "zod";
import type { ActionClass, PolicyContext } from "../policy/types.js";

export interface HandlerContext {
  taskId: string;
  actionId: string;
  policyCtx: PolicyContext;
  signal: AbortSignal;
}

export interface ActionDefinition {
  /** Capability-qualified name, e.g. "files.read". */
  name: string;
  actionClass: ActionClass;
  description: string;
  schema: z.ZodTypeAny;
  timeoutMs: number;
  /**
   * This action waits on a third party (a cloud job, a long transcription).
   * The time spent waiting does NOT count against the task's elapsed budget:
   * a one-hour meeting transcribing for twenty minutes is legitimate work,
   * not a stuck agent. The action's own timeout still bounds it.
   */
  externalWait?: boolean;
  /**
   * The agent capability this action dispatches to (e.g. "read_file").
   * Device-backed actions only: the planner is offered these ONLY while a
   * connected device advertises that capability, so the model never plans
   * against a primitive this machine cannot run. Core-side actions (browser,
   * web) omit it and are always available.
   */
  deviceCapability?: string;
  /**
   * Extract the policy target from validated args. The loop passes this to
   * policy — definitions that omit it leave targeting to raw input (rare).
   */
  targetOf?: (args: Record<string, unknown>) => string | undefined;
  /**
   * Post-execution check. Return a summary string on success; throw or return
   * false when the result fails verification. Verification is mandatory: every
   * registered action must supply one, and `defineAction` rejects defs without.
   */
  verify: (result: unknown) => string | false;
  handler: (args: Record<string, unknown>, ctx: HandlerContext) => Promise<unknown>;
}

const defs = new Map<string, ActionDefinition>();

export function defineAction(def: ActionDefinition): void {
  if (!/^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/.test(def.name)) {
    throw new Error(`invalid action name "${def.name}": expected <adapter>.<verb>`);
  }
  if (typeof def.verify !== "function") {
    throw new Error(`action "${def.name}" must supply verify() — unverified success claims are rejected`);
  }
  if (defs.has(def.name)) throw new Error(`action already registered: ${def.name}`);
  defs.set(def.name, def);
}

export function getActionDef(name: string): ActionDefinition | undefined {
  return defs.get(name);
}

export function listActionDefs(): ActionDefinition[] {
  return [...defs.values()];
}

/** Test-only reset. Production code never unregisters. */
export function clearActionRegistry(): void {
  defs.clear();
}
