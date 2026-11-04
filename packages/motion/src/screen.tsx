import type { CSSProperties } from "react";
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from "remotion";
import { Video } from "@remotion/media";
import { DEFAULT_SCREEN_STYLE, cursorFocusAt, type Asset, type Clip, type ScreenStyle } from "@goodscreen/editor-core";

/** Background presets. Linear gradients only: the in-browser renderer supports those. */
export const SCREEN_BACKGROUNDS: { id: string; label: string; css: string }[] = [
  { id: "dusk", label: "Dusk", css: "linear-gradient(140deg, #ff8a3d 0%, #e2366f 100%)" },
  { id: "ocean", label: "Ocean", css: "linear-gradient(150deg, #38bdf8 0%, #1d4ed8 100%)" },
  { id: "mint", label: "Mint", css: "linear-gradient(150deg, #6ee7b7 0%, #0f766e 100%)" },
  { id: "sunrise", label: "Sunrise", css: "linear-gradient(160deg, #fde68a 0%, #fb923c 100%)" },
  { id: "graphite", label: "Graphite", css: "linear-gradient(160deg, #3f3f46 0%, #0a0a0b 100%)" },
  { id: "paper", label: "Paper", css: "linear-gradient(160deg, #fafafa 0%, #d4d4d8 100%)" },
];

export type ZoomState = { scale: number; x: number; y: number; blur: number };
export const NO_ZOOM: ZoomState = { scale: 1, x: 0.5, y: 0.5, blur: 0 };

const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

function zoomScaleAt(c: Clip, t: number) {
  const z = c.zoom!;
  const local = t - c.start;
  if (local < 0 || local > c.duration) return 1;
  const ease = Math.min(z.ease, c.duration / 2);
  const p = local < ease ? local / ease : local > c.duration - ease ? (c.duration - local) / ease : 1;
  return 1 + (z.scale - 1) * easeInOut(Math.max(0, Math.min(1, p)));
}

/**
 * Zoom at time t from the zoom track, with motion blur proportional to how fast it changes.
 * `follow` gives the pointer focus at a timeline time, for zooms that follow the cursor.
 */
export function zoomAt(zoomClips: Clip[], t: number, fps: number, follow?: (t: number) => { x: number; y: number } | null): ZoomState {
  const active = zoomClips.find((c) => c.zoom && t >= c.start && t <= c.start + c.duration);
  if (!active) return NO_ZOOM;
  const scale = zoomScaleAt(active, t);
  const speed = Math.abs(zoomScaleAt(active, t + 1 / fps) - scale) * fps; // scale units per second
  const focus = (active.zoom!.follow && follow?.(t)) || active.zoom!;
  return { scale, x: focus.x, y: focus.y, blur: Math.min(6, speed * 2.2) };
}

export function backgroundCss(bg: ScreenStyle["background"]): CSSProperties {
  if (bg.kind === "color") return { background: bg.value };
  if (bg.kind === "gradient") return { backgroundImage: (SCREEN_BACKGROUNDS.find((b) => b.id === bg.value) ?? SCREEN_BACKGROUNDS[0]!).css };
  return { background: "#111" };
}

/**
 * A screen recording dressed Screen Studio-style: background, padded frame with
 * rounded corners and shadow, an optional synced webcam, and zoom on the frame.
 */
