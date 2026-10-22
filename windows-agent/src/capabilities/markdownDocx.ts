/**
 * Markdown → structured .docx.
 *
 * REACH used to render a document body as one paragraph per LINE: a blue
 * Word-styled title and a flat wall of plain text. The model had no way to
 * express structure, so it faked it with ASCII ("- item", a bare "DECISIONS"
 * line) and the result read like machine output.
 *
 * The tool schema cannot change shape — Nova tool schemas carry no object
 * type — so the body stays a plain string. Markdown is the right string: the
 * model already writes it, and it carries the full document vocabulary
 * (headings, lists, tables, emphasis) in one flat field.
 *
 * SAFETY: any markup this parser does not understand degrades to a plain
 * paragraph. It never throws and never drops content.
 */
import {
  AlignmentType,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
} from "docx";

export const BULLET_REFERENCE = "reach-bullets";
export const NUMBER_REFERENCE = "reach-numbers";

export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "bullet"; items: string[] }
  | { kind: "number"; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "rule" }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "image"; alt: string; path: string };

/** Pre-loaded image bytes for inline `![alt](path)` blocks. */
export interface InlineImage {
  data: Buffer;
  type: "jpg" | "png" | "gif" | "bmp";
  width: number;
  height: number;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const NUMBER_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const RULE_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const TABLE_DIVIDER_RE = /^\s*\|[\s:|-]+\|\s*$/;

/**
 * Split the body into blocks. Line-oriented, forgiving: an unrecognised
 * line is a paragraph, never an error.
 */
export function parseMarkdown(md: string): MarkdownBlock[] {
  const lines = (md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let para: string[] = [];
  let bullets: string[] = [];
  let numbers: string[] = [];
  let quote: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ kind: "paragraph", lines: para });
    para = [];
  };
  const flushBullets = () => {
    if (bullets.length) blocks.push({ kind: "bullet", items: bullets });
    bullets = [];
  };
  const flushNumbers = () => {
    if (numbers.length) blocks.push({ kind: "number", items: numbers });
    numbers = [];
  };
  const flushQuote = () => {
    if (quote.length) blocks.push({ kind: "quote", lines: quote });
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushBullets();
    flushNumbers();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushAll();
      continue;
    }

    // Block-level image: ![caption](localPath)
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imgMatch) {
      flushAll();
      blocks.push({ kind: "image", alt: (imgMatch[1] ?? "").trim(), path: (imgMatch[2] ?? "").trim() });
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      flushAll();
      // The document title is already the H1, so the body's first level
      // becomes H2 — the model can write "# Section" or "## Section" and
      // both land one level below the title.
      const level = Math.min(4, Math.max(2, heading[1]!.length));
      blocks.push({ kind: "heading", level, text: heading[2]!.trim() });
      continue;
    }

    if (RULE_RE.test(line)) {
      flushAll();
      blocks.push({ kind: "rule" });
      continue;
    }

    const quoteMatch = line.match(QUOTE_RE);
    if (quoteMatch) {
      flushPara();
      flushBullets();
      flushNumbers();
      quote.push(quoteMatch[1] ?? "");
      continue;
    }

    // A table needs a header row followed by a divider row.
    const tableRow = line.match(TABLE_ROW_RE);
    if (tableRow) {
      const next = (lines[i + 1] ?? "").trim();
      if (TABLE_DIVIDER_RE.test(next)) {
        flushAll();
        const cells = splitRow(tableRow[1] ?? "");
        i++; // consume the divider
        const rows: string[][] = [];
        for (let j = i + 1; j < lines.length; j++) {
          const r = (lines[j] ?? "").match(TABLE_ROW_RE);
          if (!r) break;
          rows.push(splitRow(r[1] ?? ""));
          i = j;
        }
        blocks.push({ kind: "table", header: cells, rows });
        continue;
      }
    }

    const bullet = line.match(BULLET_RE);
    if (bullet) {
      flushPara();
      flushNumbers();
      flushQuote();
      bullets.push(bullet[1] ?? "");
      continue;
    }

    const number = line.match(NUMBER_RE);
    if (number) {
      flushPara();
      flushBullets();
      flushQuote();
      numbers.push(number[2] ?? "");
      continue;
    }

    flushBullets();
    flushNumbers();
    flushQuote();
    para.push(line.trim());
  }
  flushAll();
  return blocks;
}

