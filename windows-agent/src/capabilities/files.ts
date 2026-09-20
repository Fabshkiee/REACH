import { mkdir, readdir, rename, stat, writeFile as writeFileFs } from "node:fs/promises";
import { extname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";
import { z } from "zod";
import { assertAllowedPath, resolveWithin, userRoot } from "../sandbox.js";

export const MAX_READ_BYTES = 2 * 1024 * 1024;
export const MAX_SEARCH_RESULTS = 50;
export const SEARCH_TIMEOUT_MS = 30_000;

const SKIP_DIRS = new Set([
  "appdata",
  "application data",
  "node_modules",
  "$recycle.bin",
  "system volume information",
  ".git",
  "onedrive",
  // Package-manager graveyards: tens of thousands of files, never user docs.
  "anaconda3",
  "miniconda3",
  ".anaconda",
  // Machine-generated build/game-engine outputs. A real profile held ~90k
  // files in project folders; without these skips the visit budget dies in
  // cache trees before user locations are ever entered.
  "dist",
  "build",
  ".next",
  ".nuxt",
  "__pycache__",
  "venv",
  ".venv",
  "target",
  "bin",
  "obj",
  "coverage",
  ".turbo",
  ".parcel-cache",
  "library",
  "temp",
  "logs",
  "builds",
  "deriveddatacache",
  "intermediate",
  ".vs",
]);

/** User-facing locations first — depth-first order would otherwise let giant
 *  subtrees (conda pkgs, caches) exhaust the visit budget before Documents
 *  is ever entered. */
const PRIORITY_DIRS = ["desktop", "documents", "downloads"];

function sortEntries<T extends { name: string; isDirectory: () => boolean }>(entries: T[]): T[] {
  const rank = (e: T): number => {
    if (!e.isDirectory()) return 3;
    const n = e.name.toLowerCase();
    const p = PRIORITY_DIRS.indexOf(n);
    return p >= 0 ? p : 4;
  };
  return [...entries].sort((a, b) => rank(a) - rank(b));
}

export const SearchFilesSchema = z.object({
  query: z.string().min(1).max(200),
  root: z.string().max(500).default(""),
  mode: z.enum(["name", "content"]).default("name"),
  limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).default(20),
});
export type SearchFilesInput = z.infer<typeof SearchFilesSchema>;

export const ReadFileSchema = z.object({
  path: z.string().min(1).max(2000),
  maxBytes: z.number().int().positive().max(MAX_READ_BYTES).default(200_000),
});
export type ReadFileInput = z.infer<typeof ReadFileSchema>;

export const WriteFileSchema = z.object({
  path: z.string().min(1).max(2000),
  content: z.string().max(MAX_READ_BYTES),
  overwrite: z.boolean().default(false),
});
export type WriteFileInput = z.infer<typeof WriteFileSchema>;

export const MoveFileSchema = z.object({
  from: z.string().min(1).max(2000),
  to: z.string().min(1).max(2000),
  overwrite: z.boolean().default(false),
});
export type MoveFileInput = z.infer<typeof MoveFileSchema>;

export interface SearchHit {
  path: string;
  size: number;
  modifiedAt: string;
}

async function walk(
  dir: string,
  deadline: number,
  state: { visited: number; stopped: boolean },
  onFile: (abs: string) => boolean | Promise<boolean>,
  visitCap = 100_000,
  depth = 0,
): Promise<void> {
  let entries;
  try {
    entries = sortEntries(await readdir(dir, { withFileTypes: true }));
  } catch {
    return;
  }
  // Near the top of the tree, visit small directories first: a game project
  // with 7k cache files must not starve REACH (dozens of files) of budget.
  // One extra readdir per directory, only at depth 0-1.
  if (depth <= 1) entries = await smallestDirsFirst(dir, entries);
  for (const e of entries) {
    if (Date.now() > deadline || state.stopped || state.visited >= visitCap) return;
    state.visited++;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name.toLowerCase())) continue;
      await walk(full, deadline, state, onFile, visitCap, depth + 1);
    } else if (e.isFile()) {
      const keepGoing = await onFile(full);
      if (!keepGoing) {
        state.stopped = true;
        return;
      }
    }
  }
}

