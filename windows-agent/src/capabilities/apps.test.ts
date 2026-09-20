import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { KNOWN_APPS, assertSafeUrl, launchApplication, openDocument } from "./apps.js";

describe("agent app primitives", () => {
  it("assertSafeUrl allows http/https, blocks the rest", () => {
    assert.ok(assertSafeUrl("https://canva.com/").startsWith("https://"));
    assert.ok(assertSafeUrl("http://example.com/x").startsWith("http://"));
    for (const bad of ["file:///C:/x", "javascript:alert(1)", "data:text/plain,hi", "not a url", "https://u:p@example.com/"]) {
      assert.throws(() => assertSafeUrl(bad), /refused|not a valid URL/, bad);
    }
  });

  it("known apps map is sane and advertised", () => {
    for (const name of ["calculator", "notepad", "paint"]) {
      assert.ok(KNOWN_APPS[name], name);
    }
  });

  it("launch rejects unknown apps without spawning anything", async () => {
    await assert.rejects(launchApplication({ app: "totally-legit.exe" }), /unknown application/);
    await assert.rejects(launchApplication({ app: "..\\evil" }), /unknown application/);
  });

  it("openDocument refuses missing files before opening", async () => {
    await assert.rejects(openDocument({ path: "definitely\\not\\here-12345.txt" }), /ENOENT|no such/i);
  });
});
