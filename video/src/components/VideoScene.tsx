import React, { useState } from "react";
import { staticFile, Video } from "remotion";

interface VideoSceneProps {
  fileName: string;
  shotTitle: string;
  description: string;
  fallbackGradient?: string;
}

export const VideoScene: React.FC<VideoSceneProps> = ({
  fileName,
  shotTitle,
  description,
  fallbackGradient = "linear-gradient(135deg, #090d16 0%, #111827 50%, #1e1b4b 100%)",
}) => {
  const [hasError, setHasError] = useState(false);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        backgroundColor: "#030712",
      }}
    >
      {!hasError && (
        <Video
          src={staticFile(fileName)}
          onError={() => setHasError(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}

      {hasError && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: fallbackGradient,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 60,
            textAlign: "center",
            color: "#f8fafc",
            fontFamily: "'Inter', sans-serif",
          }}
        >
          <div
            style={{
              padding: "6px 16px",
              background: "rgba(56, 189, 248, 0.15)",
              border: "1px solid rgba(56, 189, 248, 0.4)",
              borderRadius: 999,
              fontSize: 14,
              fontWeight: 600,
              color: "#38bdf8",
              marginBottom: 20,
              letterSpacing: "0.08em",
            }}
          >
            RAW ASSET: assets/video_raw/{fileName}
          </div>
          <h1
            style={{
              fontSize: 48,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              marginBottom: 16,
              maxWidth: 900,
            }}
          >
            {shotTitle}
          </h1>
          <p
            style={{
              fontSize: 22,
              color: "#94a3b8",
              maxWidth: 750,
              lineHeight: 1.5,
            }}
          >
            {description}
          </p>
        </div>
      )}
    </div>
  );
};
