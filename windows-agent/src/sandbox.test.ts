import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "reach-agent-sandbox-"));
process.env.REACH_USER_ROOT = root;

import { assertAllowedPath, resolveWithin } from "./sandbox.js";

describe("agent sandbox", () => {
  it("confines traversal to the root", () => {
    assert.throws(() => resolveWithin(root, "..\\Windows\\x.dll"), /escapes/);
    assert.ok(resolveWithin(root, "a\\b.txt").startsWith(root));
  });

  it("allows ordinary in-root paths", () => {
    assert.ok(assertAllowedPath(join(root, "Documents", "a.docx")).startsWith(root));
  });

  it("refuses secrets, siblings, and junk", () => {
    assert.throws(() => assertAllowedPath(join(root, ".ssh", "id_rsa")), /secret/);
    assert.throws(() => assertAllowedPath(join(root, ".env")), /secret/);
    assert.throws(() => assertAllowedPath(join(root, "k.pem")), /secret/);
    assert.throws(
      () => assertAllowedPath(join(root, "AppData", "Local", "Google", "Chrome", "User Data", "x")),
      /credential/,
    );
    assert.throws(() => assertAllowedPath(join(root, "..", "someone-else", "d.txt")), /another user|escapes/);
    assert.throws(() => assertAllowedPath(""), /invalid path/);
  });
});
