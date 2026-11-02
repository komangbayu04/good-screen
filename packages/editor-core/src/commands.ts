import { nanoid } from "nanoid";
import { DEFAULT_SCREEN_STYLE, DEFAULT_ZOOM } from "./types";
import type { Asset, CaptionStyle, Clip, KeyEase, KeyProp, LayerContent, MotionSpec, Project, ScreenCamera, ScreenStyle, TrackKind, Transition, ZoomSpec } from "./types";
import { ADJUST_PROPS, KEY_EPS, TRANSFORM_PROPS, isKeyed, propAt, sourceTime, upsertKey } from "./keyframes";

/**
 * Edit commands are the single language every part of the UI uses
 * to change a project. They are plain JSON so a model can emit them and the
 * backend can persist / replay them.
 */
export type EditCommand =
  /** `trackId` of a layer puts an image or video on top of the footage (overlay / picture-in-picture). */
  | { type: "insertClip"; id?: string; assetId: string; start: number; duration?: number; offset?: number; transitionIn?: Transition; kenBurns?: boolean; trackId?: string }
  | { type: "trimClip"; clipId: string; offset?: number; duration?: number }
  /** `trackId` moves an overlay clip to another layer. */
  | { type: "moveClip"; clipId: string; start: number; trackId?: string }
  | { type: "splitClip"; clipId: string; at: number }
  | { type: "deleteClip"; clipId: string }
  /** A track kind, or a kind of overlay content (all captions, all motion, all zoom). */
  | { type: "clearTrack"; track: TrackKind | LayerContent }
  | { type: "rippleTrack"; track: TrackKind | LayerContent }
  | { type: "addCaption"; id?: string; start: number; duration: number; text: string; style?: CaptionStyle; trackId?: string }
  | { type: "createMotion"; id?: string; name: string; motion: MotionSpec; start: number; duration: number; trackId?: string }
  | { type: "setTransition"; clipId: string; transition: Transition }
  | { type: "setClipProps"; clipId: string; patch: ClipPatch }
  | { type: "setSpeed"; clipId: string; speed: number }
  | { type: "addZoom"; id?: string; start: number; duration: number; zoom?: Partial<ZoomSpec>; trackId?: string }
  | { type: "setMotionProps"; clipId: string; props: MotionSpec["props"] }
  /** Keyframes: `t` is source time. Without `v` the current (animated) value is keyed. */
  | { type: "setKeyframe"; clipId: string; prop: KeyProp; t: number; v?: number; ease?: KeyEase }
  | { type: "removeKeyframe"; clipId: string; t: number; props?: KeyProp[] }
  | { type: "moveKeyframe"; clipId: string; from: number; to: number; props?: KeyProp[] }
  | { type: "setKeyframeEase"; clipId: string; t: number; ease: KeyEase; props?: KeyProp[] }
  | { type: "clearKeyframes"; clipId: string; props?: KeyProp[] };

/** Everything about a clip that can be edited without moving it on the timeline. */
export type ClipPatch = Partial<Omit<Clip, "id" | "trackId" | "assetId" | "createdBy" | "start" | "duration" | "offset" | "motion" | "screen" | "zoom" | "keyframes">> & {
  /** Merged into the clip's screen style; `camera` is merged too, `null` unlinks it. */
  screen?: Partial<Omit<ScreenStyle, "camera">> & { camera?: Partial<ScreenCamera> | null };
  zoom?: Partial<ZoomSpec>;
};

export const MIN_CLIP = 0.2;
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;

/** Seconds of source a clip may still cover from its in-point, on the timeline (speed-aware). */
function maxTimelineLength(asset: Asset | undefined, offset: number, speed = 1) {
  if (!asset || (asset.kind !== "video" && asset.kind !== "audio")) return Infinity;
  return (asset.duration - offset) / speed;
}

export function trackFor(project: Project, kind: TrackKind) {
  const t = project.tracks.find((t) => t.kind === kind);
  if (!t) throw new Error(`No ${kind} track`);
  return t;
}

export function trackKindForAsset(asset: Asset): TrackKind {
  if (asset.kind === "audio") return "audio";
  if (asset.kind === "motion") return "layer";
  return "video";
}

