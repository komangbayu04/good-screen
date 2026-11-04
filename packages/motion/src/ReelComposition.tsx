import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
// @remotion/media works in the Player, server renders and the in-browser web renderer
// (Html5Video / Html5Audio are not supported by the web renderer).
import { Audio, Video } from "@remotion/media";
import {
  DEFAULT_ADJUST,
  DEFAULT_ANIM_DURATION,
  DEFAULT_TRANSFORM,
  followOrigin,
  propAt,
  type Asset,
  type Clip,
  type Project,
  type TrackKind,
} from "@goodscreen/editor-core";
import { MotionLayer } from "./MotionLayer";
import { CaptionLayer } from "./CaptionLayer";
import { NO_ZOOM, ScreenStage, zoomAt } from "./screen";

export type ReelProps = { project: Project };

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Renders a project. Same component drives the in-browser Player and server renders. */
export function ReelComposition({ project }: ReelProps) {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const t = frame / fps;

  const track = (kind: TrackKind) => project.tracks.find((tr) => tr.kind === kind);
  const clipsOf = (kind: TrackKind) => {
    const tr = track(kind);
    if (!tr || tr.hidden) return [] as Clip[];
    return project.clips.filter((c) => c.trackId === tr.id).sort((a, b) => a.start - b.start);
  };
  const assetOf = (c: Clip) => project.assets.find((a) => a.id === c.assetId);
  // Overlay layers back to front (Layer 1 first); any layer can hold captions, motion or zoom.
  const layers = project.tracks
    .filter((tr) => tr.kind === "layer" && !tr.hidden)
    .reverse()
    .map((tr) => project.clips.filter((c) => c.trackId === tr.id).sort((a, b) => a.start - b.start));
  const overlay = layers.flat();

  // Zoom-punch motion clips scale the whole video layer.
  const punch = overlay
    .filter((c) => c.motion?.template === "zoom-punch" && t >= c.start && t < c.start + c.duration)
    .reduce((s, c) => {
      const p = (t - c.start) / c.duration;
      const amount = typeof c.motion!.props.amount === "number" ? c.motion!.props.amount : 1.25;
      return s * interpolate(p, [0, 0.15, 1], [1, amount, 1], { extrapolateRight: "clamp" });
    }, 1);

  // Zoom track: drives the screen frame of screen recordings, or the whole video layer otherwise.
  const screenClip = clipsOf("video").find((c) => c.screen && t >= c.start && t < c.start + c.duration);
  const screenActive = !!screenClip;
  // Following zooms look at the pointer of the screen recording playing at that moment.
  const pointer = screenClip ? assetOf(screenClip)?.cursor : undefined;
  const src = (at: number) => (screenClip ? screenClip.offset + (at - screenClip.start) * (screenClip.speed ?? 1) : at);
  const zoom = zoomAt(overlay.filter((c) => c.zoom), t, fps, (at, z) =>
    screenClip && pointer ? followOrigin(pointer, src(z.start), src(z.start + z.duration), z.zoom!.scale, src(at)) : null,
  );
  const layerZoom = screenActive ? NO_ZOOM : zoom;

  const seq = (c: Clip) => ({
    from: Math.round(c.start * fps),
    durationInFrames: Math.max(1, Math.round(c.duration * fps)),
  });

  return (
    <AbsoluteFill style={{ background: "#000", fontFamily: "var(--font-sans-ui), system-ui, sans-serif" }}>
      <AbsoluteFill
        style={{
          transform: `scale(${punch * layerZoom.scale})`,
          transformOrigin: `${layerZoom.x * 100}% ${layerZoom.y * 100}%`,
          filter: layerZoom.blur > 0.3 ? `blur(${layerZoom.blur}px)` : undefined,
        }}
      >
        {clipsOf("video").map((c) => {
          const asset = assetOf(c);
          const { durationInFrames } = seq(c);
          const fit = c.transform?.fit === "fit" ? "contain" : "cover";
          return (
            <Sequence key={c.id} {...seq(c)} premountFor={fps}>
              <ClipFrame clip={c} frames={durationInFrames}>
                {c.screen && asset?.kind === "video" && asset.src ? (
                  <ScreenStage
                    clip={c}
                    screen={asset}
                    camera={c.screen.camera ? project.assets.find((a) => a.id === c.screen!.camera!.assetId) : undefined}
                    assets={project.assets}
                    zoom={zoom}
                    muted={!!track("video")?.muted}
                    volume={c.volume ?? 1}
                  />
                ) : asset?.kind === "video" && asset.src ? (
                  <ClipVideo clip={c} src={asset.src} frames={durationInFrames} muted={!!track("video")?.muted} fit={fit} />
                ) : asset?.kind === "image" && asset.src ? (
                  <Img src={asset.src} style={{ width: "100%", height: "100%", objectFit: fit }} />
                ) : (
                  <AbsoluteFill style={{ background: "#18181b" }} />
                )}
              </ClipFrame>
            </Sequence>
          );
        })}
      </AbsoluteFill>

      {!track("audio")?.muted &&
        clipsOf("audio").map((c) => {
          const asset = assetOf(c);
          if (!asset?.src) return null;
          return (
            <Sequence key={c.id} {...seq(c)} premountFor={fps}>
              <ClipAudio clip={c} src={asset.src} frames={seq(c).durationInFrames} />
            </Sequence>
          );
        })}

      {layers.flat().map((c) =>
        c.motion ? (
          <Sequence key={c.id} {...seq(c)}>
            <ClipFrame clip={c} frames={seq(c).durationInFrames}>
              <MotionLayer motion={c.motion} />
            </ClipFrame>
          </Sequence>
        ) : c.text !== undefined ? (
          <Sequence key={c.id} {...seq(c)}>
            <ClipFrame clip={c} frames={seq(c).durationInFrames}>
              <CaptionLayer clipId={c.id} text={c.text} style={c.captionStyle} size={c.captionSize} y={c.captionY} color={c.captionColor} />
            </ClipFrame>
          </Sequence>
        ) : assetOf(c)?.src && (assetOf(c)!.kind === "image" || assetOf(c)!.kind === "video") ? (
          // Image / video on a layer: an overlay that sits on top of the footage and moves freely.
          <Sequence key={c.id} {...seq(c)} premountFor={fps}>
            <ClipFrame clip={c} frames={seq(c).durationInFrames} overlay>
              <OverlayMedia clip={c} asset={assetOf(c)!} frames={seq(c).durationInFrames} muted={false} />
            </ClipFrame>
          </Sequence>
        ) : null,
      )}
    </AbsoluteFill>
  );
}

