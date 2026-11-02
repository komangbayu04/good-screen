import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { MotionSpec } from "@goodscreen/editor-core";

const str = (v: unknown, d: string) => (typeof v === "string" && v ? v : d);
const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export function MotionLayer({ motion }: { motion: MotionSpec }) {
  switch (motion.template) {
    case "kinetic-title":
      return <KineticTitle text={str(motion.props.text, "TITLE")} accent={str(motion.props.accent, "#ff7a1a")} />;
    case "lower-third":
      return <LowerThird title={str(motion.props.title, "")} subtitle={str(motion.props.subtitle, "")} accent={str(motion.props.accent, "#a78bfa")} />;
    case "progress-bar":
      return <ProgressBar color={str(motion.props.color, "#ff7a1a")} />;
    case "emoji-pop":
      return <EmojiPop emoji={str(motion.props.emoji, "\u{1F525}")} x={num(motion.props.x, 0.75)} y={num(motion.props.y, 0.3)} />;
    case "flash":
      return <Flash color={str(motion.props.color, "#ffffff")} />;
    case "zoom-punch":
      return null; // applied to the video layer by ReelComposition
  }
}

function KineticTitle({ text, accent }: { text: string; accent: string }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const words = text.split(/\s+/).filter(Boolean);
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 80, opacity: out }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 28px", transform: "rotate(-3deg)" }}>
        {words.map((w, i) => {
          const s = spring({ frame: frame - i * 4, fps, config: { damping: 12, stiffness: 180 } });
          return (
            <span
              key={i}
              style={{
                fontSize: 150,
                fontWeight: 900,
                lineHeight: 1,
                textTransform: "uppercase",
                letterSpacing: -4,
                color: i % 2 ? accent : "#fff",
                textShadow: "0 10px 40px rgba(0,0,0,.6)",
                transform: `translateY(${(1 - s) * 120}px) scale(${0.6 + s * 0.4})`,
                opacity: s,
                display: "inline-block",
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function LowerThird({ title, subtitle, accent }: { title: string; subtitle: string; accent: string }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 16 } });
  const out = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", padding: "0 100px 420px", opacity: out }}>
      <div style={{ position: "relative", transform: `translateX(${(1 - s) * -800}px)` }}>
        <div style={{ width: 14, height: 130, background: accent, position: "absolute", left: -34, top: 6 }} />
        <div style={{ fontSize: 72, fontWeight: 800, color: "#fff", textShadow: "0 6px 30px rgba(0,0,0,.7)" }}>{title}</div>
        <div style={{ fontSize: 44, fontWeight: 500, color: accent, marginTop: 6 }}>{subtitle}</div>
      </div>
    </AbsoluteFill>
  );
}

function ProgressBar({ color }: { color: string }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = interpolate(frame, [0, durationInFrames], [0, 100], clamp);
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 16, background: "rgba(255,255,255,.2)" }}>
        <div style={{ width: `${p}%`, height: "100%", background: color }} />
      </div>
    </AbsoluteFill>
  );
}

function EmojiPop({ emoji, x, y }: { emoji: string; x: number; y: number }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 8, stiffness: 200 } });
  const out = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], clamp);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          fontSize: 260,
          opacity: out,
          transform: `translate(-50%,-50%) scale(${s}) rotate(${(1 - s) * -40}deg)`,
        }}
      >
        {emoji}
      </div>
    </AbsoluteFill>
  );
}

function Flash({ color }: { color: string }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const o = interpolate(frame, [0, 2, Math.max(3, durationInFrames)], [0, 0.9, 0], { ...clamp, easing: Easing.out(Easing.quad) });
  return <AbsoluteFill style={{ background: color, opacity: o }} />;
}