export function trackEnd(project: Project, kind: TrackKind) {
  const ids = project.tracks.filter((t) => t.kind === kind).map((t) => t.id);
  return project.clips
    .filter((c) => ids.includes(c.trackId))
    .reduce((m, c) => Math.max(m, c.start + c.duration), 0);
}

/** Overlay layers, front (Layer 3) to back (Layer 1). */
export const layerTracks = (project: Project) => project.tracks.filter((t) => t.kind === "layer");

/** What a clip holds, independent of the row it sits on. */
export function clipRole(c: Pick<Clip, "zoom" | "motion" | "text">): LayerContent | "media" {
  if (c.zoom) return "zoom";
  if (c.motion) return "motion";
  if (c.text !== undefined) return "caption";
  return "media";
}

const PREFERRED_LAYER: Record<LayerContent, number> = { caption: 0, motion: 1, zoom: 2 };

/**
 * The layer a new overlay clip lands on: its preferred layer when that spot is free,
 * else the nearest layer with room, else the preferred one anyway.
 */
export function pickLayer(project: Project, start: number, duration: number, role: LayerContent, ignoreId?: string): string {
  const layers = layerTracks(project);
  if (!layers.length) throw new Error("No layer tracks");
  const pref = Math.min(layers.length - 1, PREFERRED_LAYER[role]);
  const order = layers.map((_, i) => i).sort((a, b) => Math.abs(a - pref) - Math.abs(b - pref) || a - b);
  const free = (id: string) =>
    !project.clips.some((c) => c.id !== ignoreId && c.trackId === id && c.start < start + duration - 1e-3 && c.start + c.duration > start + 1e-3);
  const hit = order.find((i) => free(layers[i]!.id));
  return layers[hit ?? pref]!.id;
}

const validLayer = (project: Project, id?: string) => (id && project.tracks.some((t) => t.id === id && t.kind === "layer") ? id : undefined);
const inScope = (project: Project, c: Clip, track: TrackKind | LayerContent) =>
  track === "video" || track === "audio" || track === "layer" ? project.tracks.find((t) => t.id === c.trackId)?.kind === track : clipRole(c) === track;

export function projectDuration(project: Project) {
  return project.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
}

const r = (n: number) => Math.round(n * 100) / 100;

