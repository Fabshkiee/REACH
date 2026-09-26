import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { getActionDef, listActionDefs } from "../executor/registry.js";
import { registerWebActions, WebSearchSchema, webSearch, search } from "./web.js";

// Ensure actions are registered
registerWebActions();

describe("web actions and web.search primitive", () => {
  it("registers web.search and web.download_asset in registry", () => {
    const searchDef = getActionDef("web.search");
    assert.ok(searchDef, "web.search must be defined");
    assert.equal(searchDef.actionClass, "search");
    assert.equal(typeof searchDef.verify, "function");
    assert.equal(typeof searchDef.handler, "function");

    const dlDef = getActionDef("web.download_asset");
    assert.ok(dlDef, "web.download_asset must be defined");
    assert.equal(dlDef.actionClass, "download");
    assert.equal(typeof dlDef.verify, "function");
    assert.equal(typeof dlDef.handler, "function");
  });

  it("web.search verify checks for ok and results count", () => {
    const searchDef = getActionDef("web.search")!;
    const msg = searchDef.verify!({
      ok: true,
      query: "cats",
      mode: "text",
      count: 2,
      results: [{ title: "Cat 1" }, { title: "Cat 2" }],
    });
    assert.match(String(msg), /web\.search ok: found 2 text results for "cats"/);

    assert.throws(() => searchDef.verify!({ ok: false }), /valid result object/);
    assert.throws(() => searchDef.verify!(null), /valid result object/);
  });

  it("web.download_asset verify checks for ok and reports path and size", () => {
    const dlDef = getActionDef("web.download_asset")!;
    const msg = dlDef.verify!({
      ok: true,
      path: "C:\\Downloads\\REACH\\photo.jpg",
      size: 45000,
      verified: true,
    });
    assert.match(String(msg), /download_asset ok: saved to C:\\Downloads\\REACH\\photo\.jpg \(45000 bytes, verified\)/);

    assert.throws(() => dlDef.verify!({ ok: false, error: "bad url" }), /bad url/);
    assert.throws(() => dlDef.verify!({}), /did not report ok/);
  });

  it("schema enforces query boundaries and default limits", () => {
    // Valid defaults
    const parsed = WebSearchSchema.parse({ query: "hello world" });
    assert.equal(parsed.query, "hello world");
    assert.equal(parsed.mode, "text");
    assert.equal(parsed.limit, 5);

    // Empty query rejected
    assert.throws(() => WebSearchSchema.parse({ query: "" }));

    // 500 characters accepted
    const maxQuery = "a".repeat(500);
    assert.equal(WebSearchSchema.parse({ query: maxQuery }).query, maxQuery);

    // 501 characters rejected
    assert.throws(() => WebSearchSchema.parse({ query: "a".repeat(501) }));

    // Limit boundaries (1-20)
    assert.equal(WebSearchSchema.parse({ query: "test", limit: 1 }).limit, 1);
    assert.equal(WebSearchSchema.parse({ query: "test", limit: 20 }).limit, 20);
    assert.throws(() => WebSearchSchema.parse({ query: "test", limit: 0 }));
    assert.throws(() => WebSearchSchema.parse({ query: "test", limit: 21 }));
  });

  it("targetOf extracts correct policy targets", () => {
    const searchDef = getActionDef("web.search")!;
    assert.equal(searchDef.targetOf?.({ query: "TypeScript docs" }), "TypeScript docs");

    const dlDef = getActionDef("web.download_asset")!;
    assert.equal(dlDef.targetOf?.({ destinationDir: "Documents/REACH" }), "Documents/REACH");
    assert.equal(dlDef.targetOf?.({}), "Downloads/REACH");
  });

  it("exports webSearch and search alias", () => {
    assert.equal(typeof webSearch, "function");
    assert.equal(typeof search, "function");
    assert.equal(webSearch, search);
  });
});

