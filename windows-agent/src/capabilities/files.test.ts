import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { writeFile } from "node:fs/promises";
import * as XLSX from "xlsx";

const root = mkdtempSync(join(tmpdir(), "reach-agent-files-"));
process.env.REACH_USER_ROOT = root;

import { moveFile, readFile, searchFiles, verifyFile, writeFile as agentWrite } from "./files.js";

describe("agent file primitives", () => {
  it("write → read round-trip, overwrite guard", async () => {
    const r = await agentWrite({ path: "notes\\a.txt", content: "hello world", overwrite: false });
    assert.ok(r.path.startsWith(root));
    const back = await readFile({ path: "notes\\a.txt" });
    assert.equal(back.text, "hello world");
    await assert.rejects(agentWrite({ path: "notes\\a.txt", content: "x", overwrite: false }), /overwrite/);
    await agentWrite({ path: "notes\\a.txt", content: "v2", overwrite: true });
    assert.equal((await readFile({ path: "notes\\a.txt" })).text, "v2");
  });

  it("move relocates (rename)", async () => {
    await agentWrite({ path: "m\\old.txt", content: "data", overwrite: false });
    const m = await moveFile({ from: "m\\old.txt", to: "m\\new.txt", overwrite: false });
    assert.ok(m.to.endsWith("new.txt"));
    await assert.rejects(readFile({ path: "m\\old.txt" }), /ENOENT|no such/i);
  });

  it("delete removes files, refuses directories and missing paths", async () => {
    const { deleteFile } = await import("./files.js");
    await agentWrite({ path: "del\\gone.txt", content: "bye", overwrite: false });
    const r = await deleteFile({ path: "del\\gone.txt" });
    assert.equal(r.deleted, true);
    await assert.rejects(deleteFile({ path: "del\\gone.txt" }), /no such file/);
    await assert.rejects(deleteFile({ path: "del" }), /non-file/);
  });

  it("verify reports size, rejects missing", async () => {
    const v = await verifyFile({ path: "notes\\a.txt", minBytes: 1 });
    assert.ok(v.size >= 1);
    await assert.rejects(verifyFile({ path: "notes\\nope.txt" }), /ENOENT|no such/i);
  });

  it("search finds by name", async () => {
    await agentWrite({ path: "inv\\invoice-acme-2026.txt", content: "ACME Corp total 120", overwrite: false });
    const { hits } = await searchFiles({ query: "invoice-acme", root: "inv", mode: "name", limit: 20 });
    assert.equal(hits.length, 1);
    assert.ok(hits[0]!.path.endsWith("invoice-acme-2026.txt"));
  });

  it("search finds by content", async () => {
    const { hits } = await searchFiles({ query: "ACME Corp", root: "inv", mode: "content", limit: 20 });
    assert.equal(hits.length, 1);
  });

  it("reads docx text", async () => {
    const doc = new Document({
      sections: [{ children: [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Fixture Title")] })] }],
    });
    const abs = join(root, "fix", "t.docx");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, "fix"), { recursive: true });
    await writeFile(abs, await Packer.toBuffer(doc));
    const out = await readFile({ path: "fix\\t.docx" });
    assert.equal(out.kind, "docx");
    assert.ok(out.text.includes("Fixture Title"));
  });

  it("reads xlsx sheets as csv", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["name", "email"], ["amy", ""], ["bo", "bo@x.io"]]), "Contacts");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, "fix"), { recursive: true });
    XLSX.writeFile(wb, join(root, "fix", "c.xlsx"));
    const out = await readFile({ path: "fix\\c.xlsx" });
    assert.ok(out.kind.startsWith("xlsx"));
    assert.ok(out.text.includes("amy"));
  });

  it("refuses binary and unknown types", async () => {
    const { writeFile: wf } = await import("node:fs/promises");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, "fix"), { recursive: true });
    await wf(join(root, "fix", "b.bin"), Buffer.from([0, 1, 2, 3]));
    await assert.rejects(readFile({ path: "fix\\b.bin" }), /binary|unsupported/);
  });

  it("finds priority locations before giant subtrees (recall regression)", async () => {
    // A 3000-file junk dir must not starve Desktop of visit budget: user
    // locations are ordered first. limit:1 stops at the first hit, so a small
    // visit count PROVES priority ordering (without it, junkheap burns first).
    const { mkdir, writeFile: wf } = await import("node:fs/promises");
    await mkdir(join(root, "Desktop", "REACH"), { recursive: true });
    await wf(join(root, "Desktop", "REACH", "needle.txt"), "here");
    await mkdir(join(root, "junkheap"), { recursive: true });
    for (let i = 0; i < 3000; i++) {
      await wf(join(root, "junkheap", `f${i}.txt`), "junk");
    }
    const r = await searchFiles({ query: "needle", root: ".", mode: "name", limit: 1 });
    assert.equal(r.hits.length, 1);
    assert.ok(r.hits[0]!.path.endsWith("needle.txt"));
    assert.ok(r.visited < 100, `expected early find, visited ${r.visited}`);
  });

  it("skips machine-generated dirs (documented recall tradeoff)", async () => {
    const { mkdir, writeFile: wf } = await import("node:fs/promises");
    await mkdir(join(root, "proj", "dist"), { recursive: true });
    await wf(join(root, "proj", "dist", "skipme-target.txt"), "x");
    const r = await searchFiles({ query: "skipme-target", root: "proj", mode: "name", limit: 20 });
    assert.equal(r.hits.length, 0);
  });

  it("does not flood results with every .txt file for a missing filename", async () => {
    const { mkdir, writeFile: wf } = await import("node:fs/promises");
    await mkdir(join(root, "docs"), { recursive: true });
    for (let i = 0; i < 5; i++) await wf(join(root, "docs", `note${i}.txt`), "x");
    const r = await searchFiles({ query: "test-doc.txt", root: "docs", mode: "name", limit: 20 });
    assert.equal(r.hits.length, 0);
  });

  it("still finds a file by a partial name token", async () => {
    const { mkdir, writeFile: wf } = await import("node:fs/promises");
    await mkdir(join(root, "docs2"), { recursive: true });
    await wf(join(root, "docs2", "test-doc.txt"), "x");
    const r = await searchFiles({ query: "test-doc.txt", root: "docs2", mode: "name", limit: 20 });
    assert.ok(r.hits.length >= 1);
    assert.ok(r.hits[0]!.path.endsWith("test-doc.txt"));
  });
});

