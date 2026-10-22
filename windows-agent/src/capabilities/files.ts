import { mkdir, readdir, rename, stat, writeFile as writeFileFs } from "node:fs/promises";
import { extname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";
import { z } from "zod";
import { assertAllowedPath, resolveWithin, userRoot } from "../sandbox.js";

export const MAX_READ_BYTES = 2 * 1024 * 1024;
/** Largest single file the agent will parse into memory (safety rail). */
export const MAX_PARSE_BYTES = 64 * 1024 * 1024;
/** Ceiling on extracted text held in memory; reads page through it. */
export const MAX_EXTRACT_CHARS = 8 * 1024 * 1024;
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
  "deriveddata",
  "tools-venv",
  "intermediate",
  ".vs",
]);

/** User-facing locations first — depth-first order would otherwise let giant
 *  subtrees (conda pkgs, caches) exhaust the visit budget before Documents
 *  is ever entered. */
const PRIORITY_DIRS = ["desktop", "documents", "downloads", "pictures"];

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
  /** Page through large files: text is sliced [offsetChars, offsetChars + maxBytes]. */
  offsetChars: z.number().int().min(0).max(200_000_000).default(0),
});
export type ReadFileInput = z.infer<typeof ReadFileSchema>;

export const ListFilesSchema = z.object({
  /** Directory to list; empty means the user root. */
  path: z.string().max(2000).default(""),
  limit: z.number().int().min(1).max(200).default(50),
  /** Skip this many entries — without it a folder with more than `limit`
   *  entries can never be paged past the first page. */
  offset: z.number().int().min(0).max(10000).default(0),
  /** size = smallest first (useful for "what can I read?"), name = alphabetical,
   *  recent = newest first. */
  sort: z.enum(["size", "name", "recent"]).default("size"),
});
export type ListFilesInput = z.infer<typeof ListFilesSchema>;

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

export const DeleteFileSchema = z.object({
  path: z.string().min(1).max(2000),
});
export type DeleteFileInput = z.infer<typeof DeleteFileSchema>;

export interface SearchHit {
  path: string;
  size: number;
  modifiedAt: string;
  /** How many of the query's tokens this file covers. Higher is a better match. */
  score: number;
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

/**
 * Binary formats whose TEXT is searchable. A user looking for "my meeting
 * notes" does not know whether they saved them as .docx, .pdf or .xlsx — the
 * extractor for all three already exists (fileText), it was simply never
 * wired into search.
 */
const SEARCHABLE_BINARY_EXTS = new Set([".docx", ".pdf", ".xlsx", ".xls"]);

/**
 * How many binary files one content search will open. Parsing a PDF or a
 * .docx is orders of magnitude more expensive than reading a text file, and a
 * profile-wide search would otherwise spend minutes in other people's
 * documents. The count of what was skipped is reported to the caller.
 */
const MAX_BINARY_INSPECTIONS = 150;

/**
 * Words that carry no signal in a search phrase. "Find my meeting notes in
 * Downloads" should look for {meeting, notes, downloads}, not for "find".
 */
const SEARCH_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "my", "me", "i", "our", "of", "in", "on", "at", "to", "for", "from",
  "with", "is", "are", "was", "were", "it", "its", "this", "that", "these", "those", "be", "been", "am",
  "file", "files", "folder", "folders", "doc", "docs", "document", "documents", "find", "show", "get", "give",
  "please", "can", "you", "about", "there", "here", "all", "any", "some", "one", "two", "up", "out", "into",
]);

/**
 * Split a search phrase into the words that actually carry signal.
 *
 * A raw substring match made "standup transcript" find nothing at all,
 * because the file was called "standup-transcript.txt" — the model asked the
 * user for the file it had already been told the name of. Splitting on
 * word boundaries and scoring by coverage matches the way people phrase
 * things.
 */
/**
 * File extensions that, on their own, match every file of that type. "txt"
 * alone is not a meaningful search signal — it is the shape of the file, not
 * its name. Stripped from the "real" token set so a query like "test-doc.txt"
 * cannot flood results with every .txt file on the machine.
 */
