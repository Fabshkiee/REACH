import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { classify, defaultPolicyContext, isWithinRoot } from "./engine.js";
import type { PolicyContext, ProposedAction } from "./types.js";

function action(partial: Partial<ProposedAction> & { actionClass: ProposedAction["actionClass"] }): ProposedAction {
  return { id: "act_test", name: "test.probe", args: {}, timeoutMs: 1000, ...partial };
}

const ctx: PolicyContext = { ...defaultPolicyContext(), knownApps: ["calculator"] };
const home = (p: string) => join(ctx.userRoot, p);

describe("policy engine", () => {
  it("allows reads inside user space", () => {
    const d = classify(action({ actionClass: "read", target: home("Documents\\notes.txt") }), ctx);
    assert.equal(d.verdict, "allow");
  });

  it("denies system locations even with traversal spelling", () => {
    for (const t of ["C:\\Windows\\System32\\x.dll", "..\\..\\Windows\\System32\\x.dll", "C:\\Program Files\\app\\x.exe"]) {
      const d = classify(action({ actionClass: "read", target: t }), ctx);
      assert.equal(d.verdict, "deny", t);
      assert.match(d.reason, /deny\./);
    }
  });

  it("denies another user's data", () => {
    const other = join(ctx.userRoot, "..", "someone-else", "doc.txt");
    const d = classify(action({ actionClass: "read", target: other }), ctx);
    assert.equal(d.verdict, "deny");
  });

  it("denies secret locations", () => {
    const cases = [
      home(".ssh\\id_rsa"),
      home("keys\\backup.pem"),
      home(".env"),
      "C:\\Users\\x\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data",
      home("AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\a.default\\logins.json"),
    ];
    for (const t of cases) {
      const d = classify(action({ actionClass: "read", target: t }), ctx);
      assert.equal(d.verdict, "deny", t);
    }
  });

  it("confirms writes outside user space, allows inside", () => {
    assert.equal(classify(action({ actionClass: "write", target: home("a.txt") }), ctx).verdict, "allow");
    const d = classify(action({ actionClass: "write", target: "D:\\shared\\a.txt" }), ctx);
    assert.equal(d.verdict, "confirm");
  });

  it("confirms on unclear intent and missing targets", () => {
    assert.equal(classify(action({ actionClass: "write", target: home("a.txt"), clarity: 0.1 }), ctx).verdict, "confirm");
    assert.equal(classify(action({ actionClass: "move" }), ctx).verdict, "confirm");
  });

  it("always confirms consequential classes", () => {
    for (const c of ["delete", "send", "publish", "purchase", "configure"] as const) {
      const d = classify(action({ actionClass: c, target: home("a.txt") }), ctx);
      assert.equal(d.verdict, "confirm", c);
    }
  });

  it("launch: known-safe allows, unknown confirms", () => {
    assert.equal(classify(action({ actionClass: "launch", target: "calculator" }), ctx).verdict, "allow");
    assert.equal(classify(action({ actionClass: "launch", target: "Calculator" }), ctx).verdict, "allow");
    assert.equal(classify(action({ actionClass: "launch", target: home("Downloads\\totally-legit.exe") }), ctx).verdict, "confirm");
  });

  it("interact with submit:true confirms", () => {
    const d = classify(
      action({ actionClass: "interact", target: "https://example.com/form", args: { submit: true } }),
      ctx,
    );
    assert.equal(d.verdict, "confirm");
    assert.match(d.reason, /submit/);
  });

  it("ask is always allowed", () => {
    assert.equal(classify(action({ actionClass: "ask", name: "reach.ask", args: {} }), ctx).verdict, "allow");
  });

  it("isWithinRoot blocks escapes", () => {
    assert.equal(isWithinRoot(ctx.userRoot, "..\\Windows\\x"), false);
    assert.equal(isWithinRoot(ctx.userRoot, home("a\\b.txt")), true);
  });

  it("drive-letter paths are local, not URIs", () => {
    // homedir() is drive-lettered on Windows — must judge as path (allow),
    // not as a URI scheme (would confirm/deny wrongly).
    const p = home("doc.txt");
    assert.match(p, /^[a-zA-Z]:[\\/]/);
    assert.equal(classify(action({ actionClass: "read", target: p }), ctx).verdict, "allow");
  });

  it("named web targets allow; odd URLs confirm; unsafe schemes deny", () => {
    const ok = classify(
      action({ actionClass: "interact", target: "https://canva.com/designs", args: {} }),
      ctx,
    );
    assert.equal(ok.verdict, "allow");
    assert.match(ok.reason, /named-web/);
    for (const unusual of [
      "http://192.168.1.10:8080/x",
      "https://user:pass@example.com/",
      "http://localhost:8931/mcp",
      "http://localhost:3000/health",
    ]) {
      const d = classify(action({ actionClass: "interact", target: unusual, args: {} }), ctx);
      assert.equal(d.verdict, "confirm", unusual);
    }
    for (const bad of ["file:///C:/x", "javascript:alert(1)", "data:text/plain,hi"]) {
      const d = classify(action({ actionClass: "interact", target: bad, args: {} }), ctx);
      assert.equal(d.verdict, "deny", bad);
    }
  });

  it("desktop interactions: observe/read allow, interact allows, submit:true confirms", () => {
    assert.equal(
      classify(action({ actionClass: "observe", name: "desktop.inspect_windows", target: "windows" }), ctx).verdict,
      "allow",
    );
    assert.equal(
      classify(action({ actionClass: "read", name: "desktop.get_clipboard", target: "clipboard" }), ctx).verdict,
      "allow",
    );
    assert.equal(
      classify(action({ actionClass: "interact", name: "desktop.focus_window", target: "Discord" }), ctx).verdict,
      "allow",
    );
    assert.equal(
      classify(action({ actionClass: "interact", name: "desktop.type_text", target: "active_window", args: { submit: false } }), ctx).verdict,
      "allow",
    );
    assert.equal(
      classify(action({ actionClass: "interact", name: "desktop.type_text", target: "active_window", args: { submit: true } }), ctx).verdict,
      "confirm",
    );
    assert.equal(
      classify(action({ actionClass: "interact", name: "desktop.send_hotkey", target: "active_window", args: { keys: ["ctrl", "k"] } }), ctx).verdict,
      "allow",
    );
  });

  it("web.request: GET on named web allows, POST/PUT confirms", () => {
    assert.equal(
      classify(action({ actionClass: "interact", name: "web.request", target: "https://api.github.com/repos", args: { method: "GET" } }), ctx).verdict,
      "allow",
    );
    assert.equal(
      classify(action({ actionClass: "interact", name: "web.request", target: "https://discord.com/api/webhooks/123", args: { method: "POST" } }), ctx).verdict,
      "confirm",
    );
  });
});
