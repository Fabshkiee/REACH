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
  "download_asset",
  "read_audio",
  "capture_audio",
  "inspect_windows",
  "focus_window",
  "type_text",
  "send_hotkey",
  "set_clipboard",
  "get_clipboard",
  "ios_list",
  "ios_info",
  "ios_list_files",
  "ios_pull_file",
] as const;
export type AllowedCapability = (typeof ALLOWED_CAPABILITIES)[number];

export {
  AudioCaptureSchema,
  AudioReadSchema,
  captureAudio,
  readAudioBytes,
  MAX_AUDIO_BYTES,
} from "./audio.js";
export type { AudioCaptureInput, AudioReadInput } from "./audio.js";
export {
  IosInfoSchema,
  IosListFilesSchema,
  IosListSchema,
  IosPullFileSchema,
  iosInfo,
  iosList,
  iosListFiles,
  iosPullFile,
} from "./phone.js";
export type { IosInfoInput, IosListFilesInput, IosListInput, IosPullFileInput } from "./phone.js";

export function isAllowed(capability: string): capability is AllowedCapability {
  return (ALLOWED_CAPABILITIES as readonly string[]).includes(capability);
}

/**
 * Capabilities that exist only on a Windows host (they drive Win32/PowerShell
 * APIs). On other platforms the agent does not have them at all.
 */
const WINDOWS_ONLY = new Set<AllowedCapability>([
  "inspect_windows",
  "focus_window",
  "type_text",
  "send_hotkey",
  "set_clipboard",
  "get_clipboard",
]);

const MACOS_ONLY = new Set<AllowedCapability>([
  "ios_list",
  "ios_info",
  "ios_list_files",
  "ios_pull_file",
]);

/**
 * What THIS host can actually run.
 *
 * ALLOWED_CAPABILITIES above is the security boundary (what the agent may be
 * asked to do). This is the truth-telling boundary (what the machine can
 * do). Advertising a capability the host cannot execute makes REACH plan
 * against a phantom primitive — the exact failure this product exists to
 * prevent — so Windows-only capabilities are advertised on Windows only.
 */
export function advertisedCapabilities(): AllowedCapability[] {
  return ALLOWED_CAPABILITIES.filter((c) => {
    if (WINDOWS_ONLY.has(c) && process.platform !== "win32") return false;
    if (MACOS_ONLY.has(c) && process.platform !== "darwin") return false;
    return true;
  });
}

export { DownloadAssetSchema, downloadAsset, reachDownloadsDir } from "./downloadAsset.js";
export type { DownloadAssetInput, DownloadAssetResult } from "./downloadAsset.js";
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
export {
  InspectWindowsSchema,
  FocusWindowSchema,
  TypeTextSchema,
  SendHotkeySchema,
  SetClipboardSchema,
  GetClipboardSchema,
  inspectWindows,
  focusWindow,
  typeText,
  sendHotkey,
  setClipboard,
  getClipboard,
} from "./desktop.js";
export type {
  InspectWindowsInput,
  FocusWindowInput,
  TypeTextInput,
  SendHotkeyInput,
  SetClipboardInput,
  GetClipboardInput,
} from "./desktop.js";

