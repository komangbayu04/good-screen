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
