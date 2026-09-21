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
});
