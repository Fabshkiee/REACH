import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getActionDef, listActionDefs } from "../executor/registry.js";
import { registerAgentActions, targetForAction, requireReportSource } from "./agent.js";

registerAgentActions();

describe("agent action defs", () => {
  it("registers the expected primitive set", () => {
    const names = listActionDefs().map((d) => d.name).sort();
    for (const n of [
      "files.search",
      "files.read",
      "files.write",
      "files.create_document",
      "files.move",
      "files.delete",
      "files.verify",
      "files.list",
      "apps.open_document",
      "apps.open_url",
      "apps.launch",
      "phone.ios_list",
      "phone.ios_info",
      "phone.ios_list_files",
      "phone.ios_pull_file",
      "phone.ios_screenshot",
      "phone.ios_apps",
      "phone.ios_paste",
      "phone.ios_copy",
      "phone.ios_launch",
      "phone.ios_button",
      "phone.ios_push_file",
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
    assert.equal(targetForAction("phone.ios_launch", { bundleId: "com.apple.mobilesafari" }), "com.apple.mobilesafari");
    assert.equal(targetForAction("phone.ios_button", { button: "lock" }), "phone-button:lock");
    assert.equal(targetForAction("phone.ios_push_file", { path: "report.pdf" }), "report.pdf");
    assert.equal(targetForAction("phone.ios_screenshot", {}), "Downloads/REACH");
    assert.equal(targetForAction("nope.missing", {}), undefined);
  });

  it("classifies iPhone control actions as consequential", () => {
    const classes = new Map(listActionDefs().map((d) => [d.name, d.actionClass]));
    assert.equal(classes.get("phone.ios_screenshot"), "download");
    assert.equal(classes.get("phone.ios_apps"), "search");
    assert.equal(classes.get("phone.ios_paste"), "read");
    assert.equal(classes.get("phone.ios_copy"), "interact");
    assert.equal(classes.get("phone.ios_launch"), "launch");
    assert.equal(classes.get("phone.ios_button"), "configure");
    assert.equal(classes.get("phone.ios_push_file"), "send");
  });

  it("phone tools accept the udid the agent selection needs", () => {
    const udid = "00008110-001A2B3C4D5E";
    const samples: Array<[string, Record<string, unknown>]> = [
      ["phone.ios_info", { udid }],
      ["phone.ios_list_files", { udid }],
      ["phone.ios_pull_file", { src: "/DCIM/IMG_0001.JPG", udid }],
      ["phone.ios_screenshot", { udid }],
      ["phone.ios_apps", { udid }],
      ["phone.ios_paste", { udid }],
      ["phone.ios_copy", { text: "hello", udid }],
      ["phone.ios_launch", { bundleId: "com.apple.mobilesafari", udid }],
      ["phone.ios_button", { button: "lock", udid }],
      ["phone.ios_push_file", { path: "report.pdf", udid }],
    ];
    for (const [name, args] of samples) {
      assert.ok(getActionDef(name)!.schema.safeParse(args).success, name);
    }
    assert.ok(getActionDef("phone.ios_list")!.schema.safeParse({}).success);
  });

  it("no def is an exec/shell/eval backdoor", () => {
    for (const d of listActionDefs()) {
      assert.ok(!/exec|shell|eval|run_command|runCode/i.test(d.name), d.name);
    }
  });

  it("requireReportSource demands a real URL, clean anchors, and valid CVE IDs", () => {
    assert.throws(
      () => requireReportSource({ title: "Weekly Update", documentType: "report", body: "# Summary\nNo sources." }),
      /full http\(s\) URL/,
    );
    assert.throws(
      () => requireReportSource({ title: "Weekly Update", documentType: "report", body: "# Sources\n[Link](https://example.com/a)" }),
      /publisher or source name/,
    );
    assert.throws(
      () => requireReportSource({ title: "Weekly Update", documentType: "report", body: "# Sources\n[CISA](https://cisa.gov)\nCVE-2026-57966a" }),
      /Malformed CVE ID/,
    );
    assert.doesNotThrow(() =>
      requireReportSource({ title: "Weekly Update", documentType: "report", body: "# Sources\n[CISA](https://www.cisa.gov/news)" }),
    );
    assert.doesNotThrow(() => requireReportSource({ title: "Standup Minutes", documentType: "meeting minutes", body: "# Notes" }));
  });
});
