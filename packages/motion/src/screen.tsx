import type { CSSProperties } from "react";
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from "remotion";
import { Video } from "@remotion/media";
import { DEFAULT_SCREEN_CURSOR, DEFAULT_SCREEN_STYLE, cursorAt, cursorFocusAt, type Asset, type Clip, type CursorShape, type CursorStyleId, type ScreenStyle } from "@goodscreen/editor-core";

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

/** Custom pointers: an arrow drawn tip-on-tip over the recorded one. */
export const CURSOR_STYLES: { id: CursorStyleId; label: string; fill: string; stroke: string; halo?: string }[] = [
  { id: "white", label: "Putih", fill: "#ffffff", stroke: "#000000" },
  { id: "black", label: "Hitam", fill: "#111111", stroke: "#ffffff" },
  { id: "accent", label: "Biru", fill: "#3b82f6", stroke: "#ffffff" },
  { id: "highlight", label: "Sorotan", fill: "#ffffff", stroke: "#000000", halo: "rgba(250, 204, 21, 0.45)" },
];

/**
 * One glyph per pointer shape, all 22 units tall (so one size setting fits all), each
 * placed by its hotspot: the arrow's tip, the I-beam's centre, the hand's fingertip.
 */
export const CURSOR_GLYPHS: Record<CursorShape, { w: number; hx: number; hy: number }> = {
  arrow: { w: 16, hx: 1, hy: 1 },
  text: { w: 10, hx: 5, hy: 11 },
  hand: { w: 18, hx: 6.2, hy: 1 },
};

const ARROW = "M1 1 L1 17.5 L5 13.6 L8 20.5 L10.8 19.3 L7.9 12.6 L13.4 12.6 Z";
const I_BEAM = "M2.2 1.6 H7.8 M5 1.6 V20.4 M2.2 20.4 H7.8";
const HAND =
  "M6.2 1C7.2 1 8 1.8 8 2.8V9C8.4 8.3 9.2 8 9.9 8.2 10.7 8.4 11.2 9 11.2 9.6 11.6 9.1 12.4 8.9 13.1 9.2 13.8 9.5 14.1 10.2 14.1 10.8 14.5 10.4 15.2 10.3 15.8 10.6 16.5 11 16.7 11.6 16.7 12.3V16C16.7 19 14.7 21 11.7 21H9.7C7.7 21 6.5 20.3 5.4 18.8L2.2 14.6C1.6 13.8 1.8 12.8 2.6 12.3 3.3 11.9 4.2 12.1 4.7 12.8L4.4 12.4V2.8C4.4 1.8 5.2 1 6.2 1Z";

export function CursorGlyph({ style, height, shape = "arrow" }: { style: CursorStyleId; height: number; shape?: CursorShape }) {
  const s = CURSOR_STYLES.find((c) => c.id === style) ?? CURSOR_STYLES[0]!;
  const g = CURSOR_GLYPHS[shape];
  return (
    <svg width={(height * g.w) / 22} height={height} viewBox={`0 0 ${g.w} 22`} style={{ display: "block", overflow: "visible" }}>
      {s.halo && <circle cx={g.hx} cy={g.hy} r="7" fill={s.halo} />}
      {shape === "text" ? (
        // The I-beam is a stroke: outline colour underneath, fill colour on top.
        <g fill="none" strokeLinecap="round">
          <path d={I_BEAM} stroke={s.stroke} strokeWidth="3.4" />
          <path d={I_BEAM} stroke={s.fill} strokeWidth="1.6" />
        </g>
      ) : (
        <path d={shape === "hand" ? HAND : ARROW} fill={s.fill} stroke={s.stroke} strokeWidth="1.3" strokeLinejoin="round" />
      )}
    </svg>
  );
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
  const cursorStyle = { ...DEFAULT_SCREEN_CURSOR, ...style.cursor };
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

  // Pointer at this frame's source time; sized from the recorded pointer (~22px at the source width).
  const pointer = cursorStyle.show ? cursorAt(screen.cursor, srcT) : null;
  const pointerH = cw * (22 / (screen.width || 1920)) * cursorStyle.size;

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
              {/* Inside the zoom, so a zoom-in enlarges the pointer with the screen. */}
              {pointer && (
                <div
                  style={{
                    position: "absolute",
                    left: pointer.x * cw - (CURSOR_GLYPHS[pointer.shape].hx * pointerH) / 22,
                    top: pointer.y * ch - (CURSOR_GLYPHS[pointer.shape].hy * pointerH) / 22,
                    pointerEvents: "none",
                  }}
                >
                  <CursorGlyph style={cursorStyle.style} height={pointerH} shape={pointer.shape} />
                </div>
              )}
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
