import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";

interface SubtitleBarProps {
  speaker?: string;
  speakerColor?: string;
  text: string;
  emphasis?: string;
}

export const SubtitleBar: React.FC<SubtitleBarProps> = ({
  speaker = "You",
  speakerColor = "#38bdf8",
  text,
  emphasis,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = spring({
    frame,
    fps,
    config: { damping: 14 },
  });

  const translateY = spring({
    frame,
    fps,
    from: 20,
    to: 0,
    config: { damping: 14 },
  });

  return (
    <div
      style={{
        position: "absolute",
        bottom: 72,
        left: "50%",
        transform: `translateX(-50%) translateY(${translateY}px)`,
        opacity,
        maxWidth: "88%",
        background: "rgba(10, 15, 29, 0.88)",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        borderRadius: 20,
        padding: "16px 28px",
        display: "flex",
        alignItems: "center",
        gap: 18,
        boxShadow: "0 12px 36px rgba(0, 0, 0, 0.45)",
      }}
    >
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: speakerColor,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          padding: "4px 12px",
          background: "rgba(255, 255, 255, 0.06)",
          borderRadius: 8,
          whiteSpace: "nowrap",
        }}
      >
        {speaker}
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 500,
          color: "#f8fafc",
          lineHeight: 1.35,
          fontFamily: "'Inter', -apple-system, sans-serif",
        }}
      >
        {text}
        {emphasis && (
          <span
            style={{
              color: "#38bdf8",
              fontWeight: 700,
              marginLeft: 8,
            }}
          >
            {emphasis}
          </span>
        )}
      </div>
    </div>
  );
};
