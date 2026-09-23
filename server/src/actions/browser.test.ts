import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getActionDef } from "../executor/registry.js";
import { registerBrowserActions } from "./browser.js";

registerBrowserActions();

describe("browser action defs", () => {
  it("registers the planner-visible set with schemas and verifiers", () => {
    for (const n of [
      "browser.goto",
      "browser.observe",
      "browser.find",
      "browser.click",
      "browser.type",
      "browser.select",
      "browser.press_key",
      "browser.wait",
      "browser.fetch_download",
    ]) {
      const d = getActionDef(n);
      assert.ok(d, n);
      assert.equal(typeof d!.verify, "function", n);
      assert.ok(d!.timeoutMs > 0, n);
    }
  });

  it("schemas reject garbage without touching a browser", () => {
    const goto = getActionDef("browser.goto")!;
    assert.throws(() => goto.schema.parse({}), /url/);
    assert.throws(() => goto.schema.parse({ url: "" }), /url/);
    const click = getActionDef("browser.click")!;
    assert.throws(() => click.schema.parse({ target: "e1" }), /pageUrl/);
    const type = getActionDef("browser.type")!;
    assert.ok(type.schema.safeParse({ pageUrl: "https://x.io", target: "e1", text: "hi" }).success);
    assert.ok(type.schema.safeParse({ pageUrl: "https://x.io", target: "e1", text: "hi", submit: true }).success);
  });

  it("verifiers pass upstream error text through (diagnosable failures)", () => {
    const click = getActionDef("browser.click")!;
    assert.throws(
      () => click.verify!({ isError: true, content: [{ text: "upstream boom: ref e12 detached" }] }),
      /upstream boom: ref e12 detached/,
    );
    const observe = getActionDef("browser.observe")!;
    assert.throws(() => observe.verify!({ isError: true, content: [] }), /reported an error/);
    assert.throws(() => observe.verify!({ content: [{ text: "   " }] }), /empty content/);
    assert.equal(
      observe.verify!({ content: [{ text: "page ok" }] }),
      "page ok",
    );
  });

  it("no def maps to a banned upstream tool", () => {
    // Structural complement to the whitelist test: even if registration is
    // refactored, banned capabilities can never be wired to the planner.
    // Comments are stripped first — naming a ban in prose is documentation,
    // wiring it would be a defect.
    const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "browser.ts"), "utf8");
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.split("//")[0])
      .join("\n");
    for (const banned of ["browser_evaluate", "run_code", "browser_route", "file_upload", "/drop", "handle_dialog", "cookie"]) {
      assert.ok(!src.includes(banned), banned);
    }
  });
});
