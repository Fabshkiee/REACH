import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { downloadAsset, MAX_DOWNLOAD_BYTES, reachDownloadsDir } from "./downloadAsset.js";

describe("windows-agent download_asset capability", () => {
  let server: http.Server;
  let serverUrl: string;
  const createdFiles: string[] = [];

  const samplePng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (url.pathname === "/sample.png") {
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Content-Length": samplePng.length,
        });
        res.end(samplePng);
        return;
      }

      if (url.pathname === "/no-extension-jpeg") {
        res.writeHead(200, {
          "Content-Type": "image/jpeg",
          "Content-Length": 12,
        });
        res.end(Buffer.from("fake-jpeg-dat"));
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

      if (url.pathname === "/oversized-header.bin") {
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": 55 * 1024 * 1024,
        });
        res.end();
        return;
      }

      if (url.pathname === "/oversized-stream.bin") {
        // Chunked transfer without content-length exceeding 50MB
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Transfer-Encoding": "chunked",
        });
        const chunk = Buffer.alloc(1024 * 1024, "X"); // 1MB chunk
        let sentMb = 0;
        let closed = false;
        res.on("close", () => { closed = true; });
        res.on("error", () => { closed = true; });
        const sendNext = () => {
          if (closed || res.destroyed || res.writableEnded) return;
          while (sentMb < 52) {
            if (closed || res.destroyed || res.writableEnded) return;
            sentMb++;
            const ok = res.write(chunk);
            if (!ok) {
              res.once("drain", sendNext);
              return;
            }
          }
          if (!closed && !res.destroyed && !res.writableEnded) {
            res.end();
          }
        };
        sendNext();
        return;
      }

      if (url.pathname === "/exact-50mb.bin") {
        const total = MAX_DOWNLOAD_BYTES;
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": total,
        });
        const chunk = Buffer.alloc(1024 * 1024, "Z");
        let sent = 0;
        const sendNext = () => {
          while (sent < total) {
            const toSend = Math.min(chunk.length, total - sent);
            sent += toSend;
            const ok = res.write(chunk.subarray(0, toSend));
            if (!ok) {
              res.once("drain", sendNext);
              return;
            }
          }
          res.end();
        };
        sendNext();
        return;
      }

      if (url.pathname === "/malicious.exe") {
        res.writeHead(200, {
          "Content-Type": "application/x-msdownload",
          "Content-Length": 100,
        });
        res.end(Buffer.alloc(100, 0x90));
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    for (const f of createdFiles) {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch {
        // Cleanup best effort
      }
    }
    await new Promise<void>((done) => server.close(() => done()));
  });

  it("downloads an asset successfully and verifies disk state", async () => {
    const res = await downloadAsset({
      url: `${serverUrl}/sample.png`,
      destinationDir: "Downloads/REACH",
      filename: "test_unit_sample.png",
    });

    createdFiles.push(res.path);
    assert.equal(res.ok, true);
    assert.equal(res.verified, true);
    assert.equal(res.mimeType, "image/png");
    assert.equal(res.size, samplePng.length);
    assert.ok(existsSync(res.path));
  });

  it("auto-reconciles missing extension from MIME type", async () => {
    const res = await downloadAsset({
      url: `${serverUrl}/no-extension-jpeg`,
      destinationDir: "Downloads/REACH",
      filename: "test_no_ext",
    });

    createdFiles.push(res.path);
    assert.equal(res.ok, true);
    assert.ok(res.filename.endsWith(".jpg"));
    assert.ok(existsSync(res.path));
  });

  it("handles 0-byte file cleanly", async () => {
    const res = await downloadAsset({
      url: `${serverUrl}/empty.txt`,
      filename: "test_unit_empty.txt",
    });

    createdFiles.push(res.path);
    assert.equal(res.ok, true);
    assert.equal(res.size, 0);
    assert.equal(res.verified, true);
    assert.ok(existsSync(res.path));
  });

  it("enforces 50MB ceiling on pre-flight Content-Length", async () => {
    await assert.rejects(
      async () => {
        await downloadAsset({ url: `${serverUrl}/oversized-header.bin` });
      },
      /50MB|exceeds/i,
    );
  });

  it("enforces 50MB ceiling on chunked streaming body and cleans up file", async () => {
    let attemptedPath = "";
    await assert.rejects(
      async () => {
        const res = await downloadAsset({
          url: `${serverUrl}/oversized-stream.bin`,
          filename: "test_unit_oversized_stream.bin",
        });
        attemptedPath = res.path;
      },
      /50MB|exceeded/i,
    );

    const expectedPath = join(reachDownloadsDir(), "test_unit_oversized_stream.bin");
    assert.equal(existsSync(expectedPath), false, "Partial oversized file must be deleted on abort");
  });

  it("handles exactly 50MB file successfully", async () => {
    const res = await downloadAsset({
      url: `${serverUrl}/exact-50mb.bin`,
      filename: "test_unit_exact_50mb.bin",
    });

    createdFiles.push(res.path);
    assert.equal(res.ok, true);
    assert.equal(res.size, MAX_DOWNLOAD_BYTES);
    assert.equal(res.verified, true);
  });

  it("enforces allowedMimes restriction", async () => {
    await assert.rejects(
      async () => {
        await downloadAsset({
          url: `${serverUrl}/sample.png`,
          allowedMimes: ["image/jpeg"],
        });
      },
      /refused: MIME type "image\/png" is not allowed/i,
    );
  });

  it("blocks dangerous executable MIME type by default", async () => {
    await assert.rejects(
      async () => {
        await downloadAsset({ url: `${serverUrl}/malicious.exe` });
      },
      /refused: unsafe or blocked MIME type/i,
    );
  });

  it("blocks directory traversal in destinationDir escaping sandbox", async () => {
    // The escape must land in a REAL system root for this platform, so the
    // refusal proves the deny rule fired — not that a fake path was missing.
    const systemDir = process.platform === "win32" ? "../../../../Windows/System32" : "../../../../System/Library";
    await assert.rejects(
      async () => {
        await downloadAsset({
          url: `${serverUrl}/sample.png`,
          destinationDir: systemDir,
        });
      },
      /refused: (path escapes sandbox|allowed|system location)/i,
    );
  });
});
