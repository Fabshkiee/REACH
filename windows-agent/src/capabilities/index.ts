/** Explicit capability allowlist — the agent exposes ONLY these. No generic run_command. */
export const ALLOWED_CAPABILITIES = [
  "create_document",
  "open_document",
  "open_url",
  "launch_application",
  "search_files",
  "read_file",
  "write_file",
  "move_file",
  "delete_file",
  "verify_file",
  "list_files",
] as const;
export type AllowedCapability = (typeof ALLOWED_CAPABILITIES)[number];

export function isAllowed(capability: string): capability is AllowedCapability {
  return (ALLOWED_CAPABILITIES as readonly string[]).includes(capability);
}

export { CreateDocumentSchema, createDocument } from "./createDocument.js";
export type { CreateDocumentInput, CreateDocumentResult } from "./createDocument.js";
export {
  KNOWN_APPS,
  LaunchApplicationSchema,
  OpenDocumentSchema,
  OpenUrlSchema,
  launchApplication,
  openDocument,
  openUrl,
  openWithDefaultApp,
} from "./apps.js";
export type { LaunchApplicationInput, OpenDocumentInput, OpenUrlInput } from "./apps.js";
export {
  DeleteFileSchema,
  ListFilesSchema,
  MoveFileSchema,
  ReadFileSchema,
  SearchFilesSchema,
  WriteFileSchema,
  deleteFile,
  listFiles,
  moveFile,
  readFile,
  searchFiles,
  verifyFile,
  writeFile,
} from "./files.js";
export type { DeleteFileInput, ListFilesInput, MoveFileInput, ReadFileInput, SearchFilesInput, WriteFileInput } from "./files.js";
