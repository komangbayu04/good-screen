import type { CursorSample } from "@goodscreen/editor-core";

/**
 * Finds the mouse pointer in a screen-capture stream while it records.
 *
 * Browsers never tell a page where the pointer is outside its own tab, but the
 * capture has the pointer drawn in. So, ~10 times a second:
 *  1. diff a small copy of the frame with the previous one to find small changed spots
 *     (a moving pointer leaves two: where it was and where it is);
 *  2. match an arrow shape at full resolution in those spots, and around the last
 *     known position (a pointer that stands still makes no diff).
 * Only the standard arrow is recognised; other shapes (text I-beam, hand) leave a gap,
 * during which the editor simply shows the recorded pointer.
 */

const TICK_MS = 100;
const DIFF_W = 480; // diff image width
const CELL = 8; // diff grid cell, in diff pixels
const LUMA_DELTA = 28;
/** Arrow heights to try, in capture pixels (100–250% display scaling, macOS). */
const HEIGHTS = [19, 24, 29, 33, 38, 48];
const MIN_SCORE = 0.8;

// The arrow outline, unit height, tip at (0, 0) (Windows and macOS arrows are close to this).
const POLY: [number, number][] = [
  [0, 0],
  [0, 0.84],
  [0.21, 0.65],
  [0.37, 0.98],
  [0.5, 0.92],
  [0.35, 0.6],
  [0.62, 0.6],
];

type Template = { h: number; fill: Int32Array; edge: Int32Array; w: number };

function distToSegment(px: number, py: number, [ax, ay]: [number, number], [bx, by]: [number, number]) {
  const dx = bx - ax;
  const dy = by - ay;
  const p = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - dx * p, py - ay - dy * p);
}

function inside(px: number, py: number, poly: [number, number][]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Sample offsets (dx, dy pairs) for the arrow's fill and its outline band at height h. */
function makeTemplate(h: number): Template {
  const poly = POLY.map(([x, y]) => [x * h, y * h] as [number, number]);
  const band = Math.max(1, 0.05 * h);
  const fill: number[] = [];
  const edge: number[] = [];
  const w = Math.ceil(0.62 * h) + 1;
  for (let y = 0; y <= Math.ceil(h); y++)
    for (let x = 0; x <= w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      if (!inside(px, py, poly)) continue;
      let d = Infinity;
      for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSegment(px, py, poly[i]!, poly[(i + 1) % poly.length]!));
      if (d >= band + 1) fill.push(x, y);
      else if (d >= 0.3 && d <= band) edge.push(x, y);
    }
  return { h, fill: Int32Array.from(fill), edge: Int32Array.from(edge), w };
}

const TEMPLATES = HEIGHTS.map(makeTemplate);