const EXT_TOKENS = new Set([
  "txt", "md", "json", "csv", "log", "xml", "html", "htm", "yaml", "yml", "ini", "cfg",
  "pdf", "doc", "docx", "xlsx", "xls", "ppt", "pptx",
  "mp3", "mp4", "wav", "m4a", "mov", "avi",
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp",
  "zip", "tar", "gz", "tgz", "rar", "7z",
  "py", "js", "ts", "tsx", "jsx", "java", "c", "cpp", "h", "go", "rs", "rb", "sh",
]);

/** Tokens that carry real name signal: drop extension-only tokens when a
 *  non-extension token remains, so "test-doc.txt" searches for "test", not
 *  for every text file. */
export function realTokens(tokens: string[]): string[] {
  const real = tokens.filter((t) => !EXT_TOKENS.has(t));
  return real.length > 0 ? real : tokens;
}

export function tokenizeQuery(query: string): string[] {
  const raw = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const meaningful = raw.filter((t) => t.length >= 2 && !SEARCH_STOPWORDS.has(t));
  return meaningful.length > 0 ? meaningful : raw;
}

/** How many of the query's tokens appear in the haystack. */
function scoreTokens(haystack: string, tokens: string[]): number {
  let n = 0;
  for (const t of tokens) if (haystack.includes(t)) n++;
  return n;
}