function splitRow(inner: string): string[] {
  return inner
    .split("|")
    .map((c) => c.trim())
    .filter((c, idx, arr) => !(idx === 0 && c === "") && !(idx === arr.length - 1 && c === ""));
}

const INLINE_RE =
  /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^)\s]+\))/g;

export interface InlineSegment {
  text: string;
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
}

/** Split a line into styled segments, honouring bold / italic / code / strike / links. */
export function parseInlineSegments(text: string): InlineSegment[] {
  // Markdown image syntax is not rendered as an embedded image (images travel
  // via imagePaths). Rewrite it to a readable placeholder so the raw
  // '![](url)' markup never leaks into the document as literal text.
  const cleaned = (text ?? "").replace(/!\[([^\]]*)\]\([^)]*\)/g, "[Image: $1]");
  const out: InlineSegment[] = [];
  const parts = cleaned.split(INLINE_RE).filter((p) => p !== "" && p !== undefined);
  for (const part of parts) {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      out.push({ text: part.slice(2, -2), bold: true });
    } else if (part.startsWith("__") && part.endsWith("__") && part.length > 4) {
      out.push({ text: part.slice(2, -2), bold: true });
    } else if (part.startsWith("~~") && part.endsWith("~~") && part.length > 4) {
      out.push({ text: part.slice(2, -2), strike: true });
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out.push({ text: part.slice(1, -1), code: true });
    } else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      out.push({ text: part.slice(1, -1), italics: true });
    } else if (part.startsWith("_") && part.endsWith("_") && part.length > 2) {
      out.push({ text: part.slice(1, -1), italics: true });
    } else {
      const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (link) out.push({ text: link[1]!, href: link[2]! });
      else out.push({ text: part });
    }
  }
  return out;
}

/** Build docx runs from styled segments. */
export function segmentsToRuns(
  segments: InlineSegment[],
  opts: { forceBold?: boolean } = {},
): TextRun[] {
  const runs: TextRun[] = [];
  for (const seg of segments) {
    if (seg.href) {
      runs.push(
        new ExternalHyperlink({
          link: seg.href,
          children: [new TextRun({ text: seg.text, style: "Hyperlink" })],
        }) as unknown as TextRun,
      );
      continue;
    }
    runs.push(
      new TextRun({
        text: seg.text,
        bold: opts.forceBold ? true : seg.bold,
        italics: seg.italics,
        strike: seg.strike,
        ...(seg.code ? { font: "Courier New", size: 19 } : {}),
      }),
    );
  }
  return runs.length ? runs : [new TextRun({ text: "" })];
}

/** Split a line into runs, honouring bold / italic / code / strike / links. */
export function parseInline(text: string): TextRun[] {
  return segmentsToRuns(parseInlineSegments(text));
}

const HEADING_LEVELS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
};

/** Turn parsed blocks into docx paragraphs and tables. `images` supplies the
 *  bytes for inline `![alt](path)` blocks; missing images degrade to a
 *  caption-only paragraph. */
