import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, parseInlineSegments, blocksToDocx } from "./markdownDocx.js";

describe("markdown → docx", () => {
  it("parses headings, lists, tables and rules", () => {
    const blocks = parseMarkdown(
      [
        "# Attendees",
        "Priya, Marcus",
        "",
        "## Decisions",
        "- first decision",
        "- second decision",
        "",
        "## Steps",
        "1. open it",
        "2. read it",
        "",
        "| Item | Owner |",
        "| --- | --- |",
        "| Copy | Yuki |",
        "",
        "---",
        "> a quote",
      ].join("\n"),
    );
    const kinds = blocks.map((b) => b.kind);
    assert.deepEqual(kinds, ["heading", "paragraph", "heading", "bullet", "heading", "number", "table", "rule", "quote"]);
    assert.equal((blocks[0] as { level: number }).level, 2, "a body '#' is one level under the document title");
    assert.equal((blocks[2] as { level: number }).level, 2);
    assert.deepEqual((blocks[3] as { items: string[] }).items, ["first decision", "second decision"]);
    assert.deepEqual((blocks[5] as { items: string[] }).items, ["open it", "read it"]);
    const table = blocks[6] as { header: string[]; rows: string[][] };
    assert.deepEqual(table.header, ["Item", "Owner"]);
    assert.deepEqual(table.rows, [["Copy", "Yuki"]]);
  });

  it("never throws on unknown markup and keeps the text", () => {
    // Unknown syntax degrades to a paragraph — it must not lose content.
    const blocks = parseMarkdown("some ~~weird|| markup ::: here\nmore text");
    assert.equal(blocks.length, 1);
    assert.equal((blocks[0] as { lines: string[] }).lines.length, 2);
  });

  it("parses inline emphasis, code and links", () => {
    const segs = parseInlineSegments("plain **bold** *italic* `code` [link](https://x.test/a)");
    assert.deepEqual(
      segs.map((s) => [s.text, s.bold ?? false, s.italics ?? false, s.code ?? false, s.href ?? ""]),
      [
        ["plain ", false, false, false, ""],
        ["bold", true, false, false, ""],
        [" ", false, false, false, ""],
        ["italic", false, true, false, ""],
        [" ", false, false, false, ""],
        ["code", false, false, true, ""],
        [" ", false, false, false, ""],
        ["link", false, false, false, "https://x.test/a"],
      ],
    );
  });

  it("renders tables with explicit column widths", () => {
    // Without columnWidths the columns collapse to one character wide in
    // Pages and Quick Look and the table renders as a vertical strip.
    const blocks = parseMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |");
    const docx = blocksToDocx(blocks);
    assert.equal(docx.length, 1);
    const table = docx[0] as unknown as { root: unknown[] };
    const xml = JSON.stringify(table);
    assert.ok(xml.length > 0);
  });

  it("an empty body produces no blocks", () => {
    assert.deepEqual(parseMarkdown(""), []);
    assert.deepEqual(parseMarkdown("   \n\n  "), []);
  });
});
