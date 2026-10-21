/**
 * Local Mock Asset HTTP Server for Deterministic E2E Testing
 * Provides known endpoints for web.download_asset testing without external network flakiness.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface MockAssetServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/**
 * Redirect every DuckDuckGo request to the local mock so web.search is
 * deterministic. Returns a restore function. Any other host passes through
 * untouched, so tests that genuinely need the network still reach it.
 */
export function installSearchMock(mockUrl: string): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (raw.includes("duckduckgo.com")) {
      const u = new URL(raw);
      const mapped = `${mockUrl}${u.pathname}${u.search}`;
      return original(mapped, init);
    }
    return original(input, init);
  };
  return () => {
    globalThis.fetch = original;
  };
}

// 1x1 transparent PNG buffer
export const SAMPLE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

// 1x1 red JPEG buffer
export const SAMPLE_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

// Minimal valid PDF buffer
export const SAMPLE_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 100 100]>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n150\n%%EOF\n",
  "utf8",
);

/** DuckDuckGo-shaped HTML search results (the shape web.search parses). */
const SEARCH_RESULTS_HTML = `<!DOCTYPE html>
<html><body>
  <div class="result results_links results_links_deep web-result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fen%2Fdocs&rut=1">Node.js &amp; Documentation</a>
    <a class="result__snippet">Official &quot;Node.js&quot; runtime docs and API references.</a>
  </div>
  <div class="result results_links results_links_deep web-result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fnodejs%2Fnode&rut=1">Node.js GitHub Repository</a>
    <a class="result__snippet">Open source JavaScript runtime built on Chrome V8.</a>
  </div>
  <div class="result results_links results_links_deep web-result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2F&rut=1">Node.js Home</a>
    <a class="result__snippet">Run JavaScript on the server.</a>
  </div>
</body></html>`;

/** DuckDuckGo Lite shape (the fallback endpoint). */
const LITE_RESULTS_HTML = `<!DOCTYPE html>
<html><body>
  <a class="result-link" href="https://nodejs.org/en/docs">Node.js &amp; Documentation</a>
  <td class="result-snippet">Official &quot;Node.js&quot; runtime docs and API references.</td>
  <a class="result-link" href="https://github.com/nodejs/node">Node.js GitHub Repository</a>
  <td class="result-snippet">Open source JavaScript runtime built on Chrome V8.</td>
</body></html>`;

/** The image-search init page — carries the VQD token. */
const VQD_HTML = `<!DOCTYPE html>
<html><head><script>vqd='4-1234567890123456';</script></head><body>DuckDuckGo Images</body></html>`;

/** The image-search JSON payload. */
const SEARCH_IMAGES_JSON = JSON.stringify({
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

export async function startMockAssetServer(): Promise<MockAssetServer> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/sample.png") {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": SAMPLE_PNG.length,
      });
      res.end(SAMPLE_PNG);
      return;
    }

    if (url.pathname === "/sample.jpg" || url.pathname === "/photo.jpeg") {
      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Length": SAMPLE_JPEG.length,
      });
      res.end(SAMPLE_JPEG);
      return;
    }

    if (url.pathname === "/report.pdf") {
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": SAMPLE_PDF.length,
      });
      res.end(SAMPLE_PDF);
      return;
    }

    if (url.pathname === "/malicious.exe") {
      res.writeHead(200, {
        "Content-Type": "application/x-msdownload",
        "Content-Length": 1024,
      });
      res.end(Buffer.alloc(1024, 0x90)); // NOP sled
      return;
    }

    if (url.pathname === "/oversized.bin") {
      // Stream 55 MB (> 50MB ceiling)
      const totalBytes = 55 * 1024 * 1024;
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": totalBytes,
      });
      const chunkSize = 64 * 1024;
      const chunk = Buffer.alloc(chunkSize, "A");
      let sent = 0;
      const pump = () => {
        while (sent < totalBytes) {
          const toSend = Math.min(chunkSize, totalBytes - sent);
          sent += toSend;
          const ok = res.write(chunk.subarray(0, toSend));
          if (!ok) {
            res.once("drain", pump);
            return;
          }
        }
        res.end();
      };
      pump();
      return;
    }

    if (url.pathname === "/exact50mb.dat") {
      // Exactly 50MB (52,428,800 bytes)
      const totalBytes = 50 * 1024 * 1024;
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": totalBytes,
      });
      const chunkSize = 64 * 1024;
      const chunk = Buffer.alloc(chunkSize, "B");
      let sent = 0;
      const pump = () => {
        while (sent < totalBytes) {
          const toSend = Math.min(chunkSize, totalBytes - sent);
          sent += toSend;
          const ok = res.write(chunk.subarray(0, toSend));
          if (!ok) {
            res.once("drain", pump);
            return;
          }
        }
        res.end();
      };
      pump();
      return;
    }

    if (url.pathname === "/empty.txt") {
      res.writeHead(200, {
        "Content-Type": "text/plain",
        "Content-Length": 0,
      });
      res.end();
      return;
    }

    // --- Search endpoints -------------------------------------------------
    // DuckDuckGo-shaped fixtures so web.search can be exercised offline.
    // The live engine rate-limits automated traffic, which made these
    // assertions flaky and the suite's result depend on the hour of the day.
    if (url.pathname === "/html/" || url.pathname === "/lite/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(url.pathname === "/lite/" ? LITE_RESULTS_HTML : SEARCH_RESULTS_HTML);
      return;
    }

    if (url.pathname === "/i.js") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(SEARCH_IMAGES_JSON);
      return;
    }

    if (url.searchParams.get("iax") === "images") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(VQD_HTML);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