async function fileText(
  abs: string,
  maxChars: number,
  offsetChars = 0,
): Promise<{ text: string; truncated: boolean; kind: string; totalChars: number; pages?: number }> {
  const st = await stat(abs);
  if (st.size > MAX_PARSE_BYTES) {
    throw new Error(
      `file too large to parse (${st.size} bytes, cap ${MAX_PARSE_BYTES}) — work from its metadata (files.list / files.verify) or a smaller scope`,
    );
  }
  const page = (full: string): { text: string; truncated: boolean } => {
    const text = full.slice(offsetChars, offsetChars + maxChars);
    return { text, truncated: offsetChars + text.length < full.length };
  };
  const ceiling = (full: string): string =>
    full.length > MAX_EXTRACT_CHARS ? full.slice(0, MAX_EXTRACT_CHARS) : full;
  const ext = extname(abs).toLowerCase();
  if (ext === ".pdf") {
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(abs);
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const res = await parser.getText();
      const full = ceiling(res.text);
      const { text, truncated } = page(full);
      return { text, truncated, kind: `pdf (${res.pages.length} pages)`, totalChars: res.text.length, pages: res.pages.length };
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
      parts.push(`# Sheet: ${name}\n` + XLSX.utils.sheet_to_csv(sheet));
      if (parts.join("\n").length > MAX_EXTRACT_CHARS) break;
    }
    const full = ceiling(parts.join("\n"));
    const { text, truncated } = page(full);
    return { text, truncated, kind: `xlsx (${wb.SheetNames.length} sheets)`, totalChars: full.length };
  }
  if (ext === ".docx") {
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(abs);
    const xml = extractZipEntry(buf, "word/document.xml");
    if (!xml) throw new Error("not a readable .docx (document.xml missing)");
    const full = ceiling(
      xml
        .replace(/<w:tab[^>]*>/g, "\t")
        .replace(/<w:br[^>]*>/g, "\n")
        .replace(/<\/w:p[^>]*>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&(lt|gt|amp|quot|apos);/g, (m, e: string) => ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" })[e] ?? m)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n"),
    );
    const { text, truncated } = page(full);
    return { text, truncated, kind: "docx", totalChars: full.length };
  }
  if (!TEXT_EXTS.has(ext) && ext !== "") {
    throw new Error(`unsupported type "${ext || "(none)"}": readable types are text, .docx, .pdf, .xlsx — for anything else, open it with apps.open_document or inspect it with files.list`);
  }
  const { readFile } = await import("node:fs/promises");
  const buf = await readFile(abs);
  if (buf.subarray(0, Math.min(buf.length, 8192)).includes(0)) throw new Error("binary file: refusing to dump bytes as text");
  const full = ceiling(buf.toString("utf8"));
  const { text, truncated } = page(full);
  return { text, truncated, kind: ext || "text", totalChars: full.length };
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
  const tokens = tokenizeQuery(parsed.query);
  // Strip extension-only tokens ("txt", "pdf", ...) so a query like
  // "test-doc.txt" searches for "test", not for every text file on disk.
  const signalTokens = realTokens(tokens);
  const hits: SearchHit[] = [];
  const state = { visited: 0, stopped: false };
  // Collect more than we return, then rank: "standup transcript" matches
  // several files and only one of them is the transcript. The best match
  // must be FIRST, not merely present.
  const candidateCap = Math.max(parsed.limit * 10, 100);
  let perfect = 0;
  let binaryInspected = 0;
  let binarySkipped = 0;

  await walk(root, deadline, state, async (abs) => {
    // Score against the path RELATIVE to the search root, so the root's own
    // name ("Downloads") does not give every file under it a free token.
    const rel = abs.startsWith(root) ? abs.slice(root.length) : abs;
    const hay = rel.toLowerCase();
    const base = abs.split(/[\\/]/).pop()?.toLowerCase() ?? "";
    const qLower = parsed.query.trim().toLowerCase();
    // A query that looks like a filename ("test-doc.txt", "report.pdf") is
    // matched against the basename directly — a substring/word match would
    // flood results with every file containing "test". Descriptive queries
    // ("standup transcript") keep the token-based behaviour.
    const isFilenameQuery = qLower.includes(".");
    let score: number;
    let matched: boolean;
    let contentMatched = false;
    if (isFilenameQuery && parsed.mode === "name") {
      matched = base.includes(qLower);
      score = matched ? (base === qLower ? signalTokens.length + 1 : 1) : 0;
    } else {
      score = scoreTokens(hay, signalTokens);
      matched = score >= 1;
      if (!matched && parsed.mode === "content" && tokens.length > 0) {
        const ext = extname(abs).toLowerCase();
        const isText = TEXT_EXTS.has(ext) || ext === "";
        const isBinary = SEARCHABLE_BINARY_EXTS.has(ext);
        if (isBinary && binaryInspected >= MAX_BINARY_INSPECTIONS) {
          binarySkipped++;
        } else if (isText || isBinary) {
          if (isBinary) binaryInspected++;
          try {
            const { text } = await fileText(abs, 20_000);
            const body = text.toLowerCase();
            contentMatched = signalTokens.every((t) => body.includes(t));
            matched = contentMatched;
          } catch {
            matched = false;
          }
        }
      }
    }
    if (matched) {
      const exactBonus = (isFilenameQuery && base === qLower) ? signalTokens.length + 1 : 0;
      try {
        const st = await stat(abs);
        hits.push({
          path: abs,
          size: st.size,
          modifiedAt: st.mtime.toISOString(),
          score: (contentMatched ? signalTokens.length : score) + exactBonus,
        });
      } catch {
        // vanished mid-walk; ignore
      }
      const exactBasenameMatch = base === qLower;
      if (isFilenameQuery ? exactBasenameMatch : score === signalTokens.length) {
        perfect++;
      }
    }
    // Stop as soon as we have enough exact matches; otherwise keep gathering
    // candidates so the ranking has something to work with.
    return !(perfect >= parsed.limit) && hits.length < candidateCap;
  });

  hits.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return {
    hits: hits.slice(0, parsed.limit),
    timedOut: Date.now() > deadline,
    visited: state.visited,
    ...(binarySkipped > 0 ? { skippedBinaryFiles: binarySkipped } : {}),
  };
}

export async function readFile(input: z.input<typeof ReadFileSchema>): Promise<{
  path: string;
  kind: string;
  text: string;
  truncated: boolean;
  totalChars: number;
  pages?: number;
}> {
  const parsed = ReadFileSchema.parse(input);
  const abs = assertAllowedPath(parsed.path);
  const { text, truncated, kind, totalChars, pages } = await fileText(abs, parsed.maxBytes, parsed.offsetChars);
  return { path: abs, kind, text, truncated, totalChars, ...(pages !== undefined ? { pages } : {}) };
}

