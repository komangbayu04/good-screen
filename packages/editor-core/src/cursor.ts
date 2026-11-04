import type { CursorSample } from "./types";

/** Index of the last sample at or before t (-1 if none). Samples are sorted by t. */
function before(samples: CursorSample[], t: number) {
  let lo = 0;
  let hi = samples.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.t <= t) {
      hit = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return hit;
}

/** Longest gap (s) bridged by sliding between two samples; a longer one holds the earlier position. */
const BRIDGE = 0.5;

/** The pointer at time t: between two samples it slides, across a long gap it holds. */
export function pointerAt(samples: CursorSample[] | undefined, t: number): { x: number; y: number } | null {
  if (!samples?.length) return null;
  const i = before(samples, t);
  const a = samples[i];
  const b = samples[i + 1];
  if (a && b && b.t - a.t <= BRIDGE) {
    const p = (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
  }
  const s = a ?? b!;
  return { x: s.x, y: s.y };
}

/**
 * A calm average of the pointer around t, for panning a reframed recording. Weighted by
 * time, not by sample: samples come every frame while it moves but only now and then
 * while it rests, and a resting pointer must count for as long as it rests.
 */
export function cursorFocusAt(samples: CursorSample[] | undefined, t: number, sigma = 0.35) {
  if (!samples?.length) return null;
  const step = sigma / 6;
  let w = 0;
  let x = 0;
  let y = 0;
  for (let u = -3 * sigma; u <= 3 * sigma; u += step) {
    const p = pointerAt(samples, t + u)!;
    const k = Math.exp(-(u * u) / (2 * sigma * sigma));
    w += k;
    x += p.x * k;
    y += p.y * k;
  }
  return { x: x / w, y: y / w };
}

/** Camera path resolution (s), how far ahead it looks, and how quickly it settles. */
const PATH_STEP = 1 / 60;
const LEAD = 0.12;
const SETTLE = 0.22;
/** The pointer may wander this share of the way from the middle to the edge before the camera moves. */
const DEAD_ZONE = 0.45;
const paths = new WeakMap<CursorSample[], Map<string, Float32Array>>();

/**
 * Camera for a zoom that follows the pointer, like a camera operator: it holds still while
 * the pointer moves about the middle of the zoomed view, glides along when it nears an
 * edge, looks slightly ahead, and never shows past the recording's edges.
 *
 * Returns the zoom's transform origin (0..1 of the recording) at source time t, for a zoom
 * of `scale` over source times [from, to]. Each frame is rendered on its own, so the path
 * is simulated once from the zoom's start and cached.
 */
export function followOrigin(samples: CursorSample[] | undefined, from: number, to: number, scale: number, t: number) {
  if (!samples?.length || scale <= 1.001) return null;
  let byZoom = paths.get(samples);
  if (!byZoom) paths.set(samples, (byZoom = new Map()));
  const key = `${from.toFixed(3)}|${to.toFixed(3)}|${scale.toFixed(3)}`;
  let path = byZoom.get(key);
  if (!path) {
    const n = Math.max(2, Math.ceil((to - from) / PATH_STEP) + 1);
    path = new Float32Array(n * 2);
    const half = 0.5 / scale;
    const zone = half * DEAD_ZONE;
    const k = 1 - Math.exp(-PATH_STEP / SETTLE);
    const clamp = (v: number) => Math.min(1 - half, Math.max(half, v));
    const start = pointerAt(samples, from + LEAD)!;
    let cx = clamp(start.x);
    let cy = clamp(start.y);
    for (let i = 0; i < n; i++) {
      const p = pointerAt(samples, from + i * PATH_STEP + LEAD)!;
      // Only the part outside the dead zone pulls the camera along.
      const want = (c: number, v: number) => (v - c > zone ? v - zone : c - v > zone ? v + zone : c);
      cx = clamp(cx + (want(cx, p.x) - cx) * k);
      cy = clamp(cy + (want(cy, p.y) - cy) * k);
      // The origin that puts the camera's centre at (cx, cy) for this scale.
      path[i * 2] = (cx - half) / (1 - 1 / scale);
      path[i * 2 + 1] = (cy - half) / (1 - 1 / scale);
    }
    byZoom.set(key, path);
  }
  const f = Math.min(path.length / 2 - 1, Math.max(0, (t - from) / PATH_STEP));
  const i = Math.floor(f);
  const j = Math.min(path.length / 2 - 1, i + 1);
  const r = f - i;
  return { x: path[i * 2]! + (path[j * 2]! - path[i * 2]!) * r, y: path[i * 2 + 1]! + (path[j * 2 + 1]! - path[i * 2 + 1]!) * r };
}

/**
 * Automatic zooms from the clicks in a pointer track: zoom in a little before a click,
 * hold while clicks keep coming close together, zoom out after the last one.
 * Returns source-time segments with the first click's position (the zoom follows the pointer).
 */
export function clickZoomSegments(
  samples: CursorSample[] | undefined,
  duration: number,
  { lead = 0.6, hold = 2.2, mergeGap = 3.5, outGap = 0.9, minLength = 1.2 } = {},
): { start: number; end: number; x: number; y: number }[] {
  const clicks = (samples ?? []).filter((s) => s.c);
  const out: { start: number; end: number; x: number; y: number }[] = [];
  let lastClick = -Infinity;
  for (const c of clicks) {
    const prev = out[out.length - 1];
    const gap = c.t - lastClick;
    lastClick = c.t;
    // Clicks close together are one piece of work: one zoom that pans along reads calmer than in-out-in.
    if (prev && gap <= mergeGap) {
      prev.end = Math.min(duration, c.t + hold);
      continue;
    }
    const seg = { start: Math.max(0, c.t - lead), end: Math.min(duration, c.t + hold), x: c.x, y: c.y };
    // Leave room to zoom out and back in between two zooms.
    if (prev && seg.start < prev.end + outGap) {
      const mid = (prev.end + seg.start) / 2;
      prev.end = mid - outGap / 2;
      seg.start = mid + outGap / 2;
    }
    out.push(seg);
  }
  return out.filter((s) => s.end - s.start >= minLength);
}
