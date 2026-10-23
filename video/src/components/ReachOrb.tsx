import React from "react";
import { useCurrentFrame } from "remotion";

interface ReachOrbProps {
  size?: number;
  mode?: "idle" | "listening" | "thinking" | "speaking" | "gate" | "done";
}

export const ReachOrb: React.FC<ReachOrbProps> = ({ size = 140, mode = "listening" }) => {
  const frame = useCurrentFrame();
  const rotation = (frame * 1.5) % 360;
  const pulse = Math.sin(frame * 0.1) * 0.08 + 1;

  const colorMap = {
    idle: "radial-gradient(circle, #38bdf8 0%, #2563eb 50%, #1e1b4b 100%)",
    listening: "radial-gradient(circle, #06b6d4 0%, #3b82f6 45%, #6366f1 80%, #0f172a 100%)",
    thinking: "radial-gradient(circle, #a855f7 0%, #6366f1 45%, #3b82f6 80%, #0f172a 100%)",
    speaking: "radial-gradient(circle, #38bdf8 0%, #06b6d4 40%, #10b981 80%, #0f172a 100%)",
    gate: "radial-gradient(circle, #f59e0b 0%, #ea580c 50%, #7c2d12 100%)",
    done: "radial-gradient(circle, #10b981 0%, #059669 50%, #064e3b 100%)",
  };

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: size * 1.5,
          height: size * 1.5,
          borderRadius: "50%",
          background: colorMap[mode] || colorMap.listening,
          filter: "blur(32px)",
          opacity: 0.55 * pulse,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: size * 1.25,
          height: size * 1.25,
          borderRadius: "50%",
          border: "2px dashed rgba(56, 189, 248, 0.45)",
          transform: `rotate(${rotation}deg)`,
        }}
      />
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: colorMap[mode] || colorMap.listening,
          boxShadow: "0 0 40px rgba(56, 189, 248, 0.6), inset 0 0 20px rgba(255,255,255,0.4)",
          transform: `scale(${pulse})`,
          transition: "transform 0.1s ease",
        }}
      />
    </div>
  );
};
