/**
 * E2E Assertion Helpers for REACH
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

export function assertIsoDate(value: unknown, label = "timestamp"): void {
  assert.ok(typeof value === "string", `${label} must be a string, got ${typeof value}`);
  const isIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value);
  assert.ok(isIso, `${label} "${value}" must match ISO-8601 format`);
}

export function assertBuildStamp(data: unknown, expectedService: "reach-server" | "windows-agent"): void {
  assert.ok(data && typeof data === "object", "Response must be a non-null object");
  const obj = data as Record<string, unknown>;
  assert.equal(obj["ok"], true, "Response ok must be true");
  assert.equal(obj["service"], expectedService, `Service must match "${expectedService}"`);
  assert.ok(typeof obj["buildStamp"] === "string" && obj["buildStamp"].length > 0, `buildStamp must be a non-empty string on ${expectedService}`);
}

/**
 * Validates that a generated .docx file exists and contains embedded DrawingML / Image media.
 * Docx files are OpenXML ZIP packages containing word/document.xml and word/media/.
 */
export function assertDocxContainsImage(filePath: string): void {
  assert.ok(existsSync(filePath), `DOCX file does not exist at ${filePath}`);
  const buffer = readFileSync(filePath);
  assert.ok(buffer.length > 500, `DOCX file at ${filePath} is suspiciously small (${buffer.length} bytes)`);

  // PK header check for zip archive
  assert.equal(buffer[0], 0x50, "File must be valid PK zip archive");
  assert.equal(buffer[1], 0x4b, "File must be valid PK zip archive");

  const rawStr = buffer.toString("binary");
  // Check for DrawingML / image media signatures inside the docx zip container
  const hasMedia = rawStr.includes("word/media/") || rawStr.includes("image") || rawStr.includes("drawing") || rawStr.includes("graphic");
  assert.ok(hasMedia, `DOCX archive at ${filePath} does not contain embedded image media entries`);
}
