process.env.NODE_ENV = "test";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

describe("windows-agent /health and build stamp", () => {
  it("GET /health returns 200 with service, agentId, buildStamp, and CORS header", async () => {
    process.env.NODE_ENV = "test";
    const { default: app, BUILD_STAMP } = await import("./index.js");
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("access-control-allow-origin"), "*");
      const body = (await res.json()) as { ok: boolean; service: string; agentId: string; buildStamp: string };
      assert.equal(body.ok, true);
      assert.equal(body.service, "windows-agent");
      assert.ok(typeof body.agentId === "string" && body.agentId.length > 0);
      assert.equal(body.buildStamp, BUILD_STAMP);
      assert.ok(typeof BUILD_STAMP === "string" && BUILD_STAMP.length > 0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

