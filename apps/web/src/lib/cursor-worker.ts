/// <reference lib="webworker" />
import type { CursorSample } from "@goodscreen/editor-core";
import { FULL_SCAN_INTERVAL_MS, createDetector } from "./cursor-detect";
import { frameLuma } from "./frame-luma";

/**
 * Runs the pointer detector off the main thread (see trackCursor): a slow search must
 * never stall the page being recorded, or the recording itself.
 *
 * In: { readable } frames to read; { clock } the recording time (null = paused) and when
 * it was read; { stop }. Out: { samples } new samples now and then, { done } the rest at
 * the end; both say from which index they replace the list.
 */
type In =
  | { type: "start"; readable: ReadableStream<VideoFrame> }
  | { type: "clock"; elapsed: number | null; at: number }
  | { type: "stop" };

const post = (msg: { type: "samples" | "done"; from: number; samples: CursorSample[] }) => (self as unknown as Worker).postMessage(msg);

const detector = createDetector();
let clock: { elapsed: number | null; at: number } = { elapsed: null, at: 0 };
let sent = 0;
let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
let stopped = false;

/** Recording time now, extrapolated from the last clock reading (null while paused). */
const now = () => (clock.elapsed === null ? null : clock.elapsed + (Date.now() - clock.at) / 1000);

/** New samples since the last flush; `from` = where they go (earlier ones may have been taken back). */
const flush = (type: "samples" | "done") => {
  const all = detector.samples;
  const from = Math.min(sent, detector.takeCut(), all.length);
  post({ type, from, samples: all.slice(from) });
  sent = all.length;
};

async function run(readable: ReadableStream<VideoFrame>) {
  reader = readable.getReader();
  let lastFull = -Infinity;
  // Frame timestamps say when a frame was captured. The smallest (recording time − frame
  // time) seen is the least delayed reading of the offset between the two clocks.
  let offset = Infinity;
  let lastFlush = 0;
  const scratch = { buf: new Uint8Array(0), luma: new Uint8Array(0) };
  while (!stopped) {
    const { value: frame, done } = await reader.read().catch(() => ({ value: undefined, done: true as const }));
    if (done || !frame) break;
    const t = now();
    if (t !== null) {
      const ts = frame.timestamp / 1e6;
      offset = Math.min(offset, t - ts);
      const full = frame.timestamp - lastFull >= FULL_SCAN_INTERVAL_MS * 1000 * 0.95;
      if (full) lastFull = frame.timestamp;
      try {
        const { luma, stride, w, h } = await frameLuma(frame, scratch);
        frame.close(); // free the capture's frame before the search
        detector.frame(luma, stride, w, h, ts + offset, full);
      } catch {
        // A frame that can't be read is skipped.
      }
    }
    frame.close();
    if (Date.now() - lastFlush > 500) {
      lastFlush = Date.now();
      flush("samples");
    }
  }
}

self.onmessage = (e: MessageEvent<In>) => {
  const msg = e.data;
  if (msg.type === "start") void run(msg.readable);
  else if (msg.type === "clock") clock = { elapsed: msg.elapsed, at: msg.at };
  else {
    stopped = true;
    void reader?.cancel().catch(() => {});
    flush("done");
  }
};
