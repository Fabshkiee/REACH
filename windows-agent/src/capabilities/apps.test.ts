import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { KNOWN_APPS, assertSafeUrl, launchApplication, openDocument, spotifyDeepLink } from "./apps.js";

describe("agent app primitives", () => {
  it("assertSafeUrl allows http/https, blocks the rest", () => {
    assert.ok(assertSafeUrl("https://canva.com/").startsWith("https://"));
    assert.ok(assertSafeUrl("http://example.com/x").startsWith("http://"));
    for (const bad of ["file:///C:/x", "javascript:alert(1)", "data:text/plain,hi", "not a url", "https://u:p@example.com/"]) {
      assert.throws(() => assertSafeUrl(bad), /refused|not a valid URL/, bad);
    }
  });

  it("spotifyDeepLink converts open.spotify.com links to spotify: URIs", () => {
    assert.equal(
      spotifyDeepLink("https://open.spotify.com/playlist/5zi2EfT0kSmszh3uhg6yKy"),
      "spotify:playlist:5zi2EfT0kSmszh3uhg6yKy",
    );
    assert.equal(
      spotifyDeepLink("https://open.spotify.com/track/abc123"),
      "spotify:track:abc123",
    );
    assert.equal(spotifyDeepLink("https://example.com/x"), null);
    assert.equal(spotifyDeepLink("not a url"), null);
  });

  it("known apps map is sane and advertised", () => {
    for (const name of ["calculator", "notepad", "paint"]) {
      assert.ok(KNOWN_APPS[name], name);
    }
  });

  it("launch attempts unknown apps and fails when not installed", async () => {
    await assert.rejects(launchApplication({ app: "totally-legit.exe" }), /launch failed|Unable to find application|unknown application/);
    await assert.rejects(launchApplication({ app: "..\\evil" }), /launch failed|Unable to find application|unknown application/);
  });

  it("openDocument refuses missing files before opening", async () => {
    await assert.rejects(openDocument({ path: "definitely\\not\\here-12345.txt" }), /ENOENT|no such/i);
  });

  it("openDocument opens directories in Windows File Explorer without rejection", async () => {
    const { homedir } = await import("node:os");
    const { mkdir } = await import("node:fs/promises");
    const testDir = join(homedir(), "Documents", "REACH", "test_explorer_open");
    await mkdir(testDir, { recursive: true });
    const res = await openDocument({ path: testDir });
    assert.equal(typeof res.opened, "boolean");
    assert.equal(res.path, testDir);
    assert.equal(res.isDirectory, true);
  });
});
