import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";

interface HudOverlayProps {
  badgeTitle?: string;
  actionList?: string[];
  activeStep?: number;
  highlightText?: string;
}

export const HudOverlay: React.FC<HudOverlayProps> = ({
  badgeTitle = "REACH MESH PLANNER",
  actionList = [],
  activeStep = 0,
  highlightText,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const anim = spring({
    frame,
    fps,
    config: { damping: 14 },
  });

  return (
    <div
      style={{
        position: "absolute",
        top: 48,
        right: 48,
        opacity: anim,
        transform: `translateY(${(1 - anim) * -20}px)`,
        background: "rgba(15, 23, 42, 0.88)",
        backdropFilter: "blur(18px)",
        border: "1px solid rgba(56, 189, 248, 0.28)",
        borderRadius: 18,
        padding: "18px 24px",
        minWidth: 320,
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5), 0 0 24px rgba(56, 189, 248, 0.15)",
        fontFamily: "'JetBrains Mono', 'Inter', monospace",
        color: "#f8fafc",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: "#10b981",
              boxShadow: "0 0 8px #10b981",
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#38bdf8", letterSpacing: "0.06em" }}>
            {badgeTitle}
          </span>
        </div>
        <span style={{ fontSize: 11, color: "#64748b" }}>MCP 2026</span>
      </div>

      {actionList.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {actionList.map((action, idx) => {
            const isCurrent = idx === activeStep;
            const isDone = idx < activeStep;
            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 13,
                  color: isCurrent ? "#38bdf8" : isDone ? "#10b981" : "#64748b",
                  fontWeight: isCurrent ? 600 : 400,
                }}
              >
                <span>{isDone ? "✓" : isCurrent ? "▶" : "·"}</span>
                <span>{action}</span>
              </div>
            );
          })}
        </div>
      )}

      {highlightText && (
        <div
          style={{
            marginTop: 10,
            padding: "6px 10px",
            background: "rgba(56, 189, 248, 0.1)",
            borderLeft: "3px solid #38bdf8",
            borderRadius: 4,
            fontSize: 12,
            color: "#e2e8f0",
          }}
        >
          {highlightText}
        </div>
      )}
    </div>
  );
};
