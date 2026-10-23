import express from "express";
import { AGENT_ID, registrationPayload, startHeartbeat } from "./agent.js";
import { requireAgentAuth } from "./auth.js";
import { loadEnv, requireAgentToken } from "./env.js";
import {
  KNOWN_APPS,
  LaunchApplicationSchema,
  OpenDocumentSchema,
  OpenUrlSchema,
  launchApplication,
  openDocument,
  openUrl,
} from "./capabilities/apps.js";
import {
  ALLOWED_CAPABILITIES,
  AudioCaptureSchema,
  AudioReadSchema,
  CreateDocumentSchema,
  DeleteFileSchema,
  DownloadAssetSchema,
  FocusWindowSchema,
  GetClipboardSchema,
  InspectWindowsSchema,
  ListFilesSchema,
  MoveFileSchema,
  ReadFileSchema,
  SearchFilesSchema,
  SendHotkeySchema,
  SetClipboardSchema,
  TypeTextSchema,
  WriteFileSchema,
  captureAudio,
  createDocument,
  deleteFile,
  downloadAsset,
  focusWindow,
  getClipboard,
  inspectWindows,
  isAllowed,
  listFiles,
  moveFile,
  readAudioBytes,
  readFile,
  searchFiles,
  sendHotkey,
  setClipboard,
  typeText,
  verifyFile,
  writeFile,
} from "./capabilities/index.js";
import type { z } from "zod";
import {
  IosAppsSchema,
  IosButtonSchema,
  IosCopySchema,
  IosInfoSchema,
  IosLaunchSchema,
  IosListFilesSchema,
  IosListSchema,
  IosPasteSchema,
  IosPullFileSchema,
  IosPushFileSchema,
  IosScreenshotSchema,
  iosApps,
  iosButton,
  iosCopy,
  iosInfo,
  iosLaunch,
  iosList,
  iosListFiles,
  iosPaste,
  iosPullFile,
  iosPushFile,
  iosScreenshot,
} from "./capabilities/phone.js";

const app = express();
app.use(express.json());

export const BUILD_STAMP = "2026-10-01T10:46:00Z";

app.get("/health", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({ ok: true, service: "windows-agent", agentId: AGENT_ID, buildStamp: BUILD_STAMP });
});

app.get("/capabilities", (_req, res) => {
  res.json({ agentId: AGENT_ID, capabilities: ALLOWED_CAPABILITIES, knownApps: Object.keys(KNOWN_APPS) });
});

interface DispatchEntry {
  schema: z.ZodTypeAny;
  run: (args: unknown) => Promise<Record<string, unknown>>;
}

/**
 * Capability table: every exposed operation in one auditable place.
 * Validation (schema) + sandbox re-checks live in the handlers — the agent
 * never trusts the core's judgment alone.
 */
