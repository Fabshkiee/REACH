import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PLAYWRIGHT_MCP_VERSION, assertToolAllowed } from "./playwright.js";

describe("playwright consumer guardrails", () => {
  it("pins a known version", () => {
    assert.match(PLAYWRIGHT_MCP_VERSION, /^\d+\.\d+\.\d+$/);
  });

  it("installed dependency matches the pin (no npx drift)", () => {
    const req = createRequire(import.meta.url);
    const pkg = req("@playwright/mcp/package.json") as { version: string; license: string };
    assert.equal(pkg.version, PLAYWRIGHT_MCP_VERSION);
    assert.equal(pkg.license, "Apache-2.0");
  });

  it("allows exactly the planner-visible set", () => {
    for (const t of [
      "browser_navigate",
      "browser_snapshot",
      "browser_find",
      "browser_click",
      "browser_type",
      "browser_select_option",
      "browser_press_key",
      "browser_wait_for",
      "browser_tabs",
    ]) {
      assertToolAllowed(t);
    }
  });

  it("refuses dangerous and unknown tools before any subprocess exists", () => {
    for (const t of [
      "browser_evaluate",
      "browser_run_code_unsafe",
      "browser_route",
      "browser_unroute",
      "browser_cookie_get",
      "browser_get_config",
      "browser_file_upload",
      "browser_drop",
      "browser_handle_dialog",
      "browser_take_screenshot",
      "browser_network_requests",
      "browser_console_messages",
      "totally_made_up",
    ]) {
      assert.throws(() => assertToolAllowed(t), /not planner-visible|structurally banned/, t);
    }
  });
});