async function smallestDirsFirst<T extends { name: string; isDirectory: () => boolean }>(
  dir: string,
  entries: T[],
): Promise<T[]> {
  // Priority dirs (Desktop/Documents/Downloads) keep their head start from
  // sortEntries; everything else goes smallest-first so giant project folders
  // can't starve user locations of visit budget.
  const pri: T[] = [];
  const rest: T[] = [];
  for (const e of entries) {
    if (e.isDirectory() && PRIORITY_DIRS.includes(e.name.toLowerCase())) pri.push(e);
    else rest.push(e);
  }
  const files = rest.filter((e) => !e.isDirectory());
  const dirs = rest.filter((e) => e.isDirectory());
  const sized = await Promise.all(
    dirs.map(async (d) => {
      try {
        const kids = await readdir(join(dir, d.name));
        return { d, n: kids.length };
      } catch {
        return { d, n: Number.MAX_SAFE_INTEGER };
      }
    }),
  );
  sized.sort((a, b) => a.n - b.n);
  return [...pri, ...files, ...sized.map((s) => s.d)];
}

const TEXT_EXTS = new Set([".txt", ".md", ".json", ".csv", ".log", ".xml", ".html", ".yaml", ".yml", ".ini", ".cfg"]);

async function fileText(abs: string, maxBytes: number): Promise<{ text: string; truncated: boolean; kind: string }> {
  const st = await stat(abs);
  if (st.size > MAX_READ_BYTES) throw new Error(`file too large (${st.size} bytes, cap ${MAX_READ_BYTES})`);
  const ext = extname(abs).toLowerCase();
  if (ext === ".pdf") {
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(abs);
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const res = await parser.getText();
      const text = res.text.slice(0, maxBytes);
      return { text, truncated: res.text.length > maxBytes, kind: `pdf (${res.pages} pages)` };
    } finally {
      await parser.destroy();
    }
  }
  if (ext === ".xlsx" || ext === ".xls") {
    // NOTE: xlsx's ESM wrapper exposes readFile only on the default export;
    // read the bytes ourselves and use the namespace `read` (stable either way).
    const { readFile } = await import("node:fs/promises");
    const wb = XLSX.read(await readFile(abs), { type: "buffer", dense: true });
    const parts: string[] = [];
    for (const name of wb.SheetNames.slice(0, 10)) {
      const sheet = wb.Sheets[name];
      if (!sheet) continue;
      parts.push(`# Sheet: ${name}\n` + XLSX.utils.sheet_to_csv(sheet).slice(0, Math.floor(maxBytes / 4)));
    }
    const text = parts.join("\n").slice(0, maxBytes);
    return { text, truncated: parts.join("\n").length > maxBytes, kind: `xlsx (${wb.SheetNames.length} sheets)` };
  }
  if (ext === ".docx") {
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(abs);
    const xml = extractZipEntry(buf, "word/document.xml");
    if (!xml) throw new Error("not a readable .docx (document.xml missing)");
    const text = xml
      .replace(/<w:tab[^>]*>/g, "\t")
      .replace(/<w:br[^>]*>/g, "\n")
      .replace(/<\/w:p[^>]*>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&(lt|gt|amp|quot|apos);/g, (m, e: string) => ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" })[e] ?? m)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n")
      .slice(0, maxBytes);
    return { text, truncated: text.length >= maxBytes, kind: "docx" };
  }
  if (!TEXT_EXTS.has(ext) && ext !== "") {
    throw new Error(`unsupported type "${ext || "(none)"}": readable types are text, .docx, .pdf, .xlsx`);
  }
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(abs);
  const slice = buf.subarray(0, maxBytes + 1);
  if (slice.includes(0)) throw new Error("binary file: refusing to dump bytes as text");
  const text = slice.subarray(0, maxBytes).toString("utf8");
  return { text, truncated: buf.length > maxBytes, kind: ext || "text" };
}