const DISPATCH: Record<string, DispatchEntry> = {
  create_document: { schema: CreateDocumentSchema, run: async (a) => ({ ...(await createDocument(a as never)) }) },
  open_document: {
    schema: OpenDocumentSchema,
    run: async (a) => ({ ...(await openDocument(a as never)) }),
  },
  open_url: { schema: OpenUrlSchema, run: async (a) => ({ ...(await openUrl(a as never)) }) },
  launch_application: {
    schema: LaunchApplicationSchema,
    run: async (a) => ({ ...(await launchApplication(a as never)) }),
  },
  search_files: { schema: SearchFilesSchema, run: async (a) => ({ ...(await searchFiles(a as never)) }) },
  read_file: { schema: ReadFileSchema, run: async (a) => ({ ...(await readFile(a as never)) }) },
  write_file: { schema: WriteFileSchema, run: async (a) => ({ ...(await writeFile(a as never)) }) },
  move_file: { schema: MoveFileSchema, run: async (a) => ({ ...(await moveFile(a as never)) }) },
  delete_file: { schema: DeleteFileSchema, run: async (a) => ({ ...(await deleteFile(a as never)) }) },
  verify_file: {
    schema: ReadFileSchema.pick({ path: true }),
    run: async (a) => ({ ...(await verifyFile(a as { path: string })) }),
  },
  list_files: { schema: ListFilesSchema, run: async (a) => ({ ...(await listFiles(a as never)) }) },
  download_asset: {
    schema: DownloadAssetSchema,
    run: async (a) => ({ ...(await downloadAsset(a as never)) }),
  },
  read_audio: {
    schema: AudioReadSchema,
    run: async (a) => ({ ...(await readAudioBytes(a as never)) }),
  },
  capture_audio: {
    schema: AudioCaptureSchema,
    run: async (a) => ({ ...(await captureAudio(a as never)) }),
  },
  inspect_windows: {
    schema: InspectWindowsSchema,
    run: async (a) => ({ ...(await inspectWindows(a as never)) }),
  },
  focus_window: {
    schema: FocusWindowSchema,
    run: async (a) => ({ ...(await focusWindow(a as never)) }),
  },
  type_text: {
    schema: TypeTextSchema,
    run: async (a) => ({ ...(await typeText(a as never)) }),
  },
  send_hotkey: {
    schema: SendHotkeySchema,
    run: async (a) => ({ ...(await sendHotkey(a as never)) }),
  },
  set_clipboard: {
    schema: SetClipboardSchema,
    run: async (a) => ({ ...(await setClipboard(a as never)) }),
  },
  get_clipboard: {
    schema: GetClipboardSchema,
    run: async () => ({ ...(await getClipboard()) }),
  },
  ios_list: { schema: IosListSchema, run: async (a) => ({ ...(await iosList(a as never)) }) },
  ios_info: { schema: IosInfoSchema, run: async (a) => ({ ...(await iosInfo(a as never)) }) },
  ios_list_files: { schema: IosListFilesSchema, run: async (a) => ({ ...(await iosListFiles(a as never)) }) },
  ios_pull_file: { schema: IosPullFileSchema, run: async (a) => ({ ...(await iosPullFile(a as never)) }) },
  ios_screenshot: { schema: IosScreenshotSchema, run: async (a) => ({ ...(await iosScreenshot(a as never)) }) },
  ios_apps: { schema: IosAppsSchema, run: async (a) => ({ ...(await iosApps(a as never)) }) },
  ios_paste: { schema: IosPasteSchema, run: async (a) => ({ ...(await iosPaste(a as never)) }) },
  ios_copy: { schema: IosCopySchema, run: async (a) => ({ ...(await iosCopy(a as never)) }) },
  ios_launch: { schema: IosLaunchSchema, run: async (a) => ({ ...(await iosLaunch(a as never)) }) },
  ios_button: { schema: IosButtonSchema, run: async (a) => ({ ...(await iosButton(a as never)) }) },
  ios_push_file: { schema: IosPushFileSchema, run: async (a) => ({ ...(await iosPushFile(a as never)) }) },
};

async function runCapability(capability: string, args: unknown): Promise<{ status: number; body: unknown }> {
  if (!capability || !isAllowed(capability)) {
    return { status: 403, body: { error: `capability not allowed: ${capability ?? "missing"}` } };
  }
  const entry = DISPATCH[capability];
  if (!entry) {
    return { status: 501, body: { error: `not_implemented: ${capability}`, registration: registrationPayload() } };
  }
  const parsed = entry.schema.safeParse(args);
  if (!parsed.success) {
    return { status: 400, body: { error: `invalid args for ${capability}`, issues: parsed.error.issues } };
  }
  try {
    const result = await entry.run(parsed.data);
    return { status: 200, body: { ok: true, capability, ...result, registration: registrationPayload() } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "capability failed";
    const refused = /refus|not allowed|blocked|escapes|unknown application|unsupported type|too large|binary/i.test(message);
    return { status: refused ? 403 : 500, body: { error: message } };
  }
}

// Dev-only direct test route for create_document (no dispatch envelope needed).
app.post("/capabilities/create_document", requireAgentAuth, async (req, res) => {
  const parsed = CreateDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid input", issues: parsed.error.issues });
  }
  try {
    const result = await createDocument(parsed.data);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "create failed" });
  }
});

app.post("/jobs/dispatch", requireAgentAuth, async (req, res) => {
  const { capability, args } = req.body as { capability?: string; args?: unknown };
  const out = await runCapability(capability ?? "", args);
  return res.status(out.status).json(out.body);
});

const port = Number(process.env.AGENT_PORT ?? 3001);
if (process.env.NODE_ENV !== "test") {
  loadEnv();
  requireAgentToken();
  // Localhost-only: the core reaches the agent over loopback. Never expose
  // this port remotely — remote cores require the post-v1 outbound relay.
  app.listen(port, "127.0.0.1", () => console.log(`windows-agent on 127.0.0.1:${port}`));
  startHeartbeat();
}

export default app;