export function blocksToDocx(blocks: MarkdownBlock[], images?: Map<string, InlineImage>): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const block of blocks) {
    if (block.kind === "heading") {
      out.push(
        new Paragraph({
          heading: HEADING_LEVELS[block.level] ?? HeadingLevel.HEADING_3,
          children: parseInline(block.text),
        }),
      );
      continue;
    }
    if (block.kind === "paragraph") {
      // One paragraph, one line break per source line: readable, and it does
      // not turn every line into its own block of vertical whitespace.
      const children: TextRun[] = [];
      block.lines.forEach((line, idx) => {
        const segs = parseInlineSegments(line);
        if (idx > 0) children.push(new TextRun({ text: "", break: 1 }));
        children.push(...segmentsToRuns(segs));
      });
      out.push(new Paragraph({ children }));
      continue;
    }
    if (block.kind === "bullet") {
      for (const item of block.items) {
        out.push(
          new Paragraph({
            numbering: { reference: BULLET_REFERENCE, level: 0 },
            children: parseInline(item),
          }),
        );
      }
      continue;
    }
    if (block.kind === "number") {
      for (const item of block.items) {
        out.push(
          new Paragraph({
            numbering: { reference: NUMBER_REFERENCE, level: 0 },
            children: parseInline(item),
          }),
        );
      }
      continue;
    }
    if (block.kind === "quote") {
      out.push(
        new Paragraph({
          children: block.lines.flatMap((l) => parseInline(l)),
          indent: { left: 480 },
          style: "Quote",
        }),
      );
      continue;
    }
    if (block.kind === "rule") {
      out.push(
        new Paragraph({
          children: [new TextRun({ text: "" })],
          border: { bottom: { style: "single" as never, size: 6, color: "C9D1DB", space: 1 } },
          spacing: { before: 120, after: 180 },
        }),
      );
      continue;
    }
    if (block.kind === "table") {
      const cols = Math.max(1, block.header.length);
      // Usable width: US Letter (12240) minus the default 1" margins.
      const usable = 9360;
      const base = Math.floor(usable / cols);
      const widths = Array.from({ length: cols }, (_, i) =>
        i === cols - 1 ? usable - base * (cols - 1) : base,
      );
      const cellWidth = (i: number) => ({ size: Math.floor((widths[i] ?? base) / usable * 100), type: WidthType.PERCENTAGE });
      // Cell padding: without it the text runs into the column edge and
      // clips instead of wrapping.
      const CELL_MARGIN = { top: 80, bottom: 80, left: 140, right: 140 };
      const headerRow = new TableRow({
        tableHeader: true,
        children: block.header.map(
          (cell, i) =>
            new TableCell({
              width: cellWidth(i),
              margins: CELL_MARGIN,
              shading: { fill: "EEF2F7" },
              children: [
                new Paragraph({
                  children: segmentsToRuns(parseInlineSegments(cell), { forceBold: true }),
                }),
              ],
            }),
        ),
      });
      const bodyRows = block.rows.map(
        (row) =>
          new TableRow({
            children: block.header.map((_, i) =>
              new TableCell({
                width: cellWidth(i),
                margins: CELL_MARGIN,
                children: [new Paragraph({ children: parseInline(row[i] ?? "") })],
              }),
            ),
          }),
      );
      out.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          // Without an explicit grid the columns collapse to one character
          // wide in Pages and Quick Look — the table renders as a vertical
          // strip of letters.
          columnWidths: widths,
          rows: [headerRow, ...bodyRows],
        }),
      );
      continue;
    }
    if (block.kind === "image") {
      const img = images?.get(block.path);
      if (img) {
        out.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: img.data,
                transformation: { width: img.width, height: img.height },
                type: img.type,
              }),
            ],
            spacing: { before: 200, after: 80 },
          }),
        );
      }
      if (block.alt) {
        out.push(
          new Paragraph({
            children: [new TextRun({ text: block.alt, italics: true, size: 18, color: "555555" })],
            spacing: { after: 200 },
          }),
        );
      }
      continue;
    }
  }
  return out;
}

/** Convenience: markdown straight to docx children. */
export function markdownToDocx(md: string, images?: Map<string, InlineImage>): (Paragraph | Table)[] {
  return blocksToDocx(parseMarkdown(md), images);
}

/** Numbering definitions the document needs for bullets and numbered lists. */
export function reachNumbering() {
  const level = (format: (typeof LevelFormat)[keyof typeof LevelFormat], text: string) => ({
    level: 0,
    format,
    text,
    alignment: AlignmentType.START,
    style: { paragraph: { indent: { left: 420, hanging: 220 } } },
  });
  return {
    config: [
      { reference: BULLET_REFERENCE, levels: [level(LevelFormat.BULLET, "•")] },
      { reference: NUMBER_REFERENCE, levels: [level(LevelFormat.DECIMAL, "%1.")] },
    ],
  };
}