/**
 * Overlay media keeps its own shape (no cropping to the frame): fitted inside the frame
 * and centred, so the clip transform moves and scales the picture itself. Its box is
 * what the editor hit-tests and outlines.
 */
function OverlayMedia({ clip, asset, frames, muted }: { clip: Clip; asset: Asset; frames: number; muted: boolean }) {
  const { width: W, height: H, fps } = useVideoConfig();
  const volume = useClipVolume(clip, frames);
  const aspect = asset.width && asset.height ? asset.width / asset.height : 1;
  const w = Math.min(W, H * aspect);
  const h = w / aspect;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div data-clip-box={clip.id} style={{ width: w, height: h, overflow: "hidden" }}>
        {asset.kind === "image" ? (
          <Img src={asset.src!} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        ) : (
          <Video
            src={asset.src!}
            trimBefore={Math.round(clip.offset * fps)}
            playbackRate={clip.speed ?? 1}
            volume={volume}
            muted={muted}
            objectFit="contain"
            style={{ width: "100%", height: "100%" }}
          />
        )}
      </div>
    </AbsoluteFill>
  );
}

/** Audio level for a clip at the current frame: base volume shaped by fade in/out. */
function useClipVolume(clip: Clip, frames: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const base = clip.keyframes?.volume ? propAt(clip, "volume", clip.offset + (frame / fps) * (clip.speed ?? 1)) : (clip.volume ?? 1);
  const fadeIn = (clip.fadeIn ?? 0) * fps;
  const fadeOut = (clip.fadeOut ?? 0) * fps;
  const inGain = fadeIn > 0 ? interpolate(frame, [0, fadeIn], [0, 1], clamp) : 1;
  const outGain = fadeOut > 0 ? interpolate(frame, [frames - fadeOut, frames], [1, 0], clamp) : 1;
  return base * inGain * outGain;
}

