import type { CursorSample } from "./types";

/** Samples are ~10 Hz; a longer gap means the pointer was not found (hidden, or another shape). */
const MAX_GAP = 0.35;

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

/** Pointer at source time t, unsmoothed so a custom pointer stays on top of the recorded one. */
export function cursorAt(samples: CursorSample[] | undefined, t: number): { x: number; y: number } | null {
  if (!samples?.length) return null;
  const i = before(samples, t);
  const a = samples[i];
  const b = samples[i + 1];
  if (a && b && b.t - a.t <= MAX_GAP) {
    const p = (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
  }
  if (a && t - a.t <= MAX_GAP / 2) return a;
  if (b && b.t - t <= MAX_GAP / 2) return b;
  return null;
}

/**
 * Where a following zoom looks at time t: a gaussian average of the pointer around t
 * (the future is known, so the camera leads instead of lagging behind the pointer).
 */
export function cursorFocusAt(samples: CursorSample[] | undefined, t: number, sigma = 0.35) {
  if (!samples?.length) return null;
  let i = Math.max(0, before(samples, t - sigma * 3));
  let w = 0;
  let x = 0;
  let y = 0;
  for (; i < samples.length && samples[i]!.t <= t + sigma * 3; i++) {
    const s = samples[i]!;
    const k = Math.exp(-((s.t - t) ** 2) / (2 * sigma * sigma));
    w += k;
    x += s.x * k;
    y += s.y * k;
  }
  if (w < 1e-3) {
    // No pointer nearby: hold the last place it was seen.
    const last = samples[Math.max(0, before(samples, t))]!;
    return { x: last.x, y: last.y };
  }
  return { x: x / w, y: y / w };
}

/**
 * Automatic zooms from a pointer track: zoom in where the pointer works in one area
 * (stays within `radius` for at least `minHold` s), zoom out when it travels away.
 * Returns source-time segments with the area's centre.
 */
export function autoZoomSegments(
  samples: CursorSample[] | undefined,
  duration: number,
  { radius = 0.2, minHold = 1.6, lead = 0.4, tail = 0.6, mergeGap = 1.2, farJump = 0.35, outGap = 0.9 } = {},
): { start: number; end: number; x: number; y: number }[] {
  if (!samples || samples.length < 4) return [];
  const raw: { start: number; end: number; x: number; y: number }[] = [];
  let i = 0;
  while (i < samples.length) {
    let cx = samples[i]!.x;
    let cy = samples[i]!.y;
    let n = 1;
    let j = i + 1;
    for (; j < samples.length; j++) {
      const s = samples[j]!;
      // A long gap (pointer lost) ends the cluster too.
      if (s.t - samples[j - 1]!.t > 1.5 || Math.hypot(s.x - cx, s.y - cy) > radius) break;
      cx += (s.x - cx) / (n + 1);
      cy += (s.y - cy) / (n + 1);
      n++;
    }
    const start = samples[i]!.t;
    const end = samples[j - 1]!.t;
    if (end - start >= minHold) raw.push({ start, end, x: cx, y: cy });
    i = j;
  }
  // Pad and clamp. Nearby areas close together merge (one zoom that pans reads calmer than
  // in-out-in); a jump to a far area zooms out and back in, with room for both moves.
  const out: typeof raw = [];
  for (const r of raw) {
    const seg = { ...r, start: Math.max(0, r.start - lead), end: Math.min(duration, r.end + tail) };
    const prev = out[out.length - 1];
    const near = prev && Math.hypot(seg.x - prev.x, seg.y - prev.y) < farJump;
    if (prev && near && seg.start - prev.end <= mergeGap) {
      prev.end = seg.end;
      prev.x = (prev.x + seg.x) / 2;
      prev.y = (prev.y + seg.y) / 2;
      continue;
    }
    if (prev && seg.start < prev.end + outGap) {
      const mid = (prev.end + seg.start) / 2;
      prev.end = mid - outGap / 2;
      seg.start = mid + outGap / 2;
    }
    out.push(seg);
  }
  return out.filter((s) => s.end - s.start >= 1);
}
