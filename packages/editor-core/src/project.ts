import { nanoid } from "nanoid";
import type { Project, Track } from "./types";

export const LAYER_COUNT = 3;

const track = (id: string, kind: Track["kind"], name: string): Track => ({ id, kind, name, muted: false, hidden: false, locked: false });

/** Top to bottom: Layer 3 (front) .. Layer 1, then the footage and the audio. */
function baseTracks(): Track[] {
  return [
    ...Array.from({ length: LAYER_COUNT }, (_, i) => track(`layer-${LAYER_COUNT - i}`, "layer", `Layer ${LAYER_COUNT - i}`)),
    track("video", "video", "Video"),
    track("audio", "audio", "Audio"),
  ];
}

/** Legacy content tracks map onto layers: captions in front, motion in the middle, zoom at the back. */
const LEGACY_LAYER: Record<string, string> = { caption: "layer-3", motion: "layer-2", zoom: "layer-1" };

/**
 * Brings older projects to the current track layout: missing tracks are added and
 * clips from the old caption / motion / zoom tracks move onto the generic layers.
 */
export function ensureTracks(p: Project): Project {
  const base = baseTracks();
  const ok = p.tracks.length === base.length && base.every((b) => p.tracks.some((t) => t.id === b.id && t.kind === b.kind));
  if (ok) return p;
  const tracks = base.map((b) => {
    const existing = p.tracks.find((t) => t.id === b.id || (b.kind !== "layer" && t.kind === b.kind));
    return existing ? { ...existing, id: b.id, kind: b.kind, name: b.name } : b;
  });
  const idOf = new Map<string, string>();
  for (const t of p.tracks) {
    const kind = t.kind as string;
    if (LEGACY_LAYER[kind]) idOf.set(t.id, LEGACY_LAYER[kind]!);
    else if (kind === "video" || kind === "audio") idOf.set(t.id, kind);
    else if (tracks.some((x) => x.id === t.id)) idOf.set(t.id, t.id);
  }
  const clips = p.clips.map((c) => ({
    ...c,
    trackId: idOf.get(c.trackId) ?? (c.zoom ? "layer-1" : c.motion ? "layer-2" : c.text !== undefined ? "layer-3" : "video"),
  }));
  return { ...p, tracks, clips };
}

/** Frame presets (all 1080 px on the short side). Screen recordings default to 16:9. */
export const FRAME_PRESETS = [
  { id: "16:9", label: "16:9", hint: "Layar / YouTube", width: 1920, height: 1080 },
  { id: "1:1", label: "1:1", hint: "Square", width: 1080, height: 1080 },
  { id: "4:5", label: "4:5", hint: "Feed Instagram", width: 1080, height: 1350 },
  { id: "9:16", label: "9:16", hint: "Reels / TikTok / Shorts", width: 1080, height: 1920 },
] as const;

export const FPS_OPTIONS = [24, 25, 30, 60] as const;

export const framePresetOf = (p: Pick<Project, "width" | "height">) =>
  FRAME_PRESETS.find((f) => f.width === p.width && f.height === p.height) ?? FRAME_PRESETS[0];

export function createProject(name = "Rekaman tanpa judul"): Project {
  return {
    id: nanoid(10),
    name,
    updatedAt: Date.now(),
    fps: 30,
    width: 1920,
    height: 1080,
    assets: [],
    clips: [],
    tracks: baseTracks(),
  };
}
