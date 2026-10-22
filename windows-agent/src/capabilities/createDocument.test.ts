import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDocument, CreateDocumentSchema, reachDocumentsDir } from "./createDocument.js";

describe("windows-agent create_document capability", () => {
  const samplePng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );

  let fixtureDir: string;
  let testPngPath: string;
  const createdDocs: string[] = [];

  before(() => {
    fixtureDir = join(reachDocumentsDir(), "test_fixtures");
    mkdirSync(fixtureDir, { recursive: true });
    testPngPath = join(fixtureDir, "test_embed.png");
    writeFileSync(testPngPath, samplePng);
  });

  after(() => {
    try {
      if (existsSync(testPngPath)) unlinkSync(testPngPath);
    } catch {}
    for (const doc of createdDocs) {
      try {
        if (existsSync(doc)) unlinkSync(doc);
      } catch {}
    }
  });

  function assertDocxContainsImage(filePath: string): void {
    assert.ok(existsSync(filePath), `DOCX file does not exist at ${filePath}`);
    const buffer = readFileSync(filePath);
    assert.ok(buffer.length > 500, `DOCX file at ${filePath} is too small (${buffer.length} bytes)`);
    assert.equal(buffer[0], 0x50, "File must be valid PK zip archive");
    assert.equal(buffer[1], 0x4b, "File must be valid PK zip archive");
    const rawStr = buffer.toString("binary");
    const hasMedia =
      rawStr.includes("word/media/") ||
      rawStr.includes("image") ||
      rawStr.includes("drawing") ||
      rawStr.includes("graphic");
    assert.ok(hasMedia, `DOCX archive at ${filePath} does not contain embedded image media entries`);
  }

  it("creates standard document without images", async () => {
    const res = await createDocument({
      title: "Plain Test Document",
      body: "First line of text\nSecond line of text",
    });

    createdDocs.push(res.path);
    assert.ok(res.path.endsWith(".docx"));
    assert.equal(typeof res.opened, "boolean");
    assert.ok(existsSync(res.path));
  });

  it("embeds image using docx ImageRun", async () => {
    const res = await createDocument({
      title: "Illustrated Test Document",
      body: "Document containing an embedded image figure.",
      imagePaths: [testPngPath],
    });

    createdDocs.push(res.path);
    assert.ok(res.path.endsWith(".docx"));
    assert.ok(existsSync(res.path));
    assertDocxContainsImage(res.path);
  });

  it("embeds multiple images sequentially", async () => {
    const res = await createDocument({
      title: "Multi Image Document",
      body: "Two figures embedded below.",
      imagePaths: [testPngPath, testPngPath],
    });

    createdDocs.push(res.path);
    assert.ok(res.path.endsWith(".docx"));
    assert.ok(existsSync(res.path));
    assertDocxContainsImage(res.path);
  });

  it("embeds inline image from markdown ![](path)", async () => {
    const res = await createDocument({
      title: "Inline Image Document",
      body: `Section with an inline figure.\n\n![](${testPngPath})\n\nFigure 1 — caption text.`,
    });

    createdDocs.push(res.path);
    assert.ok(res.path.endsWith(".docx"));
    assert.ok(existsSync(res.path));
    assertDocxContainsImage(res.path);
  });

  it("rejects non-existent image path cleanly", async () => {
    await assert.rejects(
      async () => {
        await createDocument({
          title: "Missing Image Doc",
          body: "",
          imagePaths: [join(fixtureDir, "missing_ghost_12345.png")],
        });
      },
      /missing image file/i,
    );
  });

  it("blocks imagePaths escaping sandbox", async () => {
    await assert.rejects(
      async () => {
        await createDocument({
          title: "Traversal Image Doc",
          body: "",
          imagePaths: ["C:\\Windows\\System32\\notepad.exe"],
        });
      },
      /refused: (path escapes sandbox|allowed|system location)/i,
    );
  });

  it("schema enforces max 20 images limit", () => {
    const twentyImages = Array.from({ length: 20 }, () => testPngPath);
    assert.ok(CreateDocumentSchema.parse({ title: "Valid 20", imagePaths: twentyImages }));

    const twentyOneImages = Array.from({ length: 21 }, () => testPngPath);
    assert.throws(() => {
      CreateDocumentSchema.parse({ title: "Invalid 21", imagePaths: twentyOneImages });
    });
  });
});
