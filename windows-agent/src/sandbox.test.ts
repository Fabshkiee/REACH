import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "reach-agent-sandbox-"));
process.env.REACH_USER_ROOT = root;

import { assertAllowedPath, resolveWithin } from "./sandbox.js";

describe("agent sandbox", () => {
  it("confines resolveWithin to its root", () => {
    assert.throws(() => resolveWithin(root, "..\\Windows\\x.dll"), /escapes/);
    assert.ok(resolveWithin(root, "a\\b.txt").startsWith(root));
  });

  it("allows ordinary paths on any drive (no root cage)", () => {
    // The agent enforces DENY patterns; risk calls belong to core policy.
    // A second drive and a temp dir pass here by design.
    assert.ok(assertAllowedPath(join(root, "Documents", "a.docx")).startsWith(root));
    const otherDrive = process.platform === "win32" ? "O:\\Downloads\\notes.txt" : "/Volumes/Backup/notes.txt";
    assert.ok(assertAllowedPath(otherDrive).length > 0);
  });

  it("refuses system roots even with traversal spelling", () => {
    const sysRoot = process.platform === "win32" ? "C:\\Windows\\System32" : "/System/Library";
    assert.throws(() => assertAllowedPath(join(sysRoot, "x.dll")), /system location/);
    // Traversal landing inside a system root must judge by destination, not spelling.
    const realSystemRoot = process.env.SystemRoot;
    process.env.SystemRoot = join(root, "vault", "Windows");
    try {
      assert.throws(
        () => assertAllowedPath(join(root, "sub", "..", "vault", "Windows", "x.dll")),
        /system location/,
      );
    } finally {
      if (realSystemRoot === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = realSystemRoot;
    }
  });

  it("refuses secrets, siblings, and junk", () => {
    assert.throws(() => assertAllowedPath(join(root, ".ssh", "id_rsa")), /secret/);
    assert.throws(() => assertAllowedPath(join(root, ".env")), /secret/);
    assert.throws(() => assertAllowedPath(join(root, "k.pem")), /secret/);
    assert.throws(
      () => assertAllowedPath(join(root, "AppData", "Local", "Google", "Chrome", "User Data", "x")),
      /credential/,
    );
    assert.throws(() => assertAllowedPath(join(root, "..", "someone-else", "d.txt")), /another user/);
    assert.throws(() => assertAllowedPath(""), /invalid path/);
  });
});