/** Mutates `project` (call inside an immer producer). Unknown ids are ignored. */
export function applyCommand(project: Project, cmd: EditCommand, author: Clip["createdBy"]) {
  const findClip = (id: string) => project.clips.find((c) => c.id === id);

  switch (cmd.type) {
    case "insertClip": {
      const asset = project.assets.find((a) => a.id === cmd.assetId);
      if (!asset) return;
      const offset = Math.max(0, cmd.offset ?? 0);
      const maxLen = maxTimelineLength(asset, offset);
      const duration = Math.max(MIN_CLIP, Math.min(cmd.duration ?? asset.duration, maxLen));
      const kind = trackKindForAsset(asset);
      project.clips.push({
        id: cmd.id ?? nanoid(8),
        trackId:
          (asset.kind === "image" || asset.kind === "video") && validLayer(project, cmd.trackId)
            ? cmd.trackId!
            : kind === "layer"
              ? pickLayer(project, cmd.start, duration, "motion")
              : trackFor(project, kind).id,
        assetId: asset.id,
        start: r(Math.max(0, cmd.start)),
        duration: r(duration),
        offset: r(offset),
        motion: asset.motion,
        transitionIn: cmd.transitionIn ?? "none",
        kenBurns: cmd.kenBurns,
        volume: 1,
        createdBy: author,
      });
      return;
    }
    case "trimClip": {
      const c = findClip(cmd.clipId);
      if (!c) return;
      const asset = project.assets.find((a) => a.id === c.assetId);
      if (cmd.offset !== undefined) c.offset = r(Math.max(0, cmd.offset));
      if (cmd.duration !== undefined) {
        c.duration = r(Math.max(MIN_CLIP, Math.min(cmd.duration, maxTimelineLength(asset, c.offset, c.speed))));
      }
      return;
    }
    case "moveClip": {
      const c = findClip(cmd.clipId);
      if (!c) return;
      c.start = r(Math.max(0, cmd.start));
      // Only overlay clips change rows, and only between layers.
      const to = validLayer(project, cmd.trackId);
      if (to && project.tracks.find((t) => t.id === c.trackId)?.kind === "layer") c.trackId = to;
      return;
    }
    case "splitClip": {
      const c = findClip(cmd.clipId);
      if (!c) return;
      const local = cmd.at - c.start;
      if (local < MIN_CLIP || c.duration - local < MIN_CLIP) return;
      project.clips.push({
        ...c,
        id: nanoid(8),
        start: r(cmd.at),
        duration: r(c.duration - local),
        offset: r(c.offset + local * (c.speed ?? 1)),
        transitionIn: "none",
      });
      c.duration = r(local);
      return;
    }
    case "deleteClip":
      project.clips = project.clips.filter((c) => c.id !== cmd.clipId);
      return;
    case "clearTrack":
      project.clips = project.clips.filter((c) => !inScope(project, c, cmd.track));
      return;
    case "rippleTrack": {
      let t = 0;
      project.clips
        .filter((c) => inScope(project, c, cmd.track))
        .sort((a, b) => a.start - b.start)
        .forEach((c) => {
          c.start = r(t);
          t += c.duration;
        });
      return;
    }
    case "addCaption":
      project.clips.push({
        id: cmd.id ?? nanoid(8),
        trackId: validLayer(project, cmd.trackId) ?? pickLayer(project, cmd.start, Math.max(MIN_CLIP, cmd.duration), "caption"),
        start: r(Math.max(0, cmd.start)),
        duration: r(Math.max(MIN_CLIP, cmd.duration)),
        offset: 0,
        text: cmd.text,
        captionStyle: cmd.style ?? "bold",
        createdBy: author,
      });
      return;
    case "createMotion": {
      // Every generated motion becomes a reusable asset AND lands on the timeline.
      const assetId = nanoid(8);
      project.assets.push({
        id: assetId,
        kind: "motion",
        name: cmd.name,
        duration: cmd.duration,
        motion: cmd.motion,
        createdBy: author,
        createdAt: Date.now(),
      });
      project.clips.push({
        id: cmd.id ?? nanoid(8),
        trackId: validLayer(project, cmd.trackId) ?? pickLayer(project, cmd.start, Math.max(MIN_CLIP, cmd.duration), "motion"),
        assetId,
        start: r(Math.max(0, cmd.start)),
        duration: r(Math.max(MIN_CLIP, cmd.duration)),
        offset: 0,
        motion: cmd.motion,
        createdBy: author,
      });
      return;
    }
    case "setTransition": {
      const c = findClip(cmd.clipId);
      if (c) c.transitionIn = cmd.transition;
      return;
    }
    case "setClipProps": {
      const c = findClip(cmd.clipId);
      if (!c) return;
      const { transform, adjust, screen, zoom, ...rest } = cmd.patch;
      Object.assign(c, rest);
      // Nested groups are merged so a single control only touches its own field.
      if (transform) c.transform = { ...c.transform, ...transform };
      if (adjust) c.adjust = { ...c.adjust, ...adjust };
      if (screen) {
        const camera = screen.camera === undefined ? c.screen?.camera : screen.camera === null ? undefined : ({ ...c.screen?.camera, ...screen.camera } as ScreenCamera);
        c.screen = { ...DEFAULT_SCREEN_STYLE, ...c.screen, ...screen, camera };
      }
      if (zoom) c.zoom = { ...DEFAULT_ZOOM, ...c.zoom, ...zoom };
      return;
    }
    case "addZoom":
      project.clips.push({
        id: cmd.id ?? nanoid(8),
        trackId: validLayer(project, cmd.trackId) ?? pickLayer(project, cmd.start, Math.max(MIN_CLIP, cmd.duration), "zoom"),
        start: r(Math.max(0, cmd.start)),
        duration: r(Math.max(MIN_CLIP, cmd.duration)),
        offset: 0,
        zoom: { ...DEFAULT_ZOOM, ...cmd.zoom },
        createdBy: author,
      });
      return;
    case "setSpeed": {
      const c = findClip(cmd.clipId);
      if (!c) return;
      const asset = project.assets.find((a) => a.id === c.assetId);
      const speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, cmd.speed));
      // Keep the same stretch of source: faster speed -> shorter clip on the timeline.
      const sourceSpan = c.duration * (c.speed ?? 1);
      c.speed = Math.round(speed * 100) / 100;
      c.duration = r(Math.max(MIN_CLIP, Math.min(sourceSpan / c.speed, maxTimelineLength(asset, c.offset, c.speed))));
      return;
    }
    case "setMotionProps": {
      const c = findClip(cmd.clipId);
      if (c?.motion) c.motion.props = { ...c.motion.props, ...cmd.props };
      return;
    }
    case "setKeyframe": {
      const c = findClip(cmd.clipId);
      if (c) upsertKey(c, cmd.prop, cmd.t, cmd.v ?? propAt(c, cmd.prop, cmd.t), cmd.ease);
      return;
    }
    case "removeKeyframe":
    case "moveKeyframe":
    case "setKeyframeEase":
    case "clearKeyframes": {
      const c = findClip(cmd.clipId);
      if (!c?.keyframes) return;
      for (const p of Object.keys(c.keyframes) as KeyProp[]) {
        if (cmd.props && !cmd.props.includes(p)) continue;
        let keys = c.keyframes[p] ?? [];
        const at = (k: { t: number }) => "t" in cmd && Math.abs(k.t - cmd.t) < KEY_EPS;
        if (cmd.type === "clearKeyframes") keys = [];
        else if (cmd.type === "removeKeyframe") keys = keys.filter((k) => !at(k));
        else if (cmd.type === "setKeyframeEase") keys.forEach((k) => at(k) && (k.ease = cmd.ease));
        else {
          const moving = keys.find((k) => Math.abs(k.t - cmd.from) < KEY_EPS);
          if (moving) {
            keys = keys.filter((k) => k === moving || Math.abs(k.t - cmd.to) >= KEY_EPS);
            moving.t = Math.round(cmd.to * 1000) / 1000;
            keys.sort((a, b) => a.t - b.t);
          }
        }
        if (keys.length) c.keyframes[p] = keys;
        else delete c.keyframes[p];
      }
      if (!Object.keys(c.keyframes).length) delete c.keyframes;
      return;
    }
  }
}