export function ScreenStage({
  clip,
  screen,
  camera,
  assets,
  zoom,
  muted,
  volume,
}: {
  clip: Clip;
  screen: Asset;
  camera?: Asset;
  assets: Asset[];
  zoom: ZoomState;
  muted: boolean;
  volume: number;
}) {
  const { width: W, height: H, fps } = useVideoConfig();
  const frameNo = useCurrentFrame();
  const style = { ...DEFAULT_SCREEN_STYLE, ...clip.screen };
  const cam = style.camera && camera?.src ? style.camera : undefined;
  const layout = cam?.layout ?? "screen";
  const short = Math.min(W, H);
  const pad = (style.padding / 100) * short;
  const radius = style.radius * (short / 1080);
  const aspect = screen.width && screen.height ? screen.width / screen.height : 16 / 9;
  const trimBefore = Math.round(clip.offset * fps);
  const speed = clip.speed ?? 1;

  // Region the screen frame may occupy, depending on the camera layout.
  let region = { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 };
  let camBox: { x: number; y: number; w: number; h: number; round: number } | null = null;
  if (layout === "split") {
    if (H >= W) {
      const top = (H - pad * 3) * 0.6;
      region = { x: pad, y: pad, w: W - pad * 2, h: top };
      camBox = { x: pad, y: pad * 2 + top, w: W - pad * 2, h: H - pad * 3 - top, round: radius };
    } else {
      const left = (W - pad * 3) * 0.66;
      region = { x: pad, y: pad, w: left, h: H - pad * 2 };
      camBox = { x: pad * 2 + left, y: pad, w: W - pad * 3 - left, h: H - pad * 2, round: radius };
    }
  } else if (layout === "overlay" && cam) {
    const size = cam.size * short;
    const margin = Math.max(pad * 0.7, short * 0.03);
    const x = cam.corner.endsWith("l") ? margin : W - margin - size;
    const y = cam.corner.startsWith("t") ? margin : H - margin - size;
    camBox = { x, y, w: size, h: size, round: cam.shape === "circle" ? size / 2 : size * 0.18 };
  } else if (layout === "camera") {
    camBox = { x: 0, y: 0, w: W, h: H, round: 0 };
  }

  const srcT = clip.offset + (frameNo / fps) * speed;
  const regionAspect = region.w / region.h;
  // Reframe when fitting would leave much of the region empty (a 16:9 take in 1:1 or 9:16),
  // never for small differences such as padding around a 16:9 take in a 16:9 canvas.
  const reframe = !!style.reframe && !!screen.cursor?.length && Math.min(regionAspect / aspect, aspect / regionAspect) < 0.75;

  // The frame: the recording fitted in its region, or the whole region when reframing.
  const fw = reframe ? region.w : Math.min(region.w, region.h * aspect);
  const fh = reframe ? region.h : fw / aspect;
  const frame = {
    x: region.x + (region.w - fw) / 2 + ((style.offsetX ?? 0) / 100) * W,
    y: region.y + (region.h - fh) / 2 + ((style.offsetY ?? 0) / 100) * H,
    w: fw,
    h: fh,
  };

  // The recording inside the frame: the same size, or covering it and panned so the
  // pointer stays in view. A slower focus than zoom-follow keeps the camera calm.
  const cw = reframe ? Math.max(fw, fh * aspect) : fw;
  const ch = cw / aspect;
  const look = (reframe && cursorFocusAt(screen.cursor, srcT, 0.6)) || { x: 0.5, y: 0.5 };
  const panX = Math.min(cw - fw, Math.max(0, look.x * cw - fw / 2));
  const panY = Math.min(ch - fh, Math.max(0, look.y * ch - fh / 2));
  // Zoom focus is in recording coordinates; the zoom acts on the visible frame.
  const zoomX = Math.min(1, Math.max(0, (zoom.x * cw - panX) / fw));
  const zoomY = Math.min(1, Math.max(0, (zoom.y * ch - panY) / fh));

  return (
    <AbsoluteFill style={backgroundCss(style.background)}>
      {style.background.kind === "image" && (() => {
        const img = assets.find((a) => a.id === style.background.value);
        return img?.src ? <Img src={img.src} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null;
      })()}
      {layout !== "camera" && (
        <div
          data-clip-box={clip.id}
          style={{
            position: "absolute",
            left: frame.x,
            top: frame.y,
            width: frame.w,
            height: frame.h,
            borderRadius: radius,
            overflow: "hidden",
            boxShadow: style.shadow > 0 ? `0 ${short * 0.02}px ${short * 0.06}px rgba(0,0,0,${0.55 * style.shadow})` : undefined,
            background: "#000",
          }}
        >
          {/* Zoom magnifies the content inside the frame, so the frame never covers the camera. */}
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              transformOrigin: `${zoomX * 100}% ${zoomY * 100}%`,
              transform: zoom.scale !== 1 ? `scale(${zoom.scale})` : undefined,
              filter: zoom.blur > 0.3 ? `blur(${zoom.blur}px)` : undefined,
            }}
          >
            <div style={{ position: "absolute", left: -panX, top: -panY, width: cw, height: ch }}>
              <Video src={screen.src!} trimBefore={trimBefore} playbackRate={speed} muted={muted} volume={volume} objectFit="cover" style={{ width: "100%", height: "100%" }} />
            </div>
          </div>
        </div>
      )}
      {camBox && camera?.src && (
        <div
          style={{
            position: "absolute",
            left: camBox.x,
            top: camBox.y,
            width: camBox.w,
            height: camBox.h,
            borderRadius: camBox.round,
            overflow: "hidden",
            boxShadow: layout === "overlay" ? `0 ${short * 0.012}px ${short * 0.04}px rgba(0,0,0,0.45)` : undefined,
            border: layout === "overlay" ? `${Math.max(2, short * 0.004)}px solid rgba(255,255,255,0.85)` : undefined,
            background: "#000",
          }}
        >
          {/* Mirrored, like looking into a mirror: what people expect from their own webcam. */}
          <Video src={camera.src} trimBefore={trimBefore} playbackRate={speed} muted objectFit="cover" style={{ width: "100%", height: "100%", transform: "scaleX(-1)" }} />
        </div>
      )}
    </AbsoluteFill>
  );
}
