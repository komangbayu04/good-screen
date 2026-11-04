import type { CursorSample } from "@goodscreen/editor-core";
import { FULL_SCAN_INTERVAL_MS, createDetector } from "./cursor-detect";

/**
 * Finds the mouse pointer in a screen-capture stream while it records.
 *
 * Browsers never tell a page where the pointer is outside its own tab, but the
 * capture has the pointer drawn in. So:
 *  - every frame, look for the pointer close to where it last was (cheap, and it keeps
 *    up with fast moves, so a zoom that follows it stays on it);
 *  - ~10 times a second, also diff a small copy of the frame with the previous one to
 *    find small changed spots (a moving pointer leaves two) and look there, which finds
 *    the pointer again after a jump or when it was lost.
 * The arrow, the text I-beam and the link hand are recognised; other shapes leave a gap.
 * Clicks are marked too (the screen changing under a pointer that stopped), for auto-zoom.
 *
 * The work runs in a worker that reads the frames itself: on the main thread a slow
 * search froze the page being recorded (and with it the recording). Frames it can't keep
 * up with are dropped there, never held, so the capture never runs short of frames.
 */

export interface CursorTracker {
  /** Samples so far (updated a couple of times a second). */
  samples: CursorSample[];
  /** Stops tracking and resolves with every sample. */
  stop: () => Promise<CursorSample[]>;
}

type ProcessorCtor = new (o: { track: MediaStreamTrack; maxBufferSize?: number }) => { readable: ReadableStream<VideoFrame> };

/**
 * Track the pointer in `track`. `time()` returns the recording time in seconds,
 * or null while paused (no samples then).
 */
export function trackCursor(track: MediaStreamTrack, time: () => number | null): CursorTracker {
  const Processor = (globalThis as unknown as { MediaStreamTrackProcessor?: ProcessorCtor }).MediaStreamTrackProcessor;
  if (Processor && typeof Worker !== "undefined") {
    try {
      return inWorker(track, time, Processor);
    } catch {
      // A browser that can't hand the frames to a worker uses the fallback below.
    }
  }
  return onMainThread(track, time);
}

function inWorker(track: MediaStreamTrack, time: () => number | null, Processor: ProcessorCtor): CursorTracker {
  const own = track.clone();
  // Holds at most one waiting frame: older ones are dropped while the worker is busy.
  const { readable } = new Processor({ track: own, maxBufferSize: 1 });
  const worker = new Worker(new URL("./cursor-worker.ts", import.meta.url), { type: "module" });
  const samples: CursorSample[] = [];
  let finish: ((s: CursorSample[]) => void) | null = null;
  worker.onmessage = (e: MessageEvent<{ type: "samples" | "done"; from: number; samples: CursorSample[] }>) => {
    samples.length = Math.min(samples.length, e.data.from);
    samples.push(...e.data.samples);
    if (e.data.type === "done") finish?.(samples);
  };
  // The worker keeps the recording clock itself between readings (it only changes speed on pause/resume).
  const sendClock = () => worker.postMessage({ type: "clock", elapsed: time(), at: Date.now() });
  sendClock();
  const clockId = setInterval(sendClock, 250);
  worker.postMessage({ type: "start", readable }, [readable as unknown as Transferable]);

  let done: Promise<CursorSample[]> | null = null;
  return {
    samples,
    stop: () => {
      if (done) return done;
      clearInterval(clockId);
      done = new Promise<CursorSample[]>((resolve) => {
        const end = () => {
          worker.terminate();
          own.stop();
          resolve(samples);
        };
        finish = end;
        // Never wait long for the last samples: the recording matters more.
        setTimeout(end, 1500);
        worker.postMessage({ type: "stop" });
      });
      return done;
    },
  };
}

/** Without worker support: sample a <video> of the track ~10×/s on the main thread. */
function onMainThread(track: MediaStreamTrack, time: () => number | null): CursorTracker {
  const detector = createDetector();
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  let luma = new Uint8Array(0);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  void video.play().catch(() => {});
  const id = setInterval(() => {
    const now = time();
    if (now === null || video.readyState < 2) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (ctx.canvas.width !== w || ctx.canvas.height !== h) [ctx.canvas.width, ctx.canvas.height] = [w, h];
    ctx.drawImage(video, 0, 0);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    if (luma.length !== w * h) luma = new Uint8Array(w * h);
    for (let i = 0, p = 0; p < luma.length; i += 4, p++) luma[p] = (rgba[i]! * 77 + rgba[i + 1]! * 150 + rgba[i + 2]! * 29) >> 8;
    detector.frame(luma, w, w, h, now, true);
  }, FULL_SCAN_INTERVAL_MS);
  return {
    samples: detector.samples,
    stop: async () => {
      clearInterval(id);
      video.srcObject = null;
      return detector.samples;
    },
  };
}
