import { z } from "zod";

export const CreateDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(20000).default(""),
});

export type CreateDocumentInput = z.infer<typeof CreateDocumentSchema>;

/**
 * Phase 1 implements this with the `docx` package + shell open.
 * Skeleton intentionally throws — proves allowlist boundary, no generic exec.
 */
export async function createDocument(_input: CreateDocumentInput): Promise<{ path: string }> {
  CreateDocumentSchema.parse(_input);
  throw new Error("not_implemented: Phase 1 wires docx generation + open");
}
