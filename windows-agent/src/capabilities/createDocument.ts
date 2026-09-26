import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { Document, Footer, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from "docx";
import { z } from "zod";
import { openWithDefaultApp } from "./apps.js";
import { assertAllowedPath } from "../sandbox.js";

export const CreateDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(20000).default(""),
  imagePaths: z.array(z.string().min(1).max(2000)).max(20).optional(),
});

export type CreateDocumentInput = z.input<typeof CreateDocumentSchema>;

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
    // Brackets break Start-Process -FilePath wildcard expansion; the rest are
    // illegal in Windows filenames or control characters.
    .replace(/[<>:"/\\|?*[\]\u0000-\u001f]/g, "")
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

function getImageType(absPath: string, buffer: Buffer): "jpg" | "png" | "gif" | "bmp" {
  const ext = extname(absPath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "jpg";
  if (ext === ".png") return "png";
  if (ext === ".gif") return "gif";
  if (ext === ".bmp") return "bmp";
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "png";
  if (buffer.length > 3 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return "gif";
  if (buffer.length > 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return "bmp";
  return "png";
}

function getImageDimensions(buffer: Buffer): { width: number; height: number } {
  // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width > 0 && height > 0) {
      const maxWidth = 550;
      const maxHeight = 400;
      const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
      return {
        width: Math.max(1, Math.round(width * ratio)),
        height: Math.max(1, Math.round(height * ratio)),
      };
    }
  }
  return { width: 500, height: 350 };
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

  const imageParagraphs: Paragraph[] = [];
  if (parsed.imagePaths && parsed.imagePaths.length > 0) {
    for (const imgPath of parsed.imagePaths) {
      const absImg = assertAllowedPath(imgPath);
      let st;
      try {
        st = await stat(absImg);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(`missing image file: ${absImg}`);
        }
        throw err;
      }
      if (!st.isFile()) {
        throw new Error(`image path is not a file: ${absImg}`);
      }
      const imgBuffer = await readFile(absImg);
      const dims = getImageDimensions(imgBuffer);
      const imgType = getImageType(absImg, imgBuffer);
      imageParagraphs.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: imgBuffer,
              transformation: dims,
              type: imgType,
            }),
          ],
          spacing: { before: 200, after: 200 },
        }),
      );
    }
  }

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
          ...imageParagraphs,
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
