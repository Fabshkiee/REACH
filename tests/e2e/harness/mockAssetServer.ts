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
