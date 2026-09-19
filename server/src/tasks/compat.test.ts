import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "reach-a1-compat-"));
process.env.REACH_DATA_DIR = dir;
mkdirSync(join(dir, "tasks"), { recursive: true });

// A v1 task file: version 1, no trace/plan/approval fields.
writeFileSync(
  join(dir, "tasks", "task_legacy000_test.json"),
  JSON.stringify({ version: 1, id: "task_legacy000_test", goal: "legacy goal", status: "completed", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }),
);

import { getTask, listRecentTasks } from "./taskStore.js";

describe("task store v1 compat", () => {
  it("v1 files load with new fields absent", () => {
    const t = getTask("task_legacy000_test");
    assert.ok(t, "legacy task should load");
    assert.equal(t?.goal, "legacy goal");
    assert.equal(t?.trace, undefined);
    assert.equal(t?.plan, undefined);
  });

  it("legacy tasks appear in listings", () => {
    const ids = listRecentTasks(50).map((t) => t.id);
    assert.ok(ids.includes("task_legacy000_test"));
  });
});
