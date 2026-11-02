
// Shared, serializable editor model. Used by web, future mobile (Expo),
// the agent layer and the backend — keep it free of DOM / React types.

export type AssetKind = "video" | "audio" | "image" | "motion";
/** Timeline rows: 3 generic overlay layers (captions, text, motion, zoom...), the footage, and audio. */
export type TrackKind = "video" | "audio" | "layer";
/** What an overlay clip holds; any of these can sit on any layer. */
export type LayerContent = "caption" | "motion" | "zoom";
export type Author = "user" | "agent";

export type MotionTemplateId =
  | "kinetic-title"
  | "zoom-punch"
  | "lower-third"
  | "progress-bar"
  | "emoji-pop"
  | "flash";

export interface MotionSpec {
  template: MotionTemplateId;
  props: Record<string, string | number | boolean>;
}

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  /** Playable URL (object URL locally, Blob URL once uploaded). */
  src?: string;
  /** Remote URL after upload to storage — filled by the backend later. */
  remoteUrl?: string;
  duration: number; // seconds
  width?: number;
  height?: number;
  thumbnail?: string;
  motion?: MotionSpec;
  /** Screen recordings: where the pointer was, found in the frames while recording. */
  cursor?: CursorSample[];
  createdBy: Author;
  createdAt: number;
}

/** Pointer tip at source time `t` (seconds), as 0..1 of the recording. Gaps = pointer not found. */
export interface CursorSample {
  t: number;
  x: number;
  y: number;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
}

/** In-animation (also used as the cut transition into a video clip). */
export type Transition = "none" | "fade" | "slide" | "slide-up" | "zoom" | "pop" | "blur" | "flash";
export type TransitionOut = "none" | "fade" | "slide" | "slide-down" | "zoom" | "blur";

/** CSS mix-blend-mode values offered in the editor. */
export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "soft-light"
  | "hard-light"
  | "difference"
  | "exclusion";

/** Position/size of a visual clip inside the frame. x/y are % of frame size, rotate in degrees. */
export interface ClipTransform {
  scale: number;
  x: number;
  y: number;
  rotate: number;
  opacity: number;
  flipH: boolean;
  flipV: boolean;
  fit: "fill" | "fit";
  /** Blend group: when off, the clip renders normal and fully opaque. */
  blendEnabled: boolean;
  blendMode: BlendMode;
}

/** Colour adjustments, each -100..100 (hue in degrees, blur in px). 0 = untouched. */
export interface ClipAdjust {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  blur: number;
}

export const DEFAULT_TRANSFORM: ClipTransform = {
  scale: 1,
  x: 0,
  y: 0,
  rotate: 0,
  opacity: 1,
  flipH: false,
  flipV: false,
  fit: "fill",
  blendEnabled: true,
  blendMode: "normal",
};
export const DEFAULT_ADJUST: ClipAdjust = { brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0 };
export const DEFAULT_ANIM_DURATION = 0.3;

export type CaptionStyle = "bold" | "boxed" | "karaoke";

/** Screen Studio-style framing for screen recordings. */
export interface ScreenBackground {
  kind: "gradient" | "color" | "image";
  /** gradient: preset id; color: hex; image: asset id */
  value: string;
}

export type CameraLayout = "overlay" | "split" | "camera" | "screen";
export type CameraCorner = "tl" | "tr" | "bl" | "br";

export interface ScreenCamera {
  /** Webcam recording that runs in sync with the screen recording. */
  assetId: string;
  layout: CameraLayout;
  shape: "circle" | "rounded";
  /** Overlay size as a fraction of the canvas' short side. */
  size: number;
  corner: CameraCorner;
}

