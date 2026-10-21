import { z } from "zod";
import type { S3Client } from "@aws-sdk/client-s3";
import { defineAction } from "../executor/registry.js";
import { callAgent } from "./agent.js";

/**
 * Transcription: a local recording on the laptop becomes text, using Amazon
 * Transcribe.
 *
 * The split follows the architecture: the AGENT owns the filesystem (it reads
 * the bytes, through the same deny-pattern guard as every other file) and the
 * CORE owns the cloud (it holds the AWS credentials and runs the S3 +
 * Transcribe call). Nothing else in the system has to be trusted with either.
 *
 * Uploading a recording to a third party is data leaving the machine, so the
 * action is `upload` class — policy CONFIRMS it, quoting the exact file, and
 * the user approves that specific recording.
 */

const DEFAULT_BUCKET = "reach-dev-transcribe-682544514325";
const DEFAULT_REGION = "us-east-1";

function bucketName(): string {
  return process.env.REACH_TRANSCRIBE_BUCKET ?? DEFAULT_BUCKET;
}
function region(): string {
  return process.env.AWS_REGION ?? DEFAULT_REGION;
}

/** Largest audio we will push through Transcribe (Transcribe's own cap is 5h). */
const MAX_TRANSCRIBE_BYTES = 200 * 1024 * 1024;

/**
 * Read the transcript object.
 *
 * Transcribe returns EITHER a presigned https URL (when it owns the output
 * bucket) or a PLAIN S3 URL (when OutputBucketName is set) — and a plain
 * URL fetched without a signature is 403. So: use the signature when there
 * is one, otherwise read the object with our own credentials.
 */
async function readTranscript(uri: string, s3: S3Client, bucket: string): Promise<string> {
  if (uri.includes("?")) {
    const res = await fetch(uri);
    if (res.ok) return res.text();
  }
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  // The URI path is /<bucket>/<key> — the bucket is part of the path, so it
  // must be stripped before the remainder is used as the object key.
  const path = uri.split(".amazonaws.com/")[1]?.split("?")[0] ?? "";
  const parts = path.split("/").filter(Boolean);
  const key = parts.slice(1).join("/");
  if (!key) throw new Error("could not derive the transcript object key from the Transcribe URI");
  const obj = await s3.send(new GetObjectCommand({ Bucket: parts[0] ?? bucket, Key: key }));
  const body = obj.Body;
  if (!body) throw new Error("transcript file was empty in S3");
  return body.transformToString();
}

