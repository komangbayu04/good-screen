import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionStyle } from "@goodscreen/editor-core";

export const CAPTION_DEFAULT_Y = 27; // % of frame height from the bottom

export function CaptionLayer({
  clipId,
  text,
  style = "bold",
  size = 1,
  y = CAPTION_DEFAULT_Y,
  color = "#ffffff",
}: {
  /** Marks the text box so the editor can hit-test and outline it on the canvas. */
  clipId?: string;
  text: string;
  style?: CaptionStyle;
  size?: number;
  y?: number;
  color?: string;
}) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, height } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 220 } });
  const words = text.split(/\s+/).filter(Boolean);
  const active = Math.min(words.length - 1, Math.floor((frame / durationInFrames) * words.length));
  const boxed = style === "boxed";

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", padding: `0 70px ${(y / 100) * height}px` }}>
      <div
        data-clip-box={clipId}
        style={{
          transform: `scale(${0.85 + pop * 0.15})`,
          textAlign: "center",
          fontSize: 96 * size,
          fontWeight: 900,
          lineHeight: 1.1,
          color,
          textTransform: boxed ? "none" : "uppercase",
          WebkitTextStroke: style === "bold" ? "3px #000" : undefined,
          textShadow: boxed ? undefined : "0 8px 24px rgba(0,0,0,.8)",
          background: boxed ? "rgba(0,0,0,.72)" : undefined,
          padding: boxed ? "18px 30px" : undefined,
          borderRadius: boxed ? 24 : undefined,
        }}
      >
        {style === "karaoke"
          ? words.map((w, i) => (
              <span key={i} style={{ color: i === active ? "#ff7a1a" : color, marginRight: 18 * size }}>
                {w}
              </span>
            ))
          : text}
      </div>
    </AbsoluteFill>
  );
}
