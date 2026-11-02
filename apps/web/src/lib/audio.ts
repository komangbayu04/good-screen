import { nanoid } from "nanoid";
import type { Clip, ClipPatch, EditCommand, Project } from "@goodscreen/editor-core";

/** Decoded audio per media URL; decoding a long file is the slow part, so do it once. */
const decoded = new Map<string, Promise<AudioBuffer>>();

export function decodeAudio(src: string): Promise<AudioBuffer> {
  let p = decoded.get(src);
  if (!p) {
    p = (async () => {
      const data = await fetch(src).then((r) => r.arrayBuffer());
      const ctx = new AudioContext();
      try {
        return await ctx.decodeAudioData(data);
      } finally {
        void ctx.close();
      }
    })();
    p.catch(() => decoded.delete(src));
    decoded.set(src, p);
  }
  return p;
}

/** Mono samples of [from, to) seconds, resampled to `sampleRate` (Whisper wants 16 kHz). */
export async function monoSlice(buffer: AudioBuffer, from: number, to: number, sampleRate = buffer.sampleRate) {
  const length = Math.max(1, Math.ceil((to - from) * sampleRate));
  const ctx = new OfflineAudioContext(1, length, sampleRate);
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.connect(ctx.destination);
  node.start(0, from, to - from);
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}

export interface SilenceOptions {
  /** Below this loudness (dBFS) a window counts as silent. */
  thresholdDb: number;
  /** Only gaps at least this long are removed (seconds). */
  minSilence: number;
  /** Breathing room kept on each side of speech (seconds). */
  padding: number;
}

/** Speech ranges (in source seconds) inside [from, to). */
export async function findSpeech(buffer: AudioBuffer, from: number, to: number, opts: SilenceOptions) {
  const rate = 8000;
  const samples = await monoSlice(buffer, from, to, rate);
  const win = Math.round(rate * 0.02); // 20 ms windows
  const silent: boolean[] = [];
  for (let i = 0; i < samples.length; i += win) {
    let sum = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) sum += samples[j]! * samples[j]!;
    const rms = Math.sqrt(sum / Math.max(1, end - i));
    silent.push(20 * Math.log10(rms + 1e-9) < opts.thresholdDb);
  }
  const step = win / rate;
  const gaps: [number, number][] = [];
  let runStart = -1;
  silent.forEach((s, i) => {
    if (s && runStart < 0) runStart = i;
    if ((!s || i === silent.length - 1) && runStart >= 0) {
      const runEnd = s ? i + 1 : i;
      const a = runStart * step;
      const b = runEnd * step;
      if (b - a >= opts.minSilence) gaps.push([a + (runStart === 0 ? 0 : opts.padding), b - (runEnd >= silent.length ? 0 : opts.padding)]);
      runStart = -1;
    }
  });
  const speech: [number, number][] = [];
  let cursor = 0;
  for (const [a, b] of gaps) {
    if (a > cursor + 0.05) speech.push([from + cursor, from + a]);
    cursor = Math.max(cursor, b);
  }
  if (to - from - cursor > 0.05) speech.push([from + cursor, to]);
  return speech;
}

/** Everything about a clip except where it sits, to copy onto the pieces. */
function clipLook(c: Clip): ClipPatch {
  const { id: _i, trackId: _t, assetId: _a, start: _s, duration: _d, offset: _o, motion: _m, createdBy: _c, transitionIn: _ti, ...rest } = c;
  return rest;
}

/**
 * Commands that replace `clip` by its speech pieces, back to back, and pull the
 * rest of the track left by the time removed. One dispatch = one undo step.
 */
export function silenceCommands(project: Project, clip: Clip, speech: [number, number][]) {
  const speed = clip.speed ?? 1;
  const commands: EditCommand[] = [{ type: "deleteClip", clipId: clip.id }];
  let cursor = clip.start;
  speech.forEach(([a, b], i) => {
    const id = nanoid(8);
    const duration = (b - a) / speed;
    commands.push({ type: "insertClip", id, assetId: clip.assetId!, start: cursor, offset: a, duration, transitionIn: i === 0 ? clip.transitionIn : "none" });
    // The out-animation belongs to the last piece only.
    const patch = i < speech.length - 1 ? { ...clipLook(clip), transitionOut: "none" as const } : clipLook(clip);
    commands.push({ type: "setClipProps", clipId: id, patch });
    cursor += duration;
  });
  const removed = clip.start + clip.duration - cursor;
  project.clips
    .filter((c) => c.trackId === clip.trackId && c.id !== clip.id && c.start >= clip.start + clip.duration - 0.01)
    .forEach((c) => commands.push({ type: "moveClip", clipId: c.id, start: c.start - removed }));
  return { commands, removed, pieces: speech.length };
}
