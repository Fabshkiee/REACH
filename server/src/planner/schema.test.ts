import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { toFlatJsonSchema } from "./schema.js";

describe("flat json schema converter", () => {
  it("converts flat primitives with bounds", () => {
    const out = toFlatJsonSchema(
      z.object({
        path: z.string().min(1).max(2000),
        limit: z.number().int().min(1).max(50).optional(),
        overwrite: z.boolean().default(false),
      }),
    );
    assert.deepEqual(out, {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1, maxLength: 2000 },
        limit: { type: "number", multipleOf: 1, minimum: 1, maximum: 50 },
        overwrite: { type: "boolean" },
      },
      required: ["path"],
    });
  });

  it("converts enums and unwraps refinements", () => {
    const out = toFlatJsonSchema(
      z.object({
        mode: z.enum(["name", "content"]).default("name"),
        task: z.string().min(3).refine((t) => t !== "x", { message: "no" }),
      }),
    );
    assert.deepEqual((out.properties as Record<string, unknown>)["mode"], {
      type: "string",
      enum: ["name", "content"],
    });
    assert.deepEqual((out.properties as Record<string, unknown>)["task"], { type: "string", minLength: 3 });
  });

  it("rejects nested objects loudly", () => {
    assert.throws(() => toFlatJsonSchema(z.object({ deep: z.object({ x: z.string() }) })), /flat primitives/);
  });
});
