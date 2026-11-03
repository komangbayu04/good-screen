import type { CursorSample, CursorShape } from "@goodscreen/editor-core";

/**
 * Finds the mouse pointer in a screen-capture stream while it records.
 *
 * Browsers never tell a page where the pointer is outside its own tab, but the
 * capture has the pointer drawn in. So:
 *  - every frame, look for the pointer close to where it last was (cheap, and it keeps
 *    up with fast moves, so a custom pointer drawn later stays on top of the real one);
 *  - ~10 times a second, also diff a small copy of the frame with the previous one to
 *    find small changed spots (a moving pointer leaves two) and look there, which finds
 *    the pointer again after a jump or when it was lost.
 * The arrow, the text I-beam and the link hand are recognised. Other shapes leave a gap,
 * during which the editor simply shows the recorded pointer.
 */

const FULL_SCAN_MS = 100;
const DIFF_W = 480; // diff image width
const CELL = 8; // diff grid cell, in diff pixels
const LUMA_DELTA = 28;
/** How far the pointer may move between two frames and still be followed by the local search. */
const LOCAL_RADIUS = 64;
/** The every-frame search around where the pointer should be: small, so it stays cheap. */
const QUICK_RADIUS = 6;
/** Pointer heights at 100% display scaling. */
const BASE_H: Record<CursorShape, number> = { arrow: 19, text: 17, hand: 22 };
/**
 * Scales to try: 0.8× to 2.7× in 8% steps. Each template tolerates about ±1px of size
 * difference, so the steps overlap and any pointer size in between is found (pointers
 * differ by OS and theme, and display scaling isn't limited to 100/125/150%).
 */
const SCALES = Array.from({ length: 16 }, (_, i) => Math.round(0.8 * 1.08 ** i * 1000) / 1000);
const MIN_SCORE = 0.8;
/**
 * Finding a pointer from nothing needs an almost complete shape: a real pointer's outline
 * is closed, while letter combinations ("fo", "ll") always leave gaps. The looser
 * MIN_SCORE only keeps following a known pointer through motion blur.
 */
const ACQUIRE_COVER = 0.97;
/** While the pointer rests, a sample at least this often (so a rest doesn't read as a gap). */
const REST_SAMPLE_S = 0.25;

type Pt = [number, number];
type Template = {
  shape: CursorShape;
  scale: number;
  /** Index of `scale` in SCALES (bigger = larger template). */
  step: number;
  w: number;
  h: number;
  /** Hotspot inside the template (arrow tip, I-beam centre, fingertip). */
  hx: number;
  hy: number;
  /** "outlined": light fill with a dark outline (or the reverse). "contrast": a thin
      uniform stroke whose sides contrast with it (the I-beam, which has no outline). */
  mode: "outlined" | "contrast";
  fill: Int32Array;
  edge: Int32Array;
};

// Outlines in units of the pointer's height, hotspot first.
const ARROW: Pt[] = [
  [0, 0],
  [0, 0.84],
  [0.21, 0.65],
  [0.37, 0.98],
  [0.5, 0.92],
  [0.35, 0.6],
  [0.62, 0.6],
];
const HAND: Pt[] = [
  [0.19, 0.07],
  [0.27, 0.02],
  [0.35, 0.07],
  [0.35, 0.39],
  [0.75, 0.48],
  [0.75, 0.73],
  [0.66, 0.93],
  [0.39, 0.95],
  [0.23, 0.84],
  [0.08, 0.64],
  [0.11, 0.56],
  [0.19, 0.57],
];
// The fingertip, measured: the outline above is a rough glove, so the best match sits a little high.
const HAND_HOT: Pt = [0.32, 0.2];

function distToSegment(px: number, py: number, [ax, ay]: Pt, [bx, by]: Pt) {
  const dx = bx - ax;
  const dy = by - ay;
  const p = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - dx * p, py - ay - dy * p);
}

