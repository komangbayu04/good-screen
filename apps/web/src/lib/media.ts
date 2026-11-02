import { nanoid } from "nanoid";
import type { Asset } from "@goodscreen/editor-core";

/** Reads a local file into an Asset: object URL, real duration, size and a thumbnail. */
export async function fileToAsset(file: File): Promise<Asset | null> {
  const src = URL.createObjectURL(file);
  const base = { id: nanoid(8), name: file.name, src, createdBy: "user" as const, createdAt: Date.now() };

  if (file.type.startsWith("video/")) {
    const meta = await probeVideo(src);
    return { ...base, kind: "video", ...meta };
  }
  if (file.type.startsWith("audio/")) {
    const duration = await probeAudio(src);
    return { ...base, kind: "audio", duration };
  }
  if (file.type.startsWith("image/")) {
    // Real size (overlays keep their shape) and a small data-URL thumbnail, which survives
    // a reload; the object URL in `src` does not.
    const meta = await probeImage(src).catch(() => ({}));
    return { ...base, kind: "image", duration: 3, ...meta };
  }
  URL.revokeObjectURL(src);
  return null;
}

function probeVideo(src: string): Promise<Pick<Asset, "duration" | "width" | "height" | "thumbnail">> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.playsInline = true;
    v.src = src;
    v.onerror = () => reject(new Error("Video tidak bisa dibaca"));
    let done = false;
    let probing = false;
    const finish = (thumbnail?: string) => {
      if (done) return;
      done = true;
      if (!Number.isFinite(v.duration) || v.duration <= 0) return reject(new Error("Durasi video tidak terbaca"));
      resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight, thumbnail });
    };
    const seekToThumb = () => {
      v.currentTime = Math.min(1, v.duration * 0.1);
    };
    const capture = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 180;
      canvas.height = Math.round((180 * v.videoHeight) / Math.max(1, v.videoWidth));
      canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
      finish(canvas.toDataURL("image/jpeg", 0.7));
    };
    v.onloadedmetadata = () => {
      // Some browsers (iOS) never decode a frame without a gesture: import anyway, without a thumbnail.
      setTimeout(() => finish(), 4000);
      // MediaRecorder WebM files report Infinity until the end is seeked once.
      if (Number.isFinite(v.duration)) seekToThumb();
      else {
        probing = true;
        v.currentTime = 1e101;
      }
    };
    v.onseeked = () => {
      if (probing) {
        if (!Number.isFinite(v.duration)) return;
        probing = false;
        return seekToThumb();
      }
      // Wait until the seeked frame is actually presented, otherwise the capture can be black.
      // (the callback may never fire for a detached video, so fall back after a short delay).
      if ("requestVideoFrameCallback" in v) v.requestVideoFrameCallback(() => capture());
      setTimeout(capture, 300);
    };
  });
}

function probeAudio(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.src = src;
    a.onloadedmetadata = () => resolve(a.duration);
    a.onerror = () => reject(new Error("Audio tidak bisa dibaca"));
  });
}

export const formatDuration = (s: number) => (s < 10 ? `${s.toFixed(1)}s` : formatTime(s));

export const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export const formatTimecode = (s: number, fps: number) => {
  const f = Math.floor((s % 1) * fps);
  return `${formatTime(s)}:${f.toString().padStart(2, "0")}`;
};

function probeImage(src: string): Promise<Pick<Asset, "width" | "height" | "thumbnail">> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = 240 / Math.max(img.naturalWidth, img.naturalHeight, 1);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
      resolve({ width: img.naturalWidth, height: img.naturalHeight, thumbnail: c.toDataURL("image/jpeg", 0.75) });
    };
    img.onerror = () => reject(new Error("Gambar tidak bisa dibaca"));
    img.src = src;
  });
}