export interface ScreenStyle {
  background: ScreenBackground;
  /** Space around the recording, % of the canvas' short side. */
  padding: number;
  /** Corner radius in px at 1080p. */
  radius: number;
  /** 0..1 shadow strength. */
  shadow: number;
  /** Frame position offset, % of canvas width / height (Move tool). */
  offsetX?: number;
  offsetY?: number;
  camera?: ScreenCamera;
  cursor?: ScreenCursor;
  /**
   * In a frame of another shape (1:1, 4:5, 9:16), fill it with the recording and pan
   * with the pointer instead of shrinking the recording to fit. Needs a pointer track.
   */
  reframe?: boolean;
}

export type CursorStyleId = "white" | "black" | "accent" | "highlight";

/** Custom pointer drawn over the recorded one (tip on tip, larger, so it covers it). */
export interface ScreenCursor {
  show: boolean;
  style: CursorStyleId;
  /** Size relative to the recorded pointer. */
  size: number;
}

export const DEFAULT_SCREEN_CURSOR: ScreenCursor = { show: true, style: "white", size: 2 };

export const DEFAULT_SCREEN_STYLE: ScreenStyle = {
  background: { kind: "gradient", value: "dusk" },
  padding: 6,
  radius: 18,
  shadow: 0.6,
  cursor: DEFAULT_SCREEN_CURSOR,
  reframe: true,
};

/** A zoom segment on the zoom track: magnify the screen around a focus point. */
export interface ZoomSpec {
  /** Focus point, 0..1 of the recording. */
  x: number;
  y: number;
  scale: number;
  /** Seconds to ease in and out of the zoom. */
  ease: number;
  /** Focus follows the recorded pointer (when the recording has one) instead of x/y. */
  follow?: boolean;
}

export const DEFAULT_ZOOM: ZoomSpec = { x: 0.5, y: 0.5, scale: 1.8, ease: 0.45 };

/** Animatable clip properties (keyframes). */
export type KeyProp = "x" | "y" | "scale" | "rotate" | "opacity" | "brightness" | "contrast" | "saturation" | "hue" | "blur" | "volume";
/** Curve from a keyframe to the next one. */
export type KeyEase = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold";
export interface Keyframe {
  /** Source time, seconds (offset + local × speed), so trims and splits keep it on the same frame. */
  t: number;
  /** Value in model units (scale 1 = 100%, opacity/volume 0..1). */
  v: number;
  ease?: KeyEase;
}

export interface Clip {
  id: string;
  trackId: string;
  assetId?: string;
  /** Position on the timeline, seconds. */
  start: number;
  /** Length on the timeline, seconds. */
  duration: number;
  /** In-point inside the source asset, seconds. */
  offset: number;
  text?: string;
  captionStyle?: CaptionStyle;
  motion?: MotionSpec;
  transitionIn?: Transition;
  transitionInDuration?: number;
  transitionOut?: TransitionOut;
  transitionOutDuration?: number;
  volume?: number;
  /** Audio fade in/out, seconds. */
  fadeIn?: number;
  fadeOut?: number;
  /** Playback speed; the clip covers `duration * speed` seconds of source. */
  speed?: number;
  transform?: Partial<ClipTransform>;
  adjust?: Partial<ClipAdjust>;
  /** Caption look: size multiplier, vertical position (% from bottom) and colour. */
  captionSize?: number;
  captionY?: number;
  captionColor?: string;
  /** Ken-Burns style slow zoom on video clips. */
  kenBurns?: boolean;
  /** Present on screen recordings: background, frame and linked webcam. */
  screen?: ScreenStyle;
  /** Present on zoom-track clips. */
  zoom?: ZoomSpec;
  /** Animated properties; a keyed property ignores its static value. */
  keyframes?: Partial<Record<KeyProp, Keyframe[]>>;
  createdBy: Author;
}

export interface Project {
  id: string;
  name: string;
  fps: number;
  width: number;
  height: number;
  assets: Asset[];
  tracks: Track[];
  clips: Clip[];
  /** Last edit, ms since epoch (for sorting the project switcher). */
  updatedAt?: number;
}
