import {
  ZodArray,
  ZodBoolean,
  ZodDefault,
  ZodEffects,
  ZodEnum,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodString,
  type ZodTypeAny,
} from "zod";

function unwrap(s: ZodTypeAny): ZodTypeAny {
  if (s instanceof ZodEffects) return s.innerType();
  if (s instanceof ZodDefault) return s.removeDefault();
  if (s instanceof ZodOptional) return s.unwrap();
  return s;
}

/**
 * Zod → flat JSON Schema for Nova tool definitions. Nova supports only a
 * top-level {type, properties, required} subset — this converter accepts
 * exactly that shape (flat primitives + enums) and throws loudly on anything
 * richer, so an incompatible schema can never silently degrade planning.
 */
export function toFlatJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  let s: ZodTypeAny = schema;
  while (s instanceof ZodEffects || s instanceof ZodDefault || s instanceof ZodOptional) {
    s = unwrap(s);
  }
  if (!(s instanceof ZodObject)) {
    throw new Error("tool input schema must be a Zod object at the top level");
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const shape = s.shape as Record<string, ZodTypeAny>;
  for (const [key, raw] of Object.entries(shape)) {
    let field: ZodTypeAny = raw;
    let optional = false;
    while (field instanceof ZodOptional || field instanceof ZodDefault) {
      optional = true;
      field = unwrap(field);
    }
    if (field instanceof ZodEffects) field = unwrap(field);
    properties[key] = fieldSchema(key, field);
    if (!optional) required.push(key);
  }
  return { type: "object", properties, required };
}

function fieldSchema(key: string, field: ZodTypeAny): Record<string, unknown> {
  if (field instanceof ZodString) {
    const out: Record<string, unknown> = { type: "string" };
    for (const check of field._def.checks as Array<{ kind: string; value?: unknown }>) {
      if (check.kind === "min" && typeof check.value === "number") out.minLength = check.value;
      if (check.kind === "max" && typeof check.value === "number") out.maxLength = check.value;
    }
    const desc = (field._def as { description?: unknown }).description;
    if (typeof desc === "string") out.description = desc;
    return out;
  }
  if (field instanceof ZodNumber) {
    const out: Record<string, unknown> = { type: "number" };
    for (const check of field._def.checks as Array<{ kind: string; value?: unknown }>) {
      if (check.kind === "min" && typeof check.value === "number") out.minimum = check.value;
      if (check.kind === "max" && typeof check.value === "number") out.maximum = check.value;
      if (check.kind === "int") out.multipleOf = 1;
    }
    return out;
  }
  if (field instanceof ZodBoolean) return { type: "boolean" };
  if (field instanceof ZodEnum) return { type: "string", enum: [...(field._def.values as unknown[])] };
  if (field instanceof ZodArray) {
    let itemType = field.element;
    while (itemType instanceof ZodOptional || itemType instanceof ZodDefault) {
      itemType = unwrap(itemType);
    }
    if (itemType instanceof ZodEffects) itemType = unwrap(itemType);
    const itemSchema = fieldSchema(`${key}[]`, itemType);
    const out: Record<string, unknown> = {
      type: "array",
      items: itemSchema,
    };
    const max = (field._def as { maxLength?: { value: number } })?.maxLength?.value;
    const min = (field._def as { minLength?: { value: number } })?.minLength?.value;
    const exact = (field._def as { exactLength?: { value: number } })?.exactLength?.value;
    if (typeof min === "number") out.minItems = min;
    if (typeof max === "number") out.maxItems = max;
    if (typeof exact === "number") {
      out.minItems = exact;
      out.maxItems = exact;
    }
    const desc = (field._def as { description?: unknown }).description;
    if (typeof desc === "string") out.description = desc;
    return out;
  }
  throw new Error(`unsupported schema field "${key}": Nova tool schemas accept flat primitives and enums only`);
}