/** Share of points that agree with a light-fill/dark-outline (or the reverse) arrow at (ox, oy). */
function score(luma: Uint8ClampedArray, stride: number, rows: number, t: Template, ox: number, oy: number) {
  if (ox < 0 || oy < 0 || ox + t.w >= stride || oy + t.h + 1 >= rows) return 0;
  let best = 0;
  for (const light of [true, false]) {
    let ok = 0;
    let n = 0;
    let miss = 0;
    const maxMiss = (t.fill.length / 2) * (1 - MIN_SCORE);
    for (let i = 0; i < t.fill.length; i += 2) {
      const v = luma[(oy + t.fill[i + 1]!) * stride + ox + t.fill[i]!]!;
      if (light ? v > 185 : v < 70) ok++;
      else if (++miss > maxMiss) break; // most positions fail here, fast
      n++;
    }
    if (miss > maxMiss) continue;
    const fillShare = ok / Math.max(1, n);
    let eok = 0;
    let emiss = 0;
    const maxEdgeMiss = (t.edge.length / 2) * (1 - MIN_SCORE);
    for (let i = 0; i < t.edge.length; i += 2) {
      const v = luma[(oy + t.edge[i + 1]!) * stride + ox + t.edge[i]!]!;
      if (light ? v < 110 : v > 150) eok++;
      else if (++emiss > maxEdgeMiss) break; // a light page passes the fill test everywhere; the outline settles it
    }
    if (emiss > maxEdgeMiss) continue;
    best = Math.max(best, Math.min(fillShare, eok / Math.max(1, t.edge.length / 2)));
  }
  return best;
}

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
  let last: { x: number; y: number; t: Template } | null = null;
  const samples: CursorSample[] = [];

  /** Best arrow with its tip inside [x0, x1] × [y0, y1] (capture pixels). */
  const search = (x0: number, y0: number, x1: number, y1: number, templates: Template[]) => {
    const maxH = Math.max(...templates.map((t) => t.h));
    const sx = Math.max(0, Math.floor(x0));
    const sy = Math.max(0, Math.floor(y0));
    const sw = Math.min(vw, Math.ceil(x1 + maxH)) - sx;
    const sh = Math.min(vh, Math.ceil(y1 + maxH + 2)) - sy;
    if (sw <= 0 || sh <= 0) return null;
    crop.canvas.width = sw;
    crop.canvas.height = sh;
    crop.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    const rgba = crop.getImageData(0, 0, sw, sh).data;
    const luma = new Uint8ClampedArray(sw * sh);
    for (let i = 0, p = 0; p < luma.length; i += 4, p++) luma[p] = (rgba[i]! * 77 + rgba[i + 1]! * 150 + rgba[i + 2]! * 29) >> 8;
    let best: { x: number; y: number; t: Template; s: number } | null = null;
    for (const t of templates)
      for (let oy = 0; oy <= Math.min(sh, y1 - sy + 1); oy++)
        for (let ox = 0; ox <= Math.min(sw, x1 - sx + 1); ox++) {
          const s = score(luma, sw, sh, t, ox, oy);
          if (s >= MIN_SCORE && (!best || s > best.s)) best = { x: sx + ox, y: sy + oy, t, s };
        }
    return best;
  };

  const tick = () => {
    const now = time();
    if (now === null || !vw || !vh) return;

    // 1. Small changed spots.
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
          // About pointer-sized only (a few cells across).
          if (x1 - x0 <= 6 && y1 - y0 <= 8) {
            const k = vw / dw;
            spots.push({ x0: (x0 * CELL - 2) * k, y0: (y0 * CELL - 2) * k, x1: ((x1 + 1) * CELL + 2) * k, y1: ((y1 + 1) * CELL + 2) * k });
          }
        }
      }
    }
    prev = luma;

    // 2. Arrow in the spots (any size), else still where it was (known size).
    let found: { x: number; y: number; t: Template; s: number } | null = null;
    for (const s of spots.slice(0, 4)) {
      const hit = search(s.x0, s.y0, s.x1, s.y1, last ? [last.t, ...TEMPLATES.filter((t) => t !== last!.t)] : TEMPLATES);
      if (hit && (!found || hit.s > found.s)) found = hit;
    }
    if (!found && last) found = search(last.x - 3, last.y - 3, last.x + 3, last.y + 3, [last.t]);
    if (!found) return;
    last = { x: found.x, y: found.y, t: found.t };
    samples.push({ t: Math.round(now * 1000) / 1000, x: Math.round((found.x / vw) * 10000) / 10000, y: Math.round((found.y / vh) * 10000) / 10000 });
  };

  const safeTick = () => {
    try {
      tick();
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
    let lastTs = -Infinity;
    void (async () => {
      while (!stopped) {
        const { value: frame, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done || !frame) break;
        if (frame.timestamp - lastTs >= TICK_MS * 1000 * 0.95) {
          lastTs = frame.timestamp;
          source = frame;
          vw = frame.displayWidth;
          vh = frame.displayHeight;
          safeTick();
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
      if (video.readyState < 2) return;
      vw = video.videoWidth;
      vh = video.videoHeight;
      safeTick();
    }, TICK_MS);
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
