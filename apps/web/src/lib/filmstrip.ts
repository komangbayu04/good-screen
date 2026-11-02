"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { Asset } from "@goodscreen/editor-core";

/** Frames sampled evenly across a video asset, for the timeline filmstrip. Session cache only. */
type Strip = { times: number[]; frames: string[] };

const useStrips = create<Record<string, Strip>>(() => ({}));
const pending = new Set<string>();

const frameCount = (duration: number) => Math.max(4, Math.min(40, Math.ceil(duration / 1.2)));

async function extract(asset: Asset) {
  if (!asset.src || pending.has(asset.id)) return;
  pending.add(asset.id);
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  v.src = asset.src;
  try {
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error("load"));
    });
    const n = frameCount(asset.duration);
    const times = Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * asset.duration);
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = Math.round((120 * (v.videoHeight || 9)) / Math.max(1, v.videoWidth || 16));
    const ctx = canvas.getContext("2d")!;
    const frames: string[] = [];
    for (const t of times) {
      await new Promise<void>((res) => {
        const done = () => res();
        v.onseeked = () => ("requestVideoFrameCallback" in v ? v.requestVideoFrameCallback(done) : done());
        setTimeout(done, 600);
        v.currentTime = Math.min(t, Math.max(0, asset.duration - 0.05));
      });
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.6));
      // Publish progressively so the strip fills in while it is being built.
      useStrips.setState({ [asset.id]: { times: times.slice(0, frames.length), frames: [...frames] } });
    }
  } catch {
    // No filmstrip: the clip falls back to its single thumbnail.
  } finally {
    v.removeAttribute("src");
    v.load();
  }
}

export function useFilmstrip(asset: Asset | undefined): Strip | undefined {
  const strip = useStrips((s) => (asset ? s[asset.id] : undefined));
  useEffect(() => {
    if (asset?.kind === "video" && asset.src) void extract(asset);
  }, [asset]);
  return strip;
}

/** Index of the sampled frame nearest to source time t. */
export function nearestFrame(strip: Strip, t: number) {
  let best = 0;
  for (let i = 1; i < strip.times.length; i++) if (Math.abs(strip.times[i]! - t) < Math.abs(strip.times[best]! - t)) best = i;
  return best;
}
