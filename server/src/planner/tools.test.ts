import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { z } from "zod";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.REACH_DATA_DIR = mkdtempSync(join(tmpdir(), "reach-tools-"));

import { clearActionRegistry, defineAction } from "../executor/registry.js";
import { registerDevice } from "../registry/deviceStore.js";
import { toolsForPlanner } from "./tools.js";

describe("planner tool set", () => {
  beforeEach(() => {
    clearActionRegistry();
  });

  it("hides device-backed actions the connected device does not advertise", () => {
    defineAction({
      name: "files.read",
      actionClass: "read",
      description: "read a file",
      schema: z.object({}),
      timeoutMs: 1000,
      deviceCapability: "read_file",
      verify: () => "read",
      handler: async () => ({}),
    });
    defineAction({
      name: "desktop.focus_window",
      actionClass: "interact",
      description: "focus a window",
      schema: z.object({}),
      timeoutMs: 1000,
      deviceCapability: "focus_window",
      verify: () => "focused",
      handler: async () => ({}),
    });
    defineAction({
      name: "browser.navigate",
      actionClass: "interact",
      description: "navigate",
      schema: z.object({}),
      timeoutMs: 1000,
      verify: () => "navigated",
      handler: async () => ({}),
    });

    // A macOS laptop advertises the file primitives, not the Windows desktop
    // primitives. The planner must not be offered focus_window.
    registerDevice({
      id: "tool-test-laptop",
      name: "Tool Test Laptop",
      capabilities: ["read_file"],
    });

    const names = toolsForPlanner().map((t) => t.name);
    assert.ok(names.includes("files.read"), "advertised capability is offered");
    assert.ok(!names.includes("desktop.focus_window"), "unadvertised capability is hidden");
    assert.ok(names.includes("browser.navigate"), "core-side actions are always offered");
  });

  it("offers everything when no device has registered yet", () => {
    defineAction({
      name: "files.read",
      actionClass: "read",
      description: "read a file",
      schema: z.object({}),
      timeoutMs: 1000,
      deviceCapability: "read_file",
      verify: () => "read",
      handler: async () => ({}),
    });
    // The core has no map of the machine yet — it hides nothing and lets the
    // executor fail closed on dispatch.
    const names = toolsForPlanner().map((t) => t.name);
    assert.ok(names.includes("files.read"));
  });
});