describe("web.search with mock HTTP server (offline fixtures)", () => {
  let mockServer: http.Server;
  let mockUrl: string;
  const originalFetch = globalThis.fetch;

  const mockTextHtml = `
    <!DOCTYPE html>
    <html>
    <body>
      <div class="result results_links results_links_deep web-result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fen%2Fdocs&rut=1">
          Node.js &amp; Documentation
        </a>
        <a class="result__snippet">
          Official &quot;Node.js&quot; runtime docs and API references.
        </a>
      </div>
      <div class="result results_links results_links_deep web-result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fnodejs%2Fnode&rut=1">
          Node.js GitHub Repository
        </a>
        <a class="result__snippet">
          Open source JavaScript runtime built on Chrome V8.
        </a>
      </div>
    </body>
    </html>
  `;

  const mockVqdHtml = `
    <!DOCTYPE html>
    <html>
      <head><script>vqd='4-1234567890123456';</script></head>
      <body>DuckDuckGo Images</body>
    </html>
  `;

  const mockImageJson = JSON.stringify({
    results: [
      {
        title: "James Webb Telescope &amp; Deep Field",
        image: "https://images.nasa.gov/jwst_deep_field.jpg",
        url: "https://nasa.gov/mission_pages/webb",
        thumbnail: "https://images.nasa.gov/jwst_thumb.jpg",
      },
      {
        title: "Hubble Space Telescope",
        image: "https://images.nasa.gov/hubble.png",
        url: "https://nasa.gov/mission_pages/hubble",
      },
    ],
  });

  before(async () => {
    mockServer = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");

      if (u.pathname === "/html/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(mockTextHtml);
        return;
      }

      if (u.searchParams.get("iax") === "images") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(mockVqdHtml);
        return;
      }

      if (u.pathname === "/i.js") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(mockImageJson);
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, "127.0.0.1", () => {
        const addr = mockServer.address() as AddressInfo;
        mockUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // Intercept external DuckDuckGo fetch calls with local mock server
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (urlStr.includes("duckduckgo.com")) {
        const u = new URL(urlStr);
        const mappedUrl = `${mockUrl}${u.pathname}${u.search}`;
        return originalFetch(mappedUrl, init);
      }
      return originalFetch(input, init);
    };
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise<void>((done) => mockServer.close(() => done()));
  });

  it("parses text search HTML and unescapes entities & decodes uddg URLs", async () => {
    const res = await webSearch({ query: "Node.js docs", mode: "text", limit: 2 });
    assert.equal(res.ok, true);
    assert.equal(res.mode, "text");
    assert.equal(res.count, 2);
    assert.equal(res.results.length, 2);

    const first = res.results[0] as { title: string; url: string; snippet: string };
    assert.equal(first.title, "Node.js & Documentation");
    assert.equal(first.url, "https://nodejs.org/en/docs");
    assert.equal(first.snippet, 'Official "Node.js" runtime docs and API references.');

    const second = res.results[1] as { title: string; url: string; snippet: string };
    assert.equal(second.title, "Node.js GitHub Repository");
    assert.equal(second.url, "https://github.com/nodejs/node");
  });

  it("parses image search through VQD token and i.js JSON payload", async () => {
    const res = await webSearch({ query: "telescope photos", mode: "image", limit: 2 });
    assert.equal(res.ok, true);
    assert.equal(res.mode, "image");
    assert.equal(res.count, 2);
    assert.equal(res.results.length, 2);

    const first = res.results[0] as { title: string; imageUrl: string; sourceUrl: string; thumbnail?: string };
    assert.equal(first.title, "James Webb Telescope & Deep Field");
    assert.equal(first.imageUrl, "https://images.nasa.gov/jwst_deep_field.jpg");
    assert.equal(first.sourceUrl, "https://nasa.gov/mission_pages/webb");
    assert.equal(first.thumbnail, "https://images.nasa.gov/jwst_thumb.jpg");

    const second = res.results[1] as { title: string; imageUrl: string; sourceUrl: string };
    assert.equal(second.title, "Hubble Space Telescope");
    assert.equal(second.imageUrl, "https://images.nasa.gov/hubble.png");
  });

  it("respects limit parameter in mock text mode", async () => {
    const res = await webSearch({ query: "Node.js docs", mode: "text", limit: 1 });
    assert.equal(res.results.length, 1);
  });
});
