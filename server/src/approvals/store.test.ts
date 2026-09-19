import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.REACH_DATA_DIR = mkdtempSync(join(tmpdir(), "reach-a1-approvals-"));

import { createApproval, getApproval, listPendingApprovals, resolveApproval } from "./store.js";

describe("approvals store", () => {
  it("creates pending approvals with expiry", () => {
    const apr = createApproval({ taskId: "task_x", actionName: "files.delete", actionClass: "delete", target: "a.txt", consequence: "c", ttlMs: 60_000 });
    assert.equal(apr.status, "pending");
    assert.ok(apr.id.startsWith("apr_"));
    assert.equal(getApproval(apr.id)?.status, "pending");
  });

  it("resolves exactly once", () => {
    const apr = createApproval({ taskId: "task_x", actionName: "files.delete", actionClass: "delete", consequence: "c" });
    assert.equal(resolveApproval(apr.id, "approve", "test")?.status, "approved");
    assert.equal(resolveApproval(apr.id, "deny", "test"), undefined);
    assert.equal(getApproval(apr.id)?.status, "approved");
  });

  it("rejects untrusted deciders (planner can never approve)", () => {
    const apr = createApproval({ taskId: "task_x", actionName: "files.delete", actionClass: "delete", consequence: "c" });
    assert.equal(resolveApproval(apr.id, "approve", "planner"), undefined);
    assert.equal(resolveApproval(apr.id, "approve", "executor"), undefined);
    assert.equal(getApproval(apr.id)?.status, "pending");
  });

  it("expires past-due approvals lazily", () => {
    const apr = createApproval({ taskId: "task_x", actionName: "x.y", actionClass: "delete", consequence: "c", ttlMs: -1 });
    assert.equal(getApproval(apr.id)?.status, "expired");
    assert.equal(resolveApproval(apr.id, "approve", "test"), undefined);
  });

  it("rejects path-unsafe ids", () => {
    assert.equal(getApproval("../../evil"), undefined);
    assert.equal(getApproval("apr_nonexistent"), undefined);
  });

  it("lists pendings per task", () => {
    createApproval({ taskId: "task_list_me", actionName: "a.b", actionClass: "delete", consequence: "c" });
    const all = listPendingApprovals();
    assert.ok(all.every((a) => a.status === "pending"));
    assert.ok(listPendingApprovals("task_list_me").length >= 1);
  });

  afterEach(() => {
    // isolation between runs is via fresh temp dir per process; nothing to tear down
  });
});
