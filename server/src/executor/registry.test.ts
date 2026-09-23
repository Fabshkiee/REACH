import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { clearActionRegistry, defineAction, listActionDefs } from "./registry.js";

beforeEach(() => {
  clearActionRegistry();
});

const base = {
  actionClass: "read" as const,
  description: "test",
  schema: z.object({}),
  timeoutMs: 1000,
  handler: async () => ({}),
};

describe("action registry", () => {
  it("rejects defs without a verifier", () => {
    const defWithoutVerify = {
      name: "test.noverify",
      ...base,
    };
    assert.throws(
      () => defineAction(defWithoutVerify as unknown as Parameters<typeof defineAction>[0]),
      /must supply verify/,
    );
    assert.equal(listActionDefs().length, 0);
  });

  it("accepts defs with a verifier and pins names/registration", () => {
    defineAction({ name: "test.ok", ...base, verify: () => "ok" });
    assert.equal(listActionDefs().length, 1);
    assert.throws(() => defineAction({ name: "test.ok", ...base, verify: () => "x" }), /already registered/);
    assert.throws(() => defineAction({ name: "BAD NAME", ...base, verify: () => "x" }), /invalid action name/);
  });
});
