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

  it("hides iOS capabilities unless this is a Mac with pymobiledevice3", () => {
    const iosCaps = [
      "ios_list",
      "ios_info",
      "ios_list_files",
      "ios_pull_file",
      "ios_screenshot",
      "ios_apps",
      "ios_paste",
      "ios_copy",
      "ios_launch",
      "ios_button",
      "ios_push_file",
    ];
    const macWithTool = advertisedCapabilities({ platform: "darwin", hasTool: () => true });
    for (const cap of iosCaps) assert.ok(macWithTool.includes(cap as never), cap);

    const macWithoutTool = advertisedCapabilities({ platform: "darwin", hasTool: () => false });
    for (const cap of iosCaps) assert.ok(!macWithoutTool.includes(cap as never), cap);

    const linuxWithTool = advertisedCapabilities({ platform: "linux", hasTool: () => true });
    for (const cap of iosCaps) assert.ok(!linuxWithTool.includes(cap as never), cap);
  });

  it("advertises only what this host can actually run", () => {
    const advertised = advertisedCapabilities();
    const windowsOnly = ["inspect_windows", "focus_window", "type_text", "send_hotkey"];
    for (const cap of windowsOnly) {
      if (process.platform === "win32") {
        assert.ok(advertised.includes(cap as never), cap);
      } else {
        // Advertising a Windows-only primitive here would make the planner
        // reason about a capability this machine cannot execute.
        assert.ok(!advertised.includes(cap as never), cap);
      }
    }
    // The laptop clipboard is implemented for PowerShell and pbpaste/pbcopy.
    for (const cap of ["set_clipboard", "get_clipboard"]) {
      if (process.platform === "win32" || process.platform === "darwin") {
        assert.ok(advertised.includes(cap as never), cap);
      } else {
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
