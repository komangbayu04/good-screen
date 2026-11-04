import type { CursorSample, CursorShape } from "@goodscreen/editor-core";

/**
 * The pointer detector behind `trackCursor` (see cursor-track.ts): template matching on
 * captured frames. Uses no DOM, so it runs in a worker.
 */

const FULL_SCAN_MS = 100;
const DIFF_W = 480; // diff image width (at least; see DIFF_MAX_SHRINK)
/**
 * The diff image never shrinks the capture more than this: on a wide capture (several
 * monitors, 5760 px) a fixed 480 px would shrink a pointer to under two pixels, too faint
 * to show as a change, so it was never found.
 */
const DIFF_MAX_SHRINK = 4;
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
/**
 * A click shows as the screen changing under or near a pointer that has stopped (a
 * button pressing, a menu opening, a page loading). Hover effects start as the pointer
 * arrives, so it must have rested this long first (s), and the change must be this close
 * (share of the recording's width) or cover this much of the screen (a new page).
 */
const CLICK_REST_S = 0.15;
const CLICK_NEAR = 0.08;
const CLICK_PAGE = 0.3;

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
  /** A few outline points spread around the shape, checked first (see `score`). */
  keys: Int32Array;
};

/** Indices into `edge` of up to 8 points spread evenly through it. */
function keysOf(edge: number[]) {
  const n = edge.length / 2;
  const k = Math.min(8, n);
  return Int32Array.from({ length: k }, (_, i) => Math.floor(((i + 0.5) * n) / k) * 2);
}

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
  return { shape, scale, step: SCALES.indexOf(scale), w, h: Math.ceil(h) + 1, hx: Math.round(hot[0] * h), hy: Math.round(hot[1] * h), mode: "outlined", fill: Int32Array.from(fill), edge: Int32Array.from(edge), keys: keysOf(edge) };
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
  return { shape: "text", scale, step: SCALES.indexOf(scale), w, h: top + h + 2, hx: cx, hy: top + Math.round(h / 2), mode: "contrast", fill: Int32Array.from(fill), edge: Int32Array.from(edge), keys: keysOf(edge) };
}

const TEMPLATES: Template[] = SCALES.flatMap((s) => [outlined("arrow", s, ARROW, [0, 0]), iBeam(s), outlined("hand", s, HAND, HAND_HOT)]);
/** Every other size, for a first search anywhere: one of them is within a step of any pointer, and refines from there. */
const COARSE = TEMPLATES.filter((t) => t.step % 2 === 0);
/** A new find becomes the pointer once it moves; one that sits still this long is dropped (s). */
const CANDIDATE_S = 0.6;
/**
 * How complete a find must be to become a candidate, and to stay one while it moves.
 * Lower than ACQUIRE_COVER: moving is the real proof, and a scaled pointer's anti-aliased
 * edges often keep it just under that.
 */
const CANDIDATE_COVER = 0.95;
const CONFIRM_COVER = 0.93;
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
function score(luma: Uint8Array, stride: number, cols: number, rows: number, t: Template, ox: number, oy: number, out: { cover: number }) {
  out.cover = 0;
  if (ox < 3 || oy < 1 || ox + t.w + 3 >= cols || oy + t.h + 1 >= rows) return 0;
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
    // Quick reject first: on a light page every position passes the fill test, so a few
    // outline points (which most positions lack) settle it before the full count.
    if (t.mode === "outlined") {
      let keyMiss = 0;
      for (let k = 0; k < t.keys.length && keyMiss < 2; k++) if (nearOutline(t.keys[k]!, light) === 0) keyMiss++;
      if (keyMiss >= 2) continue;
    }
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

/**
 * A match: hotspot, template, score, how complete the shape was (see `score`), and the
 * brightness under the template's points (to tell a resting pointer from a look-alike).
 */
type Hit = { x: number; y: number; t: Template; s: number; cover: number; sig: Uint8Array };

/**
 * A match that stays put while its own pixels change isn't the pointer: something moved
 * over or off it (a play icon or a button the pointer was on). Real pointers are drawn on
 * top and don't change while they rest. Share of points that must change to call it: a
 * few points may sit on the background beside the outline, which a button under a resting
 * pointer changes when it's clicked.
 */
const DECOY_CHANGE = 0.3;
/** How long a look-alike is ignored once found out, seconds. */
const DECOY_FOR_S = 3;
/** A match that never moved is dropped after this many full scans with motion this far (px) from it. */
const STILL_SCANS = 3;
const STILL_FAR = 32;

/** Share of points whose brightness moved by more than 40 between two signatures. */
function changedShare(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length || !a.length) return 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > 40) n++;
  return n / a.length;
}

