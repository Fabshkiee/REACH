process.env.NODE_ENV = "test";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("server /health and sim build stamps", () => {
  it("GET /health returns 200 with service, mcp, and buildStamp", async () => {
    process.env.NODE_ENV = "test";
    const { default: app, BUILD_STAMP } = await import("./index.js");
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { ok: boolean; service: string; mcp: string; buildStamp: string };
      assert.equal(body.ok, true);
      assert.equal(body.service, "reach-server");
      assert.equal(body.mcp, "streamable-http");
      assert.equal(body.buildStamp, BUILD_STAMP);
      assert.ok(typeof BUILD_STAMP === "string" && BUILD_STAMP.length > 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("sim.html renders build stamps and question count (N/3)", () => {
    const simPath = join(HERE, "..", "public", "sim.html");
    const html = readFileSync(simPath, "utf8");
    // Build stamp elements and client-side refresh logic
    assert.ok(html.includes('id="serverStamp"'), "sim.html must have #serverStamp");
    assert.ok(html.includes('id="agentStamp"'), "sim.html must have #agentStamp");
    assert.ok(html.includes("updateBuildStamps"), "sim.html must have updateBuildStamps function");
    assert.ok(html.includes("fetch('/health')"), "sim.html must fetch /health");
    assert.ok(html.includes("fetch('http://127.0.0.1:3001/health')"), "sim.html must fetch agent health");
    // Question card displays (N/3)
    assert.ok(html.includes('id="questionCount"'), "sim.html must have the question counter");
    assert.ok(html.includes(" of 3"), "sim.html must display the 3-question cap");
  });
});

