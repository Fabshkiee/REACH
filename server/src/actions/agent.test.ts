import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getActionDef, listActionDefs } from "../executor/registry.js";
import { registerAgentActions, targetForAction } from "./agent.js";

registerAgentActions();

describe("agent action defs", () => {
  it("registers the expected primitive set", () => {
    const names = listActionDefs().map((d) => d.name).sort();
    for (const n of [
      "files.search",
      "files.read",
      "files.write",
      "files.move",
      "files.verify",
      "apps.open_document",
      "apps.open_url",
      "apps.launch",
    ]) {
      assert.ok(names.includes(n), n);
    }
  });

  it("every def has schema, timeout, verify, and handler", () => {
    for (const d of listActionDefs()) {
      assert.ok(d.schema, d.name);
      assert.ok(d.timeoutMs > 0, d.name);
      assert.equal(typeof d.verify, "function", d.name);
      assert.equal(typeof d.handler, "function", d.name);
    }
  });

  it("schemas reject garbage without touching the network", () => {
    const read = getActionDef("files.read")!;
    assert.throws(() => read.schema.parse({}), /path/);
    assert.throws(() => read.schema.parse({ path: "" }), /path/);
    const write = getActionDef("files.write")!;
    assert.throws(() => write.schema.parse({ path: "a.txt" }), /content/);
    const move = getActionDef("files.move")!;
    assert.throws(() => move.schema.parse({ from: "a" }), /to/);
    const launch = getActionDef("apps.launch")!;
    assert.throws(() => launch.schema.parse({ app: "" }), /app/);
    const search = getActionDef("files.search")!;
    assert.throws(() => search.schema.parse({ query: "" }), /query/);
    // Valid shapes pass (handlers would call the network — not invoked here).
    assert.ok(search.schema.safeParse({ query: "invoice" }).success);
  });

  it("verify demands agent ok:true", () => {
    const read = getActionDef("files.read")!;
    assert.equal(read.verify!({ ok: true }), "read_file ok");
    assert.throws(() => read.verify!({ ok: false, error: "nope" }), /nope/);
    assert.throws(() => read.verify!({}), /did not report ok/);
  });

  it("targetForAction extracts policy targets", () => {
    assert.equal(targetForAction("files.read", { path: "a.txt" }), "a.txt");
    assert.equal(targetForAction("files.move", { from: "a", to: "b.txt" }), "b.txt");
    assert.equal(targetForAction("apps.open_url", { url: "https://x.io" }), "https://x.io");
    assert.equal(targetForAction("apps.launch", { app: "calculator" }), "calculator");
    assert.equal(targetForAction("nope.missing", {}), undefined);
  });

  it("no def is an exec/shell/eval backdoor", () => {
    for (const d of listActionDefs()) {
      assert.ok(!/exec|shell|eval|run_command|runCode/i.test(d.name), d.name);
    }
  });
});
