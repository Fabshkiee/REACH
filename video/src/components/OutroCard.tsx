import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ReachOrb } from "./ReachOrb";

export const OutroCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    from: 0.88,
    to: 1,
    config: { damping: 14 },
  });

  const opacity = spring({
    frame,
    fps,
    config: { damping: 12 },
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "radial-gradient(ellipse at center, #0f172a 0%, #020617 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "#f8fafc",
        fontFamily: "'Inter', sans-serif",
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <div style={{ marginBottom: 30 }}>
        <ReachOrb size={130} mode="speaking" />
      </div>

      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: "#38bdf8",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          marginBottom: 12,
        }}
      >
        Amazon Bedrock & Alexa+ Hackathon
      </div>

      <h1
        style={{
          fontSize: 64,
          fontWeight: 900,
          letterSpacing: "-0.03em",
          margin: "0 0 16px 0",
          background: "linear-gradient(135deg, #ffffff 30%, #38bdf8 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        REACH
      </h1>

      <p
        style={{
          fontSize: 24,
          color: "#94a3b8",
          maxWidth: 680,
          textAlign: "center",
          lineHeight: 1.45,
          marginBottom: 36,
        }}
      >
        Voice-first intent routing across your personal devices.
        <br />
        Real MCP primitives. Consequential approval gates. Zero mocks.
      </p>

      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {["AWS Bedrock (Claude 3.5 Sonnet)", "Amazon Transcribe", "Amazon S3", "Model Context Protocol", "Microsoft Neural TTS"].map(
          (tech, i) => (
            <div
              key={i}
              style={{
                padding: "8px 18px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(56, 189, 248, 0.3)",
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 600,
                color: "#cbd5e1",
              }}
            >
              {tech}
            </div>
          )
        )}
      </div>
    </div>
  );
};