/** A detector for one capture: feed it frames with their recording time. */
export function createDetector() {
  // The frame being analysed: its brightness, one byte per pixel, rows `stride` apart.
  let Y: Uint8Array = new Uint8Array(0);
  let stride = 0;
  let vw = 0;
  let vh = 0;

  let prev: Uint8Array | null = null;
  /** The full frame at the previous diff scan, to tell which pixels of a spot changed. */
  let prevFull: Uint8Array | null = null;
  let prevStride = 0;
  /** The last diff scan's changed cells (count per cell), for click detection. */
  let diff: { cells: Uint8Array; cw: number; ch: number; size: number; share: number } | null = null;
  /** Last hotspot, its template, how far it moved since the frame before, and its `sig`. */
  let last: {
    x: number;
    y: number;
    t: Template;
    vx: number;
    vy: number;
    time: number;
    sig: Uint8Array;
    /** Has it moved since it was found, full scans it sat still while things moved elsewhere, its first sample. */
    moved: boolean;
    idle: number;
    from: number;
  } | null = null;
  /** Look-alikes found out recently (see DECOY_CHANGE): never matched until `until`. */
  let decoys: { x: number; y: number; until: number }[] = [];
  /**
   * Pointer-like finds not yet trusted. A pointer found in a changed spot is moving, so
   * the first one that moves wins; a glyph that changes in place (a clock, a counter, a
   * play icon the pointer just left) never does.
   */
  let candidates: { x: number; y: number; t: Template; since: number; seen: number; dx: number; dy: number }[] = [];
  let now = 0;
  const samples: CursorSample[] = [];
  /** Lowest index where samples were taken back since the last `takeCut` (Infinity = none). */
  let cut = Infinity;

  /** Best match among `templates` with its hotspot inside [x0, x1] × [y0, y1] (capture pixels). */
  const search = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    templates: Template[],
    near?: { x: number; y: number },
    gate?: (hx: number, hy: number) => boolean,
  ): Hit | null => {
    // Whole-frame coordinates: the frame is read into memory once, every search reads that.
    // (`score` rejects positions whose template would leave the frame.)
    x0 = Math.max(x0, 0);
    y0 = Math.max(y0, 0);
    x1 = Math.min(x1, vw - 1);
    y1 = Math.min(y1, vh - 1);
    if (x1 < x0 || y1 < y0) return null;
    const luma = Y;
    const [sx, sy, sw, sh] = [0, 0, stride, vh];
    let best: Omit<Hit, "sig"> | null = null;
    let bestRank = -Infinity;
    const parts = { cover: 0 };
    const isDecoy = (hx: number, hy: number) => decoys.some((d) => Math.abs(d.x - hx) <= 4 && Math.abs(d.y - hy) <= 4);
    for (const t of templates)
      for (let hy = Math.ceil(y0); hy <= y1; hy++)
        for (let hx = Math.ceil(x0); hx <= x1; hx++) {
          if (gate && !gate(hx, hy)) continue;
          if (decoys.length && isDecoy(hx, hy)) continue;
          const s = score(luma, sw, vw, sh, t, hx - t.hx - sx, hy - t.hy - sy, parts);
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
    if (!best) return null;
    // Brightness under the match's points, compared next frame to spot a look-alike.
    const { t, x, y } = best;
    const pts = [...t.fill, ...t.edge];
    const sig = new Uint8Array(pts.length / 2);
    for (let i = 0; i < pts.length; i += 2) sig[i / 2] = luma[(y - t.hy - sy + pts[i + 1]!) * sw + (x - t.hx - sx + pts[i]!)]!;
    return { ...best, sig };
  };

  /** Small changed spots since the previous full scan, in capture pixels. */
  const changedSpots = () => {
    const dw = Math.min(vw, Math.max(DIFF_W, Math.ceil(vw / DIFF_MAX_SHRINK)));
    const dh = Math.floor((vh / vw) * dw);
    if (prev && prev.length !== dw * dh) prev = null;
    // A small copy: each pixel the average of its block (a 2-pixel grid of it, enough for a diff).
    const k = vw / dw;
    const luma = new Uint8Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      const ry0 = Math.floor(y * k);
      const ry1 = Math.min(vh, Math.floor((y + 1) * k));
      for (let x = 0; x < dw; x++) {
        const rx0 = Math.floor(x * k);
        const rx1 = Math.min(vw, Math.floor((x + 1) * k));
        let sum = 0;
        let n = 0;
        for (let ry = ry0; ry < ry1; ry += 2) for (let rx = rx0, row = ry * stride; rx < rx1; rx += 2, n++) sum += Y[row + rx]!;
        luma[y * dw + x] = n ? sum / n : 0;
      }
    }
    const spots: { x0: number; y0: number; x1: number; y1: number }[] = [];
    diff = null;
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
      diff = { cells, cw, ch, size: (vw / dw) * CELL, share: changed / cells.length };
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
            spots.push({ x0: (x0 - 1) * CELL * k, y0: (y0 - 1) * CELL * k, x1: (x1 + 2) * CELL * k, y1: (y1 + 2) * CELL * k });
          }
        }
      }
    }
    prev = luma;
    return spots;
  };

  /**
   * For a spot: whether the pixels within 2 px of a hotspot changed since the previous scan.
   * A pointer that just arrived changed at its tip, so a search there skips the many
   * positions where nothing moved (far cheaper on a big screen).
   */
  const changedGate = (s: { x0: number; y0: number; x1: number; y1: number }) => {
    if (!prevFull || prevStride !== stride) return undefined;
    const pf = prevFull;
    const x0 = Math.max(0, Math.floor(s.x0) - 2);
    const y0 = Math.max(0, Math.floor(s.y0) - 2);
    const x1 = Math.min(vw - 1, Math.ceil(s.x1) + 2);
    const y1 = Math.min(vh - 1, Math.ceil(s.y1) + 2);
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (w <= 0 || h <= 0) return undefined;
    // Summed-area table of changed pixels: any change in a 5×5 window in O(1).
    const sum = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        const i = (y0 + y) * stride + x0 + x;
        if (Math.abs(Y[i]! - pf[i]!) > 40) row++;
        sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1]! + row;
      }
    }
    return (hx: number, hy: number) => {
      const ax = Math.max(0, hx - 2 - x0);
      const ay = Math.max(0, hy - 2 - y0);
      const bx = Math.min(w, hx + 3 - x0);
      const by = Math.min(h, hy + 3 - y0);
      if (bx <= ax || by <= ay) return false;
      return sum[by * (w + 1) + bx]! - sum[ay * (w + 1) + bx]! - sum[by * (w + 1) + ax]! + sum[ay * (w + 1) + ax]! > 0;
    };
  };

  /** Changed cells within `r` capture pixels of (x, y) in the last diff scan. */
  const changedNear = (x: number, y: number, r: number) => {
    if (!diff) return 0;
    const { cells, cw, ch, size } = diff;
    let n = 0;
    for (let cy = Math.max(0, Math.floor((y - r) / size)); cy <= Math.min(ch - 1, Math.floor((y + r) / size)); cy++)
      for (let cx = Math.max(0, Math.floor((x - r) / size)); cx <= Math.min(cw - 1, Math.floor((x + r) / size)); cx++) if (cells[cy * cw + cx]! >= 2) n++;
    return n;
  };
  /** Where the pointer stopped and since when; one click per stop (a blinking caret isn't more clicks). */
  let rest: { x: number; y: number; since: number; armed: boolean } | null = null;
  let lastFullT = -Infinity;

  /** One frame at recording time `t`; `full` adds the diff scan (≈10×/s). */
  const tick = (t: number, full: boolean) => {
    if (!vw || !vh) return;
    now = t;
    if (decoys.length) decoys = decoys.filter((d) => d.until > now);
    let found: Hit | null = null;
    if (last) {
      // 1a. Where it should be now (last position plus last move), same template: the
      //     common case, and cheap enough for every frame.
      const dt = t - last.time;
      const px = Math.round(last.x + last.vx * dt);
      const py = Math.round(last.y + last.vy * dt);
      found = search(px - QUICK_RADIUS, py - QUICK_RADIUS, px + QUICK_RADIUS, py + QUICK_RADIUS, [last.t], last);
      // 1b. Not there: maybe it stopped (prediction overshot), so where it was; then wider,
      //     with the sizes either side and all three shapes (it may have sped up, or turned
      //     into an I-beam or a hand).
      if (!found) found = search(last.x - QUICK_RADIUS, last.y - QUICK_RADIUS, last.x + QUICK_RADIUS, last.y + QUICK_RADIUS, [last.t], last);
      if (!found) {
        // Frames the worker skipped (it was busy) mean the pointer had longer to move.
        const r = LOCAL_RADIUS * Math.min(3, Math.max(1, dt * 30));
        const box = { x0: last.x - r, y0: last.y - r, x1: last.x + r, y1: last.y + r };
        // Where it went, pixels changed: look only there (cheap even with a wide radius).
        found = search(box.x0, box.y0, box.x1, box.y1, nearScale(last.t.scale), last, changedGate(box));
      } else if (full) {
        // 1c. A few times a second, let the size correct itself around the match.
        found = search(found.x - 2, found.y - 2, found.x + 2, found.y + 2, nearScale(found.t.scale), found) ?? found;
      }
    }
    // 1e. No pointer yet: the candidate that moves becomes it.
    let confirmed = false;
    if (!last && candidates.length) {
      const next: typeof candidates = [];
      for (const c of candidates) {
        if (t - c.since > CANDIDATE_S) continue;
        const r = LOCAL_RADIUS * Math.min(3, Math.max(1, (t - c.seen) * 30));
        const box = { x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r };
        const hit = search(box.x0, box.y0, box.x1, box.y1, nearScale(c.t.scale), c, changedGate(box));
        if (!hit || hit.cover < CONFIRM_COVER) continue;
        // Moved, and gone from where it was (a letter typed beside another leaves the first).
        // Twice the same way: a glyph that changes (a counter) makes a match hop about.
        const dx = hit.x - c.x;
        const dy = hit.y - c.y;
        const moved = Math.hypot(dx, dy) > 2 && !search(c.x - 1, c.y - 1, c.x + 1, c.y + 1, [c.t]);
        if (moved && (c.dx || c.dy) && dx * c.dx + dy * c.dy > 0.5 * Math.hypot(dx, dy) * Math.hypot(c.dx, c.dy)) {
          found = hit;
          confirmed = true;
          break;
        }
        next.push(moved ? { ...c, x: hit.x, y: hit.y, t: hit.t, seen: t, dx, dy } : { ...c, t: hit.t, seen: t });
      }
      candidates = confirmed ? [] : next;
    }
    // 1d. Still in the same place as the same shape, but the pixels under it changed:
    //     that's a look-alike (a play icon, a button) the pointer was on, not the pointer.
    const resting = !!found && !!last && found.x === last.x && found.y === last.y && found.t === last.t;
    if (found && last && resting && changedShare(found.sig, last.sig) > DECOY_CHANGE) {
      decoys.push({ x: found.x, y: found.y, until: t + DECOY_FOR_S });
      found = null;
      last = null;
    }
    // 2. In the spots that changed; any shape and scale if the pointer was lost. While the
    //    match rests, a clear pointer moving elsewhere wins too (the resting one may be a
    //    look-alike that never changes, with the real pointer gone off it).
    if (full) {
      const spots = changedSpots();
      const lockedAt = found;
      if (!found && !last) {
        // Nothing yet: what looks like a pointer in the changed spots becomes a candidate.
        for (const s of spots.slice(0, 4)) {
          const rough = search(s.x0, s.y0, s.x1, s.y1, COARSE, undefined, changedGate(s));
          // The coarse size may be a step off: settle the size before judging the match.
          const hit = rough && (search(rough.x - 3, rough.y - 3, rough.x + 3, rough.y + 3, nearScale(rough.t.scale), rough) ?? rough);
          if (hit && hit.cover >= CANDIDATE_COVER && !candidates.some((c) => Math.hypot(c.x - hit.x, c.y - hit.y) < 8))
            candidates.push({ x: hit.x, y: hit.y, t: hit.t, since: t, seen: t, dx: 0, dy: 0 });
        }
      } else if (!found || resting)
        for (const s of spots.slice(0, 4)) {
          if (lockedAt && lockedAt.x >= s.x0 && lockedAt.x <= s.x1 && lockedAt.y >= s.y0 && lockedAt.y <= s.y1) continue;
          const gate = changedGate(s);
          let hit = lockedAt
            ? search(s.x0, s.y0, s.x1, s.y1, COARSE, undefined, gate)
            : (search(s.x0, s.y0, s.x1, s.y1, nearScale(last!.t.scale), last!, gate) ?? search(s.x0, s.y0, s.x1, s.y1, COARSE, undefined, gate));
          if (hit && lockedAt && hit.cover < ACQUIRE_COVER) hit = null;
          if (hit && (!found || found === lockedAt || hit.s > found.s)) found = hit;
        }
      if (lockedAt && found !== lockedAt) {
        // Moved off a resting match: that one was a look-alike.
        decoys.push({ x: lockedAt.x, y: lockedAt.y, until: t + DECOY_FOR_S });
        last = null;
      } else if (lockedAt && last && !last.moved) {
        // Found where the pointer just left (a play icon it had covered) and never moved
        // since, while something keeps moving elsewhere: that's the pointer, this isn't.
        const far = (s: { x0: number; y0: number; x1: number; y1: number }) =>
          Math.max(s.x0 - lockedAt.x, lockedAt.x - s.x1, s.y0 - lockedAt.y, lockedAt.y - s.y1) > STILL_FAR;
        last.idle = spots.some(far) ? last.idle + 1 : 0;
        if (last.idle >= STILL_SCANS) {
          decoys.push({ x: lockedAt.x, y: lockedAt.y, until: t + DECOY_FOR_S });
          samples.length = last.from; // it was never the pointer
          cut = Math.min(cut, last.from);
          last = null;
          found = null;
        }
      }
    }
    if (full) {
      // Keep this frame for the next scan's changed-pixel test (the frame buffer gets reused).
      const n = stride * vh;
      if (!prevFull || prevFull.length !== n) prevFull = new Uint8Array(n);
      prevFull.set(Y.subarray(0, n));
      prevStride = stride;
    }
    const prevFullT = lastFullT;
    if (full) lastFullT = t;
    if (!found) {
      // One blurred frame isn't a lost pointer; give up only when the full scan misses too.
      if (full) last = null;
      rest = null;
      return;
    }
    if (!rest || Math.hypot(found.x - rest.x, found.y - rest.y) > 2) rest = { x: found.x, y: found.y, since: t, armed: true };
    // The previous scan must already have the pointer resting, so its own move isn't the change.
    const clicked =
      full &&
      rest.armed &&
      prevFullT >= rest.since &&
      t - rest.since >= CLICK_REST_S &&
      (changedNear(found.x, found.y, CLICK_NEAR * vw) >= 2 || (diff?.share ?? 0) >= CLICK_PAGE);
    if (clicked) rest.armed = false;
    // While it rests, keep comparing against how it looked when it stopped (slow changes add up).
    const sig = last && found.x === last.x && found.y === last.y && found.t === last.t ? last.sig : found.sig;
    const same = !!last && found.x === last.x && found.y === last.y;
    last = {
      x: found.x,
      y: found.y,
      t: found.t,
      // Per second: frames the worker had to skip don't throw the prediction off.
      vx: last && t > last.time ? (found.x - last.x) / (t - last.time) : 0,
      vy: last && t > last.time ? (found.y - last.y) / (t - last.time) : 0,
      time: t,
      sig,
      moved: confirmed || (!!last && (last.moved || !same)),
      idle: last && same ? last.idle : 0,
      from: last ? last.from : samples.length,
    };
    const sample: CursorSample = { t: Math.round(t * 1000) / 1000, x: Math.round((found.x / vw) * 1e5) / 1e5, y: Math.round((found.y / vh) * 1e5) / 1e5 };
    if (found.t.shape !== "arrow") sample.s = found.t.shape;
    if (clicked) sample.c = 1;
    // A resting pointer needs only a sample now and then; a moving one gets every frame.
    const prevSample = samples[samples.length - 1];
    if (!clicked && prevSample && prevSample.x === sample.x && prevSample.y === sample.y && prevSample.s === sample.s && t - prevSample.t < REST_SAMPLE_S) return;
    samples.push(sample);
  };

  const safeTick = (t: number, full: boolean) => {
    try {
      tick(t, full);
    } catch {
      // A frame that can't be read (track ended) is just skipped.
    }
  };

  return {
    samples,
    takeCut: () => {
      const c = cut;
      cut = Infinity;
      return c;
    },
    /**
     * One frame at recording time `t`: its brightness (`luma`, rows `rowStride` apart) and size.
     * `full` adds the diff scan (≈10×/s).
     */
    frame: (luma: Uint8Array, rowStride: number, w: number, h: number, t: number, full: boolean) => {
      Y = luma;
      stride = rowStride;
      vw = w;
      vh = h;
      safeTick(t, full);
    },
  };
}

export const FULL_SCAN_INTERVAL_MS = FULL_SCAN_MS;