/**
 * CapCut behaviour: once a property has keyframes, changing it edits (or adds) the
 * keyframe at the playhead instead of the static value. Used by the store for every
 * user/agent command, so sliders, the Move tool and number boxes all animate.
 */
export function resolveKeyed(project: Project, cmd: EditCommand, playhead: number): EditCommand[] {
  if (cmd.type !== "setClipProps") return [cmd];
  const c = project.clips.find((x) => x.id === cmd.clipId);
  if (!c?.keyframes) return [cmd];
  const t = sourceTime(c, Math.min(c.start + c.duration, Math.max(c.start, playhead)));
  const keyed: EditCommand[] = [];
  const patch = { ...cmd.patch };
  const take = (group: "transform" | "adjust", props: KeyProp[]) => {
    const src = patch[group] as Record<string, unknown> | undefined;
    if (!src) return;
    const rest = { ...src };
    for (const p of props)
      if (typeof rest[p] === "number" && isKeyed(c, p)) {
        keyed.push({ type: "setKeyframe", clipId: c.id, prop: p, t, v: rest[p] as number });
        delete rest[p];
      }
    (patch as Record<string, unknown>)[group] = Object.keys(rest).length ? rest : undefined;
  };
  take("transform", TRANSFORM_PROPS);
  take("adjust", ADJUST_PROPS);
  if (typeof patch.volume === "number" && isKeyed(c, "volume")) {
    keyed.push({ type: "setKeyframe", clipId: c.id, prop: "volume", t, v: patch.volume });
    delete patch.volume;
  }
  if (!keyed.length) return [cmd];
  const remaining = Object.values(patch).some((v) => v !== undefined);
  return remaining ? [{ ...cmd, patch }, ...keyed] : keyed;
}
