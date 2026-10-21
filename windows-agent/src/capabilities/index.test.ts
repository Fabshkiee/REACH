import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_CAPABILITIES, advertisedCapabilities, isAllowed } from "./index.js";

describe("agent capability advertisement", () => {
  it("the allowlist is the security boundary and stays complete", () => {
    // Advertising is filtered; the ALLOWLIST is not. Every capability the
    // agent may ever be asked to run stays dispatchable.
    assert.ok(isAllowed("inspect_windows"));
    assert.ok(isAllowed("read_file"));
    assert.ok(!isAllowed("run_command"));
  });

  it("advertises only what this host can actually run", () => {
    const advertised = advertisedCapabilities();
    const windowsOnly = ["inspect_windows", "focus_window", "type_text", "send_hotkey", "set_clipboard", "get_clipboard"];
    for (const cap of windowsOnly) {
      if (process.platform === "win32") {
        assert.ok(advertised.includes(cap as never), cap);
      } else {
        // Advertising a Windows-only primitive here would make the planner
        // reason about a capability this machine cannot execute.
        assert.ok(!advertised.includes(cap as never), cap);
      }
    }
    // The file primitives are cross-platform and always advertised.
    for (const cap of ["read_file", "write_file", "search_files", "create_document"]) {
      assert.ok(advertised.includes(cap as never), cap);
    }
    assert.ok(advertised.length <= ALLOWED_CAPABILITIES.length);
  });
});
