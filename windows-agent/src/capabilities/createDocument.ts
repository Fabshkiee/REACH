import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Document, Footer, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { z } from "zod";
import { openWithDefaultApp } from "./apps.js";
import { assertAllowedPath } from "../sandbox.js";

export const CreateDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(20000).default(""),
});

export type CreateDocumentInput = z.infer<typeof CreateDocumentSchema>;

export interface CreateDocumentResult {
  path: string;
  opened: boolean;
  openNote?: string;
}

// US Letter in DXA (1/1440 inch). docx defaults to A4 — set explicitly.
const LETTER_WIDTH_DXA = 12240;
const LETTER_HEIGHT_DXA = 15840;

export function sanitizeTitle(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "Untitled";
}

export function reachDocumentsDir(): string {
  return join(homedir(), "Documents", "REACH");
}

async function resolveUniquePath(dir: string, base: string): Promise<string> {
  const { access } = await import("node:fs/promises");
  let candidate = join(dir, `${base}.docx`);
  for (let n = 1; n < 1000; n++) {
    try {
      await access(candidate);
      candidate = join(dir, `${base} (${n}).docx`);
    } catch {
      return candidate;
    }
  }
  return candidate;
}

function bodyParagraphs(body: string): Paragraph[] {
  // One Paragraph per line — never a literal \n inside a TextRun (docx gotcha).
  return body.split(/\r?\n/).map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: line || " ", size: 24 })],
      }),
  );
}

/**
 * Create a real .docx on the Windows laptop and open it in the default app.
 * Capability allowlist boundary lives in the HTTP layer — this function only
 * ever writes a document, never executes anything else.
 */
export async function createDocument(input: CreateDocumentInput): Promise<CreateDocumentResult> {
  const parsed = CreateDocumentSchema.parse(input);
  const safeTitle = sanitizeTitle(parsed.title);
  const dir = reachDocumentsDir();
  await mkdir(dir, { recursive: true });
  const path = assertAllowedPath(await resolveUniquePath(dir, safeTitle));

  const doc = new Document({
    creator: "REACH",
    title: safeTitle,
    description: `Created by REACH: ${safeTitle}`,
    sections: [
      {
        properties: {
          page: { size: { width: LETTER_WIDTH_DXA, height: LETTER_HEIGHT_DXA } },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `Created by REACH on ${new Date().toLocaleDateString()}`,
                    size: 18,
                    color: "888888",
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: safeTitle })],
          }),
          ...bodyParagraphs(parsed.body),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  await writeFile(path, buffer);

  // Best-effort open in the default app (shell-free). Never fails the task.
  const { opened, openNote } = await openWithDefaultApp(path);

  return { path, opened, openNote };
}
