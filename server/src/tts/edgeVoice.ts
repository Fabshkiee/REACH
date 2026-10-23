import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { Request, Response } from "express";

let ttsInstance: MsEdgeTTS | null = null;
let currentVoice = "en-US-JennyNeural";

async function getTts(): Promise<MsEdgeTTS> {
  if (!ttsInstance) {
    ttsInstance = new MsEdgeTTS();
    await ttsInstance.setMetadata(currentVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  }
  return ttsInstance;
}

export interface TtsEmotionPreset {
  pitch?: string;
  rate?: string;
  volume?: string;
}

// Jenny Voice Emotion & Expressive Styles mapping
export const EMOTION_PRESETS: Record<string, TtsEmotionPreset> = {
  natural: { pitch: "+0%", rate: "+0%", volume: "+0%" },
  cheerful: { pitch: "+6%", rate: "+5%", volume: "+0%" },
  excited: { pitch: "+10%", rate: "+12%", volume: "+0%" },
  calm: { pitch: "-4%", rate: "-6%", volume: "+0%" },
  serious: { pitch: "-8%", rate: "-4%", volume: "+0%" },
  urgent: { pitch: "+8%", rate: "+15%", volume: "+0%" },
  friendly: { pitch: "+3%", rate: "+2%", volume: "+0%" },
};

/**
 * Synthesizes speech using Microsoft Jenny Neural AI Voice.
 * Streams 24kHz MP3 back to the caller for ultra-low latency playback.
 */
export async function handleTtsRequest(req: Request, res: Response): Promise<void> {
  const text = typeof req.query.text === "string" ? req.query.text : typeof req.body?.text === "string" ? req.body.text : "";
  const emotion = typeof req.query.emotion === "string" ? req.query.emotion : typeof req.body?.emotion === "string" ? req.body.emotion : "friendly";
  const voice = typeof req.query.voice === "string" ? req.query.voice : typeof req.body?.voice === "string" ? req.body.voice : currentVoice;

  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) {
    res.status(400).json({ error: "missing 'text' parameter" });
    return;
  }

  const preset = EMOTION_PRESETS[emotion.toLowerCase()] ?? EMOTION_PRESETS.friendly;

  try {
    const tts = await getTts();
    if (voice !== currentVoice) {
      currentVoice = voice;
      await tts.setMetadata(currentVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    }

    const { audioStream } = tts.toStream(clean, {
      pitch: preset.pitch ?? "+0%",
      rate: preset.rate ?? "+0%",
      volume: preset.volume ?? "+0%",
    });

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-cache");
    audioStream.pipe(res);

    audioStream.on("error", (err) => {
      console.error("[TTS] Stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "tts synthesis error" });
      }
    });
  } catch (err) {
    console.error("[TTS] Synthesis failed:", err);
    // Re-initialize tts instance if socket crashed
    try {
      ttsInstance?.close();
    } catch {
      // ignore
    }
    ttsInstance = null;
    if (!res.headersSent) {
      res.status(500).json({ error: "failed to synthesize speech" });
    }
  }
}
