import { createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { assertAllowedPath } from "../sandbox.js";

export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50MB ceiling (52,428,800 bytes)

export const DownloadAssetSchema = z.object({
  url: z.string().url().max(2000).describe("HTTP(S) URL of the asset to download"),
  destinationDir: z.string().min(1).max(500).optional().default("Downloads/REACH")
    .describe("Folder to store downloaded asset. Defaults to Downloads/REACH"),
  filename: z.string().min(1).max(200).optional()
    .describe("Optional target filename. If omitted, derived from URL/headers and sanitized"),
  allowedMimes: z.array(z.string().min(1)).optional()
    .describe("Optional restrict list of allowed MIME types (e.g. ['image/jpeg', 'image/png'])"),
});

export type DownloadAssetInput = z.input<typeof DownloadAssetSchema>;

export interface DownloadAssetResult {
  ok: true;
  path: string;
  filename: string;
  size: number;
  mimeType: string;
  verified: true;
}

export function reachDownloadsDir(): string {
  return join(homedir(), "Downloads", "REACH");
}

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
};

const BLOCKED_MIMES = new Set([
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-dosexec",
  "application/x-executable",
  "application/javascript",
  "text/javascript",
  "application/x-bat",
  "application/x-sh",
  "application/x-csh",
]);

const BLOCKED_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".sh",
  ".dll",
  ".com",
  ".scr",
  ".msi",
]);

function sanitizeFilename(raw: string): string {
  return raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

function resolveDestinationDir(destinationDir: string): string {
  const norm = destinationDir.replace(/\\/g, "/").trim();
  if (norm === "Downloads/REACH") return reachDownloadsDir();
  if (norm === "Documents/REACH") return join(homedir(), "Documents", "REACH");
  if (isAbsolute(destinationDir)) return destinationDir;
  return join(homedir(), destinationDir);
}

export async function downloadAsset(input: DownloadAssetInput): Promise<DownloadAssetResult> {
  const parsed = DownloadAssetSchema.parse(input);

  // 1. Resolve and validate target directory
  const resolvedDir = resolveDestinationDir(parsed.destinationDir);
  assertAllowedPath(resolvedDir);
  await mkdir(resolvedDir, { recursive: true });

  // 2. Fetch remote asset
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  let res: Response;
  try {
    res = await fetch(parsed.url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "REACH/0.1.0 (Windows; TaskExecutionArchitecture)" },
    });
  } catch (err) {
    if (ctrl.signal.aborted) throw new Error("downloadAsset timed out after 60s");
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading asset from ${parsed.url}`);
  }

  // 3. Pre-flight Content-Length check (50MB ceiling)
  const contentLengthHeader = res.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const cl = Number(contentLengthHeader);
    if (!Number.isNaN(cl) && cl > MAX_DOWNLOAD_BYTES) {
      throw new Error(`Asset Content-Length (${cl} bytes) exceeds 50MB ceiling limit (${MAX_DOWNLOAD_BYTES} bytes)`);
    }
  }

  // 4. Extract and validate MIME type
  const rawContentType = res.headers.get("content-type") ?? "application/octet-stream";
  const mimeType = rawContentType.split(";")[0]!.trim().toLowerCase();

  if (parsed.allowedMimes && parsed.allowedMimes.length > 0) {
    const allowed = parsed.allowedMimes.map((m) => m.toLowerCase());
    if (!allowed.includes(mimeType)) {
      throw new Error(`refused: MIME type "${mimeType}" is not allowed (allowed: ${allowed.join(", ")})`);
    }
  } else if (BLOCKED_MIMES.has(mimeType)) {
    throw new Error(`refused: unsafe or blocked MIME type "${mimeType}"`);
  }

  // 5. Determine and sanitize filename
  let filename = parsed.filename ? sanitizeFilename(parsed.filename) : "";
  if (!filename) {
    try {
      const parsedUrl = new URL(parsed.url);
      const urlBase = basename(parsedUrl.pathname);
      if (urlBase && urlBase !== "/" && urlBase.includes(".")) {
        filename = sanitizeFilename(urlBase);
      }
    } catch {
      // Ignore URL parse error
    }
  }
  if (!filename) {
    const ext = MIME_TO_EXT[mimeType] ?? ".dat";
    filename = `asset_${Date.now()}${ext}`;
  }

  // If filename has no extension, append based on MIME type if known
  const currentExt = extname(filename).toLowerCase();
  if (!currentExt && MIME_TO_EXT[mimeType]) {
    filename += MIME_TO_EXT[mimeType];
  }

  const finalExt = extname(filename).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(finalExt)) {
    throw new Error(`refused: unsafe file extension "${finalExt}" is blocked`);
  }

  const targetPath = assertAllowedPath(join(resolvedDir, filename));

  // 6. Stream content to disk with runtime byte counter (50MB ceiling)
  if (!res.body) {
    throw new Error("Asset download response contains no body");
  }

  const outStream = createWriteStream(targetPath);
  let bytesWritten = 0;

  try {
    for await (const chunk of res.body) {
      const chunkLen = (chunk as Uint8Array).length;
      bytesWritten += chunkLen;
      if (bytesWritten > MAX_DOWNLOAD_BYTES) {
        ctrl.abort();
        break;
      }
      const ok = outStream.write(chunk);
      if (!ok) {
        await new Promise((r) => outStream.once("drain", r));
      }
    }
    if (bytesWritten > MAX_DOWNLOAD_BYTES) {
      await new Promise<void>((r) => outStream.close(() => r()));
      await unlink(targetPath).catch(() => {});
      throw new Error(`Asset exceeded 50MB ceiling limit (${bytesWritten} bytes received)`);
    }
    await new Promise<void>((resolve, reject) => {
      outStream.end(() => resolve());
      outStream.on("error", reject);
    });
  } catch (err) {
    ctrl.abort();
    await new Promise<void>((r) => outStream.close(() => r()));
    await unlink(targetPath).catch(() => {});
    if (bytesWritten > MAX_DOWNLOAD_BYTES) {
      throw new Error(`Asset exceeded 50MB ceiling limit (${bytesWritten} bytes received)`);
    }
    throw err;
  }

  // 7. Post-write verification
  const st = await stat(targetPath);
  if (!st.isFile()) {
    throw new Error(`Downloaded path is not a file: ${targetPath}`);
  }
  if (st.size !== bytesWritten) {
    throw new Error(`File size on disk (${st.size} bytes) does not match stream bytes (${bytesWritten} bytes)`);
  }

  return {
    ok: true,
    path: targetPath,
    filename,
    size: st.size,
    mimeType,
    verified: true,
  };
}
