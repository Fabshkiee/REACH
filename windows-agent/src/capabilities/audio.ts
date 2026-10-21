import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { z } from "zod";
import { assertAllowedPath } from "../sandbox.js";

/**
 * Audio capture and reading for the laptop agent.
 *
 * The transcription itself runs in the core (that is where the AWS
 * credentials live); the AGENT owns the filesystem, so the bytes are read
 * here — through the same deny-pattern guard as every other file — and
 * handed across the existing device channel.
 */

/** Largest audio file we will read for transcription (50MB ≈ 5 hours of mp3). */
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

/** Amazon Transcribe's accepted media formats, keyed by file extension. */
const MEDIA_FORMATS: Record<string, string> = {
  ".mp3": "mp3",
  ".mpga": "mp3",
  ".mpeg": "mp3",
  ".wav": "wav",
  ".m4a": "mp4",
  ".mp4": "mp4",
  ".flac": "flac",
  ".ogg": "ogg",
  ".webm": "webm",
  ".amr": "amr",
};

export const AudioReadSchema = z.object({
  path: z.string().min(1).max(2000),
});
export type AudioReadInput = z.input<typeof AudioReadSchema>;

export const AudioCaptureSchema = z.object({
  /** Seconds to record. */
  seconds: z.number().int().min(1).max(3600).default(60),
  /** Where to save the recording. Defaults to the REACH work folder. */
  path: z.string().max(2000).optional(),
  /** ffmpeg avfoundation input device, e.g. ":0" for the first microphone. */
  device: z.string().max(20).optional(),
});
export type AudioCaptureInput = z.input<typeof AudioCaptureSchema>;

/**
 * Read a local recording as bytes, for the core to hand to Amazon
 * Transcribe. The path goes through the agent's deny-pattern guard, so
 * system locations, other users' data and credential files are refused
 * exactly as they are for every other file.
 */
export async function readAudioBytes(input: AudioReadInput): Promise<{
  path: string;
  mediaFormat: string;
  mimeType: string;
  size: number;
  bytesBase64: string;
}> {
  const parsed = AudioReadSchema.parse(input);
  const abs = assertAllowedPath(parsed.path);
  const st = await stat(abs);
  if (!st.isFile()) throw new Error(`not a file: ${abs} — audio.transcribe needs a recording file`);
  if (st.size > MAX_AUDIO_BYTES) {
    throw new Error(`audio file too large (${st.size} bytes, cap ${MAX_AUDIO_BYTES}) — record a shorter clip or split it`);
  }
  if (st.size === 0) throw new Error(`audio file is empty: ${abs}`);

  const ext = extname(abs).toLowerCase();
  const mediaFormat = MEDIA_FORMATS[ext];
  if (!mediaFormat) {
    throw new Error(
      `unsupported audio format "${ext || "(none)"}" — Amazon Transcribe accepts mp3, wav, m4a/mp4, flac, ogg, webm, amr. Convert it first (e.g. ffmpeg -i in.mov -vn -ac 1 out.mp3).`,
    );
  }
  const buf = await readFile(abs);
  return {
    path: abs,
    mediaFormat,
    mimeType: `audio/${mediaFormat}`,
    size: st.size,
    bytesBase64: buf.toString("base64"),
  };
}

/**
 * Record from a microphone with ffmpeg (macOS/Linux). Uses avfoundation on
 * darwin and the default ALSA device elsewhere. The recording is written to
 * the user's own space and is never uploaded without an explicit approval
 * (audio.transcribe is a confirm-tier action).
 */
export async function captureAudio(input: AudioCaptureInput): Promise<{
  path: string;
  seconds: number;
  bytes: number;
  mediaFormat: string;
}> {
  const parsed = AudioCaptureSchema.parse(input);
  const { spawn } = await import("node:child_process");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");
  const { mkdir } = await import("node:fs/promises");

  const dir = join(homedir(), "Documents", "REACH", "recordings");
  await mkdir(dir, { recursive: true });
  const name = `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`;
  const out = join(dir, name);

  const args =
    process.platform === "darwin"
      ? ["-hide_banner", "-loglevel", "error", "-f", "avfoundation", "-i", parsed.device ?? ":0", "-t", String(parsed.seconds), "-ac", "1", "-ar", "16000", "-y", out]
      : ["-hide_banner", "-loglevel", "error", "-f", "alsa", "-i", parsed.device ?? "default", "-t", String(parsed.seconds), "-ac", "1", "-ar", "16000", "-y", out];

  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.once("error", (err) => reject(new Error(`ffmpeg failed to start: ${err.message} — is ffmpeg installed?`)));
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`recording failed (ffmpeg exit ${code}): ${stderr.trim().split("\n").pop() ?? ""}`));
    });
  });

  const st = await stat(out);
  return { path: out, seconds: parsed.seconds, bytes: st.size, mediaFormat: "wav" };
}