/** Walk local file headers to pull one entry's raw bytes (no zip dependency). */
function extractZipEntry(zip: Buffer, name: string): string | undefined {
  let off = 0;
  const target = Buffer.from(name);
  while (off + 30 < zip.length) {
    if (zip.readUInt32LE(off) !== 0x04034b50) break;
    const nameLen = zip.readUInt16LE(off + 26);
    const extraLen = zip.readUInt16LE(off + 28);
    const compSize = zip.readUInt32LE(off + 18);
    const method = zip.readUInt16LE(off + 8);
    const entryName = zip.subarray(off + 30, off + 30 + nameLen);
    const dataStart = off + 30 + nameLen + extraLen;
    if (entryName.equals(target)) {
      const comp = zip.subarray(dataStart, dataStart + compSize);
      if (method === 0) return comp.toString("utf8");
      // method 8: raw deflate stream (headerless inflate).
      if (method === 8) return inflateRawSync(comp).toString("utf8");
      return undefined;
    }
    off = dataStart + compSize;
  }
  return undefined;
}

export async function searchFiles(input: z.input<typeof SearchFilesSchema>): Promise<{ hits: SearchHit[]; timedOut: boolean; visited: number }> {
  const parsed = SearchFilesSchema.parse(input);
  const root = parsed.root ? assertAllowedPath(parsed.root) : userRoot();
  const deadline = Date.now() + SEARCH_TIMEOUT_MS;
  const q = parsed.query.toLowerCase();
  const hits: SearchHit[] = [];
  const state = { visited: 0, stopped: false };
  await walk(root, deadline, state, async (abs) => {
    const base = abs.split(/[\\/]/).pop()!.toLowerCase();
    let match = base.includes(q);
    if (!match && parsed.mode === "content") {
      try {
        const ext = extname(abs).toLowerCase();
        if (TEXT_EXTS.has(ext)) {
          const { text } = await fileText(abs, 20_000);
          match = text.toLowerCase().includes(q);
        }
      } catch {
        match = false;
      }
    }
    if (match) {
      try {
        const st = await stat(abs);
        hits.push({ path: abs, size: st.size, modifiedAt: st.mtime.toISOString() });
      } catch {
        // vanished mid-walk; ignore
      }
    }
    return hits.length < parsed.limit;
  });
  return { hits, timedOut: Date.now() > deadline, visited: state.visited };
}

export async function readFile(input: z.input<typeof ReadFileSchema>): Promise<{ path: string; kind: string; text: string; truncated: boolean }> {
  const parsed = ReadFileSchema.parse(input);
  const abs = assertAllowedPath(parsed.path);
  const { text, truncated, kind } = await fileText(abs, parsed.maxBytes);
  return { path: abs, kind, text, truncated };
}

export async function writeFile(input: z.input<typeof WriteFileSchema>): Promise<{ path: string; bytes: number; overwritten: boolean }> {
  const parsed = WriteFileSchema.parse(input);
  const abs = assertAllowedPath(parsed.path);
  const { access, constants } = await import("node:fs/promises");
  let exists = true;
  try {
    await access(abs, constants.F_OK);
  } catch {
    exists = false;
  }
  if (exists && !parsed.overwrite) {
    throw new Error(`refusing to overwrite existing file without overwrite:true: ${abs}`);
  }
  const { dirname } = await import("node:path");
  await mkdir(dirname(abs), { recursive: true });
  await writeFileFs(abs, parsed.content, "utf8");
  return { path: abs, bytes: Buffer.byteLength(parsed.content), overwritten: exists };
}

export async function moveFile(input: z.input<typeof MoveFileSchema>): Promise<{ from: string; to: string }> {
  const parsed = MoveFileSchema.parse(input);
  const from = assertAllowedPath(parsed.from);
  const to = assertAllowedPath(parsed.to);
  if (!parsed.overwrite) {
    const { access, constants } = await import("node:fs/promises");
    try {
      await access(to, constants.F_OK);
      throw new Error(`refusing to overwrite existing file without overwrite:true: ${to}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("refusing")) throw err;
    }
  }
  const { dirname } = await import("node:path");
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
  return { from, to };
}

export async function verifyFile(input: { path: string; minBytes?: number }): Promise<{ path: string; size: number; modifiedAt: string }> {
  const abs = assertAllowedPath(input.path);
  const st = await stat(abs);
  if (!st.isFile()) throw new Error(`not a file: ${abs}`);
  if (input.minBytes !== undefined && st.size < input.minBytes) {
    throw new Error(`file smaller than expected (${st.size} < ${input.minBytes}): ${abs}`);
  }
  return { path: abs, size: st.size, modifiedAt: st.mtime.toISOString() };
}

export { resolveWithin };