function inside(px: number, py: number, poly: Pt[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Fill points deep inside the outline, and edge points in the outline band just inside it.
 * Fill points keep a small margin past the outline band: enough for a pointer up to one
 * size step (≈4%) smaller, small enough that a small pointer keeps plenty of fill points
 * (a template with only a few would match almost anywhere on a light page).
 */
function outlined(shape: CursorShape, scale: number, unit: Pt[], hot: Pt): Template {
  const h = BASE_H[shape] * scale;
  const poly = unit.map(([x, y]) => [x * h, y * h] as Pt);
  const band = Math.max(1, 0.05 * h);
  const w = Math.ceil(Math.max(...poly.map(([x]) => x))) + 1;
  const fill: number[] = [];
  const edge: number[] = [];
  for (let y = 0; y <= Math.ceil(h); y++)
    for (let x = 0; x <= w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      if (!inside(px, py, poly)) continue;
      let d = Infinity;
      for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSegment(px, py, poly[i]!, poly[(i + 1) % poly.length]!));
      if (d >= band + 0.6) fill.push(x, y);
      else if (d >= 0.3 && d <= band) edge.push(x, y);
    }
  return { shape, scale, step: SCALES.indexOf(scale), w, h: Math.ceil(h) + 1, hx: Math.round(hot[0] * h), hy: Math.round(hot[1] * h), mode: "outlined", fill: Int32Array.from(fill), edge: Int32Array.from(edge) };
}

/**
 * The I-beam: a thin stem with short bars at both ends. Edge points sit beside the stem
 * and just above and below the bars: a light gap between two letters ("ll", "um") also
 * has contrasting sides, but no bars, so the rows above and below it don't contrast.
 */
function iBeam(scale: number): Template {
  const h = Math.round(BASE_H.text * scale);
  const stem = Math.max(1, Math.round(h * 0.06));
  const arm = Math.max(2, Math.round(h * 0.18));
  const bar = Math.max(1, Math.round(h * 0.06));
  const cx = arm + 2;
  const w = cx * 2 + stem;
  const top = 2; // room for the row above the top bar
  const fill: number[] = [];
  const edge: number[] = [];
  for (let y = Math.round(h * 0.2); y < Math.round(h * 0.8); y++) {
    for (let x = cx; x < cx + stem; x++) fill.push(x, top + y);
    // Beside the stem, past a possible 1px outline.
    edge.push(cx - 3, top + y, cx + stem + 2, top + y);
  }
  for (let x = cx - arm; x < cx + stem + arm; x++) {
    for (let y = 0; y < bar; y++) fill.push(x, top + y, x, top + h - 1 - y);
    edge.push(x, top - 2, x, top + h + 1);
  }
  return { shape: "text", scale, step: SCALES.indexOf(scale), w, h: top + h + 2, hx: cx, hy: top + Math.round(h / 2), mode: "contrast", fill: Int32Array.from(fill), edge: Int32Array.from(edge) };
}

const TEMPLATES: Template[] = SCALES.flatMap((s) => [outlined("arrow", s, ARROW, [0, 0]), iBeam(s), outlined("hand", s, HAND, HAND_HOT)]);
/** Templates at this scale and the steps either side, so a first guess one size off corrects itself. */
const nearScale = (scale: number) => {
  const i = SCALES.indexOf(scale);
  const keep = new Set(SCALES.slice(Math.max(0, i - 1), i + 2));
  return TEMPLATES.filter((t) => keep.has(t.scale));
};

/**
 * How well the frame at template origin (ox, oy) matches t: the share of fill and outline
 * points that agree (0..1, 0 = early reject) plus up to 0.1 for outline points on the exact
 * pixel. `out.cover` receives the share alone (how complete the shape is).
 */
function score(luma: Uint8ClampedArray, stride: number, rows: number, t: Template, ox: number, oy: number, out: { cover: number }) {
  out.cover = 0;
  if (ox < 3 || oy < 1 || ox + t.w + 3 >= stride || oy + t.h + 1 >= rows) return 0;
  const at = (pts: Int32Array, i: number) => luma[(oy + pts[i + 1]!) * stride + ox + pts[i]!]!;
  // The outline may sit a pixel off the template's band (a slightly different size or
  // theme): an edge point counts when it or any neighbouring pixel has the outline colour.
  // 2 = on the exact pixel, 1 = on a neighbour, 0 = not there.
  const nearOutline = (i: number, light: boolean) => {
    const c = (oy + t.edge[i + 1]!) * stride + ox + t.edge[i]!;
    const dark = (v: number) => (light ? v < 110 : v > 150);
    if (dark(luma[c]!)) return 2;
    for (let dy = -stride; dy <= stride; dy += stride) for (let dx = -1; dx <= 1; dx++) if (dark(luma[c + dy + dx]!)) return 1;
    return 0;
  };
  const nFill = t.fill.length / 2;
  const nEdge = t.edge.length / 2;
  let best = 0;
  for (const light of [true, false]) {
    const maxMiss = nFill * (1 - MIN_SCORE);
    let miss = 0;
    let sum = 0;
    for (let i = 0; i < t.fill.length && miss <= maxMiss; i += 2) {
      const v = at(t.fill, i);
      sum += v;
      if (!(light ? v > 185 : v < 70)) miss++; // most positions fail here, fast
    }
    if (miss > maxMiss) continue;
    const fillShare = 1 - miss / nFill;
    const mean = sum / nFill;
    const maxEdgeMiss = nEdge * (1 - MIN_SCORE);
    let emiss = 0;
    let exact = 0;
    for (let i = 0; i < t.edge.length && emiss <= maxEdgeMiss; i += 2) {
      const hit = t.mode === "outlined" ? nearOutline(i, light) : Math.abs(at(t.edge, i) - mean) > 70 ? 2 : 0;
      if (hit === 0) emiss++; // a light page passes the fill test everywhere; the outline settles it
      else if (hit === 2) exact++;
    }
    if (emiss > maxEdgeMiss) continue;
    // Tolerance finds the pointer; exactness picks where it is. Of the neighbouring
    // positions that all pass, the one whose outline lands on the exact pixels wins.
    const cover = Math.min(fillShare, 1 - emiss / nEdge);
    const s = cover + 0.1 * (exact / nEdge);
    if (s > best) {
      best = s;
      out.cover = cover;
    }
  }
  return best;
}

/** A match: hotspot, template, score, and how complete the shape was (see `score`). */
type Hit = { x: number; y: number; t: Template; s: number; cover: number };

export interface CursorTracker {
  /** Stops tracking and returns the samples so far. */
  stop: () => CursorSample[];
  samples: CursorSample[];
}

/**
 * Track the pointer in `track`. `time()` returns the recording time in seconds,
 * or null while paused (no samples then).
 */
export function trackCursor(track: MediaStreamTrack, time: () => number | null): CursorTracker {
  // The frame being analysed: a VideoFrame from the track (preferred), or a <video> of it.
  let source: CanvasImageSource = document.createElement("video");
  let vw = 0;
  let vh = 0;

  const small = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const crop = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  let prev: Uint8Array | null = null;
  /** Last hotspot, its template, and how far it moved since the frame before (per frame). */
  let last: { x: number; y: number; t: Template; vx: number; vy: number } | null = null;
  const samples: CursorSample[] = [];

  /** Best match among `templates` with its hotspot inside [x0, x1] × [y0, y1] (capture pixels). */
  const search = (x0: number, y0: number, x1: number, y1: number, templates: Template[], near?: { x: number; y: number }): Hit | null => {
    const maxW = Math.max(...templates.map((t) => t.w));
    const maxH = Math.max(...templates.map((t) => t.h));
    const sx = Math.max(0, Math.floor(x0 - maxW - 4));
    const sy = Math.max(0, Math.floor(y0 - maxH));
    const sw = Math.min(vw, Math.ceil(x1 + maxW + 4)) - sx;
    const sh = Math.min(vh, Math.ceil(y1 + maxH)) - sy;
    if (sw <= 0 || sh <= 0) return null;
    crop.canvas.width = sw;
    crop.canvas.height = sh;
    crop.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    const rgba = crop.getImageData(0, 0, sw, sh).data;
    const luma = new Uint8ClampedArray(sw * sh);
    for (let i = 0, p = 0; p < luma.length; i += 4, p++) luma[p] = (rgba[i]! * 77 + rgba[i + 1]! * 150 + rgba[i + 2]! * 29) >> 8;
    let best: Hit | null = null;
    let bestRank = -Infinity;
    const parts = { cover: 0 };
    for (const t of templates)
      for (let hy = Math.ceil(y0); hy <= y1; hy++)
        for (let hx = Math.ceil(x0); hx <= x1; hx++) {
          const s = score(luma, sw, sh, t, hx - t.hx - sx, hy - t.hy - sy, parts);
          if (s < MIN_SCORE) continue;
          // Larger passing templates win: a small one can also fit a corner of a big pointer,
          // a big one can't fit a small pointer (its outline finds nothing there).
          // Near the last position wins over a slightly better match far away: text being
          // typed elsewhere can look like an I-beam, the pointer rarely teleports.
          const rank = s + 0.02 * t.step - (near ? Math.hypot(hx - near.x, hy - near.y) / 400 : 0);
          if (rank > bestRank) {
            bestRank = rank;
            best = { x: hx, y: hy, t, s, cover: parts.cover };
          }
        }
    return best;
  };

  /** Small changed spots since the previous full scan, in capture pixels. */
  const changedSpots = () => {
    const dw = Math.min(DIFF_W, vw);
    const dh = Math.round((vh / vw) * dw);
    if (small.canvas.width !== dw || small.canvas.height !== dh) {
      small.canvas.width = dw;
      small.canvas.height = dh;
      prev = null;
    }
    small.drawImage(source, 0, 0, dw, dh);
    const rgba = small.getImageData(0, 0, dw, dh).data;
    const luma = new Uint8Array(dw * dh);
    for (let i = 0, p = 0; p < luma.length; i += 4, p++) luma[p] = (rgba[i]! * 77 + rgba[i + 1]! * 150 + rgba[i + 2]! * 29) >> 8;
    const spots: { x0: number; y0: number; x1: number; y1: number }[] = [];
    if (prev) {
      const cw = Math.ceil(dw / CELL);
      const ch = Math.ceil(dh / CELL);
      const cells = new Uint8Array(cw * ch);
      let changed = 0;
      for (let y = 0; y < dh; y++)
        for (let x = 0; x < dw; x++) {
          const p = y * dw + x;
          if (Math.abs(luma[p]! - prev[p]!) > LUMA_DELTA) {
            const c = ((y / CELL) | 0) * cw + ((x / CELL) | 0);
            if (cells[c]! < 255) cells[c]!++;
          }
        }
      for (let c = 0; c < cells.length; c++) if (cells[c]! >= 2) changed++;
      // Scrolling or video playback changes much of the screen: no pointer hints there.
      if (changed > 0 && changed < cells.length * 0.15) {
        const seen = new Uint8Array(cells.length);
        for (let c = 0; c < cells.length; c++) {
          if (cells[c]! < 2 || seen[c]) continue;
          const stack = [c];
          seen[c] = 1;
          let [x0, y0, x1, y1] = [c % cw, (c / cw) | 0, c % cw, (c / cw) | 0];
          while (stack.length) {
            const k = stack.pop()!;
            const kx = k % cw;
            const ky = (k / cw) | 0;
            x0 = Math.min(x0, kx);
            x1 = Math.max(x1, kx);
            y0 = Math.min(y0, ky);
            y1 = Math.max(y1, ky);
            for (const [nx, ny] of [[kx - 1, ky], [kx + 1, ky], [kx, ky - 1], [kx, ky + 1]] as const) {
              const n = ny * cw + nx;
              if (nx >= 0 && ny >= 0 && nx < cw && ny < ch && !seen[n] && cells[n]! >= 2) {
                seen[n] = 1;
                stack.push(n);
              }
            }
          }
          // About pointer-sized only (a few cells across). Searched with a one-cell margin:
          // a pointer that barely moved changes too few pixels at its thin tip to mark that
          // cell, so the spot can start just below the hotspot.
          if (x1 - x0 <= 6 && y1 - y0 <= 8) {
            const k = vw / dw;
            spots.push({ x0: (x0 - 1) * CELL * k, y0: (y0 - 1) * CELL * k, x1: (x1 + 2) * CELL * k, y1: (y1 + 2) * CELL * k });
          }
        }
      }
    }
    prev = luma;
    return spots;
  };

  /** One frame at recording time `t`; `full` adds the diff scan (≈10×/s). */
  const tick = (t: number, full: boolean) => {
    if (!vw || !vh) return;
    let found: Hit | null = null;
    if (last) {
      // 1a. Where it should be now (last position plus last move), same template: the
      //     common case, and cheap enough for every frame.
      const px = last.x + last.vx;
      const py = last.y + last.vy;
      found = search(px - QUICK_RADIUS, py - QUICK_RADIUS, px + QUICK_RADIUS, py + QUICK_RADIUS, [last.t], last);
      // 1b. Not there: wider, with the sizes either side and all three shapes (it may have
      //     sped up, or turned into an I-beam or a hand).
      if (!found) {
        const r = LOCAL_RADIUS;
        found = search(last.x - r, last.y - r, last.x + r, last.y + r, nearScale(last.t.scale), last);
      } else if (full) {
        // 1c. A few times a second, let the size correct itself around the match.
        found = search(found.x - 2, found.y - 2, found.x + 2, found.y + 2, nearScale(found.t.scale), found) ?? found;
      }
    }
    // 2. In the spots that changed; any shape and scale if the pointer was lost.
    if (full) {
      const spots = changedSpots();
      if (!found)
        for (const s of spots.slice(0, 4)) {
          let hit = search(s.x0, s.y0, s.x1, s.y1, last ? nearScale(last.t.scale) : TEMPLATES, last ?? undefined) ?? (last ? search(s.x0, s.y0, s.x1, s.y1, TEMPLATES) : null);
          if (hit && !last && hit.cover < ACQUIRE_COVER) hit = null;
          if (hit && (!found || hit.s > found.s)) found = hit;
        }
    }
    if (!found) {
      // One blurred frame isn't a lost pointer; give up only when the full scan misses too.
      if (full) last = null;
      return;
    }
    last = { x: found.x, y: found.y, t: found.t, vx: last ? found.x - last.x : 0, vy: last ? found.y - last.y : 0 };
    const sample: CursorSample = { t: Math.round(t * 1000) / 1000, x: Math.round((found.x / vw) * 1e5) / 1e5, y: Math.round((found.y / vh) * 1e5) / 1e5 };
    if (found.t.shape !== "arrow") sample.s = found.t.shape;
    // A resting pointer needs only a sample now and then; a moving one gets every frame.
    const prevSample = samples[samples.length - 1];
    if (prevSample && prevSample.x === sample.x && prevSample.y === sample.y && prevSample.s === sample.s && t - prevSample.t < REST_SAMPLE_S) return;
    samples.push(sample);
  };

  const safeTick = (t: number, full: boolean) => {
    try {
      tick(t, full);
    } catch {
      // A frame that can't be read (track ended) is just skipped.
    }
  };

  let stopped = false;
  let stopSource = () => {};
  // While recording another window this tab is in the background, where timers slow to
  // once a second. Frames from the track keep arriving at full rate, so prefer those.
  const Processor = (globalThis as unknown as { MediaStreamTrackProcessor?: new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> } })
    .MediaStreamTrackProcessor;
  if (Processor) {
    const own = track.clone();
    const reader = new Processor({ track: own }).readable.getReader();
    let lastFull = -Infinity;
    // Frame timestamps tell when a frame was captured, not when it got here. The smallest
    // (recording time − frame time) seen is the least delayed reading of the offset between
    // the two clocks; it also drops by the right amount after a pause.
    let offset = Infinity;
    void (async () => {
      while (!stopped) {
        const { value: frame, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done || !frame) break;
        const now = time();
        if (now !== null) {
          const ts = frame.timestamp / 1e6;
          offset = Math.min(offset, now - ts);
          source = frame;
          vw = frame.displayWidth;
          vh = frame.displayHeight;
          const full = frame.timestamp - lastFull >= FULL_SCAN_MS * 1000 * 0.95;
          if (full) lastFull = frame.timestamp;
          safeTick(ts + offset, full);
        }
        frame.close();
      }
    })();
    stopSource = () => {
      void reader.cancel().catch(() => {});
      own.stop();
    };
  } else {
    const video = source as HTMLVideoElement;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    void video.play().catch(() => {});
    const id = setInterval(() => {
      const now = time();
      if (now === null || video.readyState < 2) return;
      vw = video.videoWidth;
      vh = video.videoHeight;
      safeTick(now, true);
    }, FULL_SCAN_MS);
    stopSource = () => {
      clearInterval(id);
      video.srcObject = null;
    };
  }

  return {
    samples,
    stop: () => {
      if (!stopped) stopSource();
      stopped = true;
      return samples;
    },
  };
}