export function registerAudioActions(): void {
  try {
    defineAction({
      name: "audio.record",
      actionClass: "record",
      description:
        "Record from this laptop's microphone and save the recording locally. Use it when the user asks you to record a meeting, a voice note or an interview — then transcribe it with audio.transcribe and write the minutes. The recording stays on the laptop unless the user approves uploading it. Recording captures the room, so the user is asked to approve it first.",
      schema: z.object({
        seconds: z.number().int().min(1).max(3600).optional().describe("How long to record (default 60s)"),
        path: z.string().max(2000).optional().describe("Where to save the recording (defaults to Documents/REACH/recordings)"),
      }),
      timeoutMs: 600_000,
      targetOf: (args) => (typeof args["path"] === "string" ? args["path"] : "the microphone"),
      verify: (result) => {
        const r = result as { ok?: boolean; path?: unknown; bytes?: unknown; error?: unknown };
        if (!(r && typeof r === "object" && r.ok === true)) {
          throw new Error(typeof r?.error === "string" ? r.error : "recording did not report ok");
        }
        return `recorded ${String(r.bytes ?? 0)} bytes to ${String(r.path ?? "the recordings folder")}`;
      },
      handler: async (args) => {
        const out = (await callAgent("capture_audio", {
          ...(typeof args["seconds"] === "number" ? { seconds: args["seconds"] } : {}),
          ...(typeof args["path"] === "string" ? { path: args["path"] } : {}),
        })) as { ok?: boolean; error?: string; path?: string; seconds?: number; bytes?: number };
        if (!out?.ok) throw new Error(`recording failed: ${out?.error ?? "unknown error"}`);
        return { ok: true, path: out.path, seconds: out.seconds, bytes: out.bytes };
      },
    });
  } catch {
    // Already registered (dev re-entry).
  }

  try {
    defineAction({
      name: "audio.transcribe",
      actionClass: "upload",
      description:
        "Transcribe a local audio recording with Amazon Transcribe. The recording must be a file on this laptop (.mp3, .wav, .m4a, .flac, .ogg, .webm, .amr). The file is read from the device, uploaded to S3, transcribed, and the TEXT comes back — the audio is deleted from S3 afterwards. This sends the recording to a third-party service, so the user is asked to approve the exact file first. Use it for meeting recordings, voice notes and interviews; then write the minutes with files.create_document.",
      schema: z.object({
        path: z.string().min(1).max(2000).describe("Path to the recording on this laptop"),
        languageCode: z.string().max(16).optional().describe("BCP-47 language code (default en-US)"),
      }),
      timeoutMs: 600_000,
      externalWait: true,
      targetOf: (args) => (typeof args["path"] === "string" ? args["path"] : undefined),
      verify: (result) => {
        const r = result as { transcript?: unknown; ok?: unknown; error?: unknown };
        if (!(r && typeof r === "object" && r.ok === true)) {
          throw new Error(typeof r?.error === "string" ? r.error : "transcription did not report ok");
        }
        const text = typeof r.transcript === "string" ? r.transcript.trim() : "";
        if (!text) throw new Error("transcription returned no text");
        return `transcribed ${text.length} chars`;
      },
      handler: async (args) => {
        const path = String(args["path"]);
        const languageCode = typeof args["languageCode"] === "string" ? args["languageCode"] : "en-US";

        // 1. The device reads the recording (it owns the filesystem).
        const audio = (await callAgent("read_audio", { path })) as {
          ok?: boolean;
          error?: string;
          bytesBase64?: string;
          mediaFormat?: string;
          size?: number;
        };
        if (!audio?.ok || !audio.bytesBase64 || !audio.mediaFormat) {
          throw new Error(`could not read the recording: ${audio?.error ?? "unknown error"}`);
        }
        const bytes = Buffer.from(audio.bytesBase64, "base64");
        if (bytes.length > MAX_TRANSCRIBE_BYTES) {
          throw new Error(`recording too large for Transcribe (${bytes.length} bytes, cap ${MAX_TRANSCRIBE_BYTES})`);
        }

        const { S3Client, CreateBucketCommand, PutObjectCommand, DeleteObjectCommand, HeadBucketCommand } =
          await import("@aws-sdk/client-s3");
        const { TranscribeClient, StartTranscriptionJobCommand, GetTranscriptionJobCommand, DeleteTranscriptionJobCommand } =
          await import("@aws-sdk/client-transcribe");

        const bucket = bucketName();
        const key = `reach/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${audio.mediaFormat}`;
        const outPrefix = `reach/out/`;
        const s3 = new S3Client({ region: region() });
        const tr = new TranscribeClient({ region: region() });
        const jobName = `reach-${Date.now()}`;

        let uploaded = false;
        try {
          // 2. Make sure the bucket exists (dev convenience; it is private).
          try {
            await s3.send(new HeadBucketCommand({ Bucket: bucket }));
          } catch {
            await s3.send(new CreateBucketCommand({ Bucket: bucket }));
          }
          await s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: bytes,
              ContentType: `audio/${audio.mediaFormat}`,
            }),
          );
          uploaded = true;

          // 3. Transcribe. The job is asynchronous — this is the wait that
          //    does not count against the task's own budget.
          await tr.send(
            new StartTranscriptionJobCommand({
              TranscriptionJobName: jobName,
              Media: { MediaFileUri: `s3://${bucket}/${key}` },
              MediaFormat: audio.mediaFormat as never,
              LanguageCode: languageCode as never,
              OutputBucketName: bucket,
              OutputKey: outPrefix,
            }),
          );

          let status = "IN_PROGRESS";
          let failure: string | undefined;
          for (let i = 0; i < 300; i++) {
            await new Promise((r) => setTimeout(r, 4000));
            const res = await tr.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }));
            status = res.TranscriptionJob?.TranscriptionJobStatus ?? "IN_PROGRESS";
            failure = res.TranscriptionJob?.FailureReason;
            if (status === "COMPLETED" || status === "FAILED") break;
          }
          if (status !== "COMPLETED") {
            throw new Error(`transcription ${status.toLowerCase()}${failure ? `: ${failure}` : ""}`);
          }

          // 4. Read the transcript back. The URI Transcribe returns is
          //    PRESIGNED (it carries a query string), so it is fetched
          //    directly — deriving an object key from it would include the
          //    signature and miss the object entirely.
          const res = await tr.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }));
          const uri = res.TranscriptionJob?.Transcript?.TranscriptFileUri;
          if (!uri) throw new Error("transcription completed but returned no transcript file");
          const raw = await readTranscript(uri, s3, bucket);
          let transcript = raw;
          try {
            const parsed = JSON.parse(raw) as { results?: { transcripts?: Array<{ transcript?: string }> } };
            transcript = (parsed.results?.transcripts ?? []).map((t) => t.transcript ?? "").join(" ");
          } catch {
            // Not the JSON envelope — use the raw text.
          }
          return { ok: true, transcript: transcript.trim(), jobName, languageCode, seconds: bytes.length };
        } finally {
          // 5. The audio does not stay in the cloud. The transcript is the
          //    deliverable; the recording is deleted.
          if (uploaded) {
            try {
              await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
            } catch {
              /* best effort */
            }
          }
          try {
            await tr.send(new DeleteTranscriptionJobCommand({ TranscriptionJobName: jobName }));
          } catch {
            /* best effort */
          }
        }
      },
    });
  } catch {
    // Already registered (dev re-entry) — definitions are stable.
  }
}