function ClipVideo({ clip, src, frames, muted, fit }: { clip: Clip; src: string; frames: number; muted: boolean; fit: "cover" | "contain" }) {
  const { fps } = useVideoConfig();
  const volume = useClipVolume(clip, frames);
  return (
    <Video
      src={src}
      trimBefore={Math.round(clip.offset * fps)}
      playbackRate={clip.speed ?? 1}
      volume={volume}
      muted={muted}
      objectFit={fit}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

function ClipAudio({ clip, src, frames }: { clip: Clip; src: string; frames: number }) {
  const { fps } = useVideoConfig();
  const volume = useClipVolume(clip, frames);
  return <Audio src={src} trimBefore={Math.round(clip.offset * fps)} playbackRate={clip.speed ?? 1} volume={volume} />;
}

/**
 * Wraps any visual clip: in/out animation on the outside, then transform
 * (position, scale, rotation, flip, opacity) and colour adjustments.
 */
function ClipFrame({ clip, frames, children, overlay }: { clip: Clip; frames: number; children: ReactNode; overlay?: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tf = { ...DEFAULT_TRANSFORM, ...clip.transform };
  const adj = { ...DEFAULT_ADJUST, ...clip.adjust };
  // Keyframed properties override their static values at this frame.
  if (clip.keyframes) {
    const src = clip.offset + (frame / fps) * (clip.speed ?? 1);
    for (const p of ["x", "y", "scale", "rotate", "opacity"] as const) if (clip.keyframes[p]) tf[p] = propAt(clip, p, src);
    for (const p of ["brightness", "contrast", "saturation", "hue", "blur"] as const) if (clip.keyframes[p]) adj[p] = propAt(clip, p, src);
  }

  // In / out progress, 0 -> 1.
  const inFrames = Math.max(1, Math.round((clip.transitionInDuration ?? DEFAULT_ANIM_DURATION) * fps));
  const outFrames = Math.max(1, Math.round((clip.transitionOutDuration ?? DEFAULT_ANIM_DURATION) * fps));
  const pIn = interpolate(frame, [0, inFrames], [0, 1], clamp);
  const pOut = interpolate(frame, [frames - outFrames, frames], [0, 1], clamp);

  let opacity = 1;
  let blur = 0;
  const parts: string[] = [];
  switch (clip.transitionIn ?? "none") {
    case "fade":
      opacity *= pIn;
      break;
    case "slide":
      parts.push(`translateX(${(1 - pIn) * 100}%)`);
      break;
    case "slide-up":
      parts.push(`translateY(${(1 - pIn) * 30}%)`);
      opacity *= pIn;
      break;
    case "zoom":
      parts.push(`scale(${1.3 - 0.3 * pIn})`);
      opacity *= pIn;
      break;
    case "pop":
      parts.push(`scale(${0.6 + 0.4 * spring({ frame, fps, durationInFrames: inFrames, config: { damping: 11, stiffness: 180 } })})`);
      opacity *= Math.min(1, pIn * 2);
      break;
    case "blur":
      blur += (1 - pIn) * 24;
      opacity *= pIn;
      break;
  }
  switch (clip.transitionOut ?? "none") {
    case "fade":
      opacity *= 1 - pOut;
      break;
    case "slide":
      parts.push(`translateX(${-pOut * 100}%)`);
      break;
    case "slide-down":
      parts.push(`translateY(${pOut * 30}%)`);
      opacity *= 1 - pOut;
      break;
    case "zoom":
      parts.push(`scale(${1 - 0.2 * pOut})`);
      opacity *= 1 - pOut;
      break;
    case "blur":
      blur += pOut * 24;
      opacity *= 1 - pOut;
      break;
  }

  const kb = clip.kenBurns ? interpolate(frame, [0, frames], [1, 1.12]) : 1;
  // Blend sits on the outermost layer so it mixes with the tracks underneath.
  const blendMode = tf.blendMode !== "normal" ? tf.blendMode : undefined;
  const animStyle: CSSProperties = {
    opacity,
    transform: parts.join(" ") || undefined,
    filter: blur ? `blur(${blur}px)` : undefined,
    mixBlendMode: blendMode,
  };
  const transformStyle: CSSProperties = {
    opacity: tf.opacity,
    transform: `translate(${tf.x}%, ${tf.y}%) rotate(${tf.rotate}deg) scale(${tf.scale * kb}) scale(${tf.flipH ? -1 : 1}, ${tf.flipV ? -1 : 1})`,
    filter:
      [
        adj.brightness && `brightness(${1 + adj.brightness / 100})`,
        adj.contrast && `contrast(${1 + adj.contrast / 100})`,
        adj.saturation && `saturate(${1 + adj.saturation / 100})`,
        adj.hue && `hue-rotate(${adj.hue}deg)`,
        adj.blur && `blur(${adj.blur}px)`,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
  };

  return (
    <AbsoluteFill style={animStyle}>
      {/* Footage is hit-tested on its transformed frame; overlays mark their own boxes. */}
      <AbsoluteFill style={transformStyle} data-clip-box={clip.assetId && !clip.screen && !clip.motion && !overlay ? clip.id : undefined}>
        {children}
      </AbsoluteFill>
      {clip.transitionIn === "flash" && <AbsoluteFill style={{ background: "#fff", opacity: 1 - pIn }} />}
    </AbsoluteFill>
  );
}
