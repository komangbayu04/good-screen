import { DEFAULT_ADJUST, DEFAULT_TRANSFORM } from "./types";
import type { Clip, KeyEase, KeyProp, Keyframe } from "./types";

/**
 * Keyframes (CapCut-style). Times are SOURCE seconds (offset + local × speed), so
 * trimming, splitting and speed changes keep every keyframe pinned to the same
 * moment of the footage without rewriting them.
 */

export const KEY_PROPS: { id: KeyProp; label: string; group: "transform" | "adjust" | "audio" }[] = [
  { id: "x", label: "Posisi X", group: "transform" },
  { id: "y", label: "Posisi Y", group: "transform" },
  { id: "scale", label: "Skala", group: "transform" },
  { id: "rotate", label: "Rotasi", group: "transform" },
  { id: "opacity", label: "Opasitas", group: "transform" },
  { id: "brightness", label: "Kecerahan", group: "adjust" },
  { id: "contrast", label: "Kontras", group: "adjust" },
  { id: "saturation", label: "Saturasi", group: "adjust" },
  { id: "hue", label: "Hue", group: "adjust" },
  { id: "blur", label: "Blur", group: "adjust" },
  { id: "volume", label: "Volume", group: "audio" },
];

export const TRANSFORM_PROPS: KeyProp[] = ["x", "y", "scale", "rotate", "opacity"];
export const ADJUST_PROPS: KeyProp[] = ["brightness", "contrast", "saturation", "hue", "blur"];

/** Two keyframes closer than this (source seconds) are the same keyframe. */
export const KEY_EPS = 1 / 60;

/** The non-animated value of a property. */
export function staticValue(clip: Clip, prop: KeyProp): number {
  if (prop === "volume") return clip.volume ?? 1;
  if (prop in DEFAULT_ADJUST) return (clip.adjust?.[prop as keyof typeof DEFAULT_ADJUST] ?? DEFAULT_ADJUST[prop as keyof typeof DEFAULT_ADJUST]) as number;
  return (clip.transform?.[prop as "x"] ?? DEFAULT_TRANSFORM[prop as "x"]) as number;
}

/** Source time of a timeline time for this clip. */
export const sourceTime = (clip: Clip, t: number) => clip.offset + (t - clip.start) * (clip.speed ?? 1);
/** Timeline time of a source time for this clip. */
export const timelineTime = (clip: Clip, src: number) => clip.start + (src - clip.offset) / (clip.speed ?? 1);

const EASES: Record<KeyEase, (p: number) => number> = {
  linear: (p) => p,
  "ease-in": (p) => p * p * p,
  "ease-out": (p) => 1 - (1 - p) ** 3,
  "ease-in-out": (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
  hold: () => 0,
};

/** Value of a keyframed property at source time `src`. Before/after the keys it holds the end values. */
export function keyValue(keys: Keyframe[], src: number): number {
  const first = keys[0]!;
  if (src <= first.t) return first.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (src <= b.t) {
      const p = (src - a.t) / Math.max(1e-6, b.t - a.t);
      return a.v + (b.v - a.v) * EASES[a.ease ?? "linear"](p);
    }
  }
  return keys[keys.length - 1]!.v;
}

/** Property value at source time `src`, animated if it has keyframes. */
export function propAt(clip: Clip, prop: KeyProp, src: number): number {
  const keys = clip.keyframes?.[prop];
  return keys?.length ? keyValue(keys, src) : staticValue(clip, prop);
}

export const isKeyed = (clip: Clip, prop: KeyProp) => !!clip.keyframes?.[prop]?.length;

/** All distinct keyframe times of a clip (optionally for some properties), sorted. */
export function keyTimes(clip: Clip, props?: KeyProp[]): number[] {
  const out: number[] = [];
  for (const [p, keys] of Object.entries(clip.keyframes ?? {})) {
    if (props && !props.includes(p as KeyProp)) continue;
    for (const k of keys ?? []) if (!out.some((t) => Math.abs(t - k.t) < KEY_EPS)) out.push(k.t);
  }
  return out.sort((a, b) => a - b);
}

export const keyAt = (clip: Clip, prop: KeyProp, src: number) => clip.keyframes?.[prop]?.find((k) => Math.abs(k.t - src) < KEY_EPS);

/** Insert or replace a keyframe (mutates; call inside an immer producer). */
export function upsertKey(clip: Clip, prop: KeyProp, src: number, v: number, ease?: KeyEase) {
  clip.keyframes ??= {};
  const keys = (clip.keyframes[prop] ??= []);
  const hit = keys.find((k) => Math.abs(k.t - src) < KEY_EPS);
  if (hit) {
    hit.v = v;
    if (ease) hit.ease = ease;
  } else {
    // A new key takes the curve of the key before it, so the motion keeps its feel.
    const before = [...keys].reverse().find((k) => k.t < src);
    keys.push({ t: Math.round(src * 1000) / 1000, v, ease: ease ?? before?.ease ?? "linear" });
    keys.sort((a, b) => a.t - b.t);
  }
}