export interface ListEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: string;
}

/**
 * List one directory: names, sizes, and types, directories first then files
 * smallest-first. The companion to search when the question is "what is here"
 * or "which files are small enough to read" — no walk, no timeouts.
 */
export async function listFiles(input: z.input<typeof ListFilesSchema>): Promise<{
  path: string;
  entries: ListEntry[];
  truncated: boolean;
  /** Total entries in the directory, before paging. */
  total: number;
  offset: number;
  hint?: string;
}> {
  const parsed = ListFilesSchema.parse(input);
  const abs = parsed.path ? assertAllowedPath(parsed.path) : userRoot();
  const st = await stat(abs).catch(() => undefined);
  if (!st) throw new Error(`no such directory: ${abs} — check the path with files.search`);
  if (!st.isDirectory()) {
    throw new Error(`not a directory: ${abs} — it is a file; use files.read or files.verify on it instead`);
  }
  const dirents = await readdir(abs, { withFileTypes: true });
  const entries: ListEntry[] = [];
  for (const e of dirents) {
    const full = join(abs, e.name);
    if (e.isDirectory() && e.name.toLowerCase()==="reach" && process.env.DEBUG_SEARCH) console.error("ENTERING reach dir:", full);
    if (e.isDirectory()) {
      entries.push({ name: e.name, path: full, isDirectory: true });
    } else if (e.isFile()) {
      try {
        const fst = await stat(full);
        entries.push({ name: e.name, path: full, isDirectory: false, size: fst.size, modifiedAt: fst.mtime.toISOString() });
      } catch {
        // vanished mid-list; ignore
      }
    }
  }
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    if (parsed.sort === "name") return a.name.localeCompare(b.name);
    if (parsed.sort === "recent") {
      return (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? "");
    }
    if (!a.isDirectory && !b.isDirectory) return (a.size ?? 0) - (b.size ?? 0);
    return a.name.localeCompare(b.name);
  });
  const page = entries.slice(parsed.offset, parsed.offset + parsed.limit);
  const total = entries.length;
  return {
    path: abs,
    entries: page,
    total,
    offset: parsed.offset,
    truncated: parsed.offset + page.length < total,
    ...(parsed.sort === "size" ? { hint: "sorted smallest-first; pass sort:'name' for alphabetical or sort:'recent' for newest" } : {}),
  };
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

/**
 * Delete a single file. Directories are never deleted. Always gated by the
 * confirm tier upstream — reaching this function means the user approved.
 */
export async function deleteFile(input: z.input<typeof DeleteFileSchema>): Promise<{ path: string; deleted: boolean }> {
  const parsed = DeleteFileSchema.parse(input);
  const abs = assertAllowedPath(parsed.path);
  const st = await stat(abs).catch(() => undefined);
  if (!st) throw new Error(`no such file: ${abs}`);
  if (!st.isFile()) throw new Error(`refusing to delete non-file: ${abs}`);
  const { unlink } = await import("node:fs/promises");
  await unlink(abs);
  return { path: abs, deleted: true };
}

export async function verifyFile(input: { path: string; minBytes?: number }): Promise<{ path: string; size: number; modifiedAt: string }> {
  const abs = assertAllowedPath(input.path);
  const st = await stat(abs);
  if (!st.isFile()) {
    throw new Error(
      st.isDirectory()
        ? `not a file: ${abs} — it is a directory; use files.list on it instead`
        : `not a file: ${abs}`,
    );
  }
  if (input.minBytes !== undefined && st.size < input.minBytes) {
    throw new Error(`file smaller than expected (${st.size} < ${input.minBytes}): ${abs}`);
  }
  return { path: abs, size: st.size, modifiedAt: st.mtime.toISOString() };
}

export { resolveWithin };