describe("agent list + paged read (recovery moves)", () => {
  it("lists directories with sizes, dirs first then smallest-first", async () => {
    const { listFiles } = await import("./files.js");
    await agentWrite({ path: "lst\\big.txt", content: "x".repeat(1000), overwrite: false });
    await agentWrite({ path: "lst\\small.txt", content: "hi", overwrite: false });
    const r = await listFiles({ path: "lst", limit: 50 });
    assert.equal(r.truncated, false);
    const names = r.entries.map((e) => e.name);
    assert.ok(names.includes("big.txt") && names.includes("small.txt"));
    const files = r.entries.filter((e) => !e.isDirectory);
    assert.ok(files[0]!.size! <= files[files.length - 1]!.size!);
    assert.equal(typeof files[0]!.size, "number");
  });

  it("list teaches on files and missing paths", async () => {
    const { listFiles } = await import("./files.js");
    await assert.rejects(listFiles({ path: "notes\\a.txt" }), /not a directory.*files\.read/);
    await assert.rejects(listFiles({ path: "no\\such\\dir" }), /no such directory/);
  });

  it("reads page through text with totalChars", async () => {
    const content = Array.from({ length: 200 }, (_, i) => `line-${i}-padding-xyz`).join("\n");
    await agentWrite({ path: "pg\\big.txt", content, overwrite: false });
    const full = await readFile({ path: "pg\\big.txt" });
    assert.equal(full.truncated, false);
    assert.equal(full.totalChars, content.length);
    const p1 = await readFile({ path: "pg\\big.txt", maxBytes: 500, offsetChars: 0 });
    const p2 = await readFile({ path: "pg\\big.txt", maxBytes: 500, offsetChars: 500 });
    assert.equal(p1.truncated, true);
    assert.equal(p1.text + p2.text, content.slice(0, 1000));
    const tail = await readFile({ path: "pg\\big.txt", maxBytes: 100_000, offsetChars: full.totalChars - 10 });
    assert.equal(tail.truncated, false);
    assert.equal(tail.text, content.slice(-10));
  });

  it("reads files larger than the old 2MB one-shot cap", async () => {
    const { writeFile: wf } = await import("node:fs/promises");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, "huge"), { recursive: true });
    await wf(join(root, "huge", "big.txt"), "z".repeat(3 * 1024 * 1024));
    const first = await readFile({ path: "huge\\big.txt", maxBytes: 1000, offsetChars: 0 });
    assert.equal(first.totalChars, 3 * 1024 * 1024);
    assert.equal(first.truncated, true);
    assert.equal(first.text, "z".repeat(1000));
  });

  it("verify teaches on directories", async () => {
    await assert.rejects(verifyFile({ path: "lst" }), /not a file.*files\.list/);
  });
});
