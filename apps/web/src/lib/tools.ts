import { create } from "zustand";
import { DEFAULT_TRANSFORM, pickLayer, useEditor, type Clip, type EditCommand } from "@goodscreen/editor-core";
import { fileToAsset } from "./media";
import { saveMedia } from "./persistence";

/** Canvas tools next to the preview. Their settings live in their own popover, never in the Edit panel. */
export type ToolId = "background" | "zoom" | "camera";

/**
 * `active`: the tool whose settings show in the right panel.
 * `move`: the Geser tool (V), on by default: click a layer on the canvas to select it,
 * drag to move, corners to scale. Off, the canvas is just a player (click = play/pause).
 */
export const useTools = create<{
  active: ToolId | null;
  move: boolean;
  toggle: (t: ToolId) => void;
  open: (t: ToolId) => void;
  close: () => void;
  setMove: (on: boolean) => void;
}>((set, get) => ({
  active: null,
  move: true,
  toggle: (t) => set({ active: get().active === t ? null : t }),
  open: (t) => set({ active: t }),
  close: () => set({ active: null }),
  setMove: (move) => set({ move }),
}));

const videoTrackId = () => useEditor.getState().project.tracks.find((t) => t.kind === "video")?.id;

/** The footage clip under the playhead (selected one wins when it is on the video track). */
export function footageClip(): Clip | undefined {
  const { project, playhead, selectedClipId } = useEditor.getState();
  const vt = videoTrackId();
  const selected = project.clips.find((c) => c.id === selectedClipId && c.trackId === vt);
  if (selected) return selected;
  return project.clips.find((c) => c.trackId === vt && playhead >= c.start && playhead < c.start + c.duration);
}

/** The screen recording under the playhead, or the first one in the project. */
export function screenClip(): Clip | undefined {
  const { project, playhead } = useEditor.getState();
  const screens = project.clips.filter((c) => c.screen).sort((a, b) => a.start - b.start);
  return screens.find((c) => playhead >= c.start && playhead < c.start + c.duration) ?? screens[0];
}

export function resetPosition(clip: Clip): EditCommand {
  return clip.screen
    ? { type: "setClipProps", clipId: clip.id, patch: { screen: { offsetX: 0, offsetY: 0 } } }
    : { type: "setClipProps", clipId: clip.id, patch: { transform: { x: 0, y: 0, scale: 1 } } };
}

/** Command that places the clip at (x, y) %: transform for footage, frame offset for screen recordings. */
export function moveCommand(clip: Clip, x: number, y: number): EditCommand {
  const r = (n: number) => Math.round(n * 10) / 10;
  return clip.screen
    ? { type: "setClipProps", clipId: clip.id, patch: { screen: { offsetX: r(x), offsetY: r(y) } } }
    : { type: "setClipProps", clipId: clip.id, patch: { transform: { x: r(x), y: r(y) } } };
}

export const positionOf = (clip: Clip) =>
  clip.screen ? { x: clip.screen.offsetX ?? 0, y: clip.screen.offsetY ?? 0 } : { x: clip.transform?.x ?? DEFAULT_TRANSFORM.x, y: clip.transform?.y ?? DEFAULT_TRANSFORM.y };

/** The text box being typed into directly on the canvas. */
export const useCanvasEdit = create<{ editingId: string | null; edit: (id: string | null) => void }>((set) => ({
  editingId: null,
  edit: (editingId) => set({ editingId }),
}));

/**
 * Text tool: a new text clip at the playhead (on a free layer), selected and,
 * on desktop, opened for typing right on the canvas.
 */
export function addText({ typeOnCanvas = true }: { typeOnCanvas?: boolean } = {}) {
  const { playhead, project, dispatch, select } = useEditor.getState();
  const id = crypto.randomUUID().slice(0, 8);
  // Start on the frame the player is showing, so the new box is on screen to type into.
  const start = Math.floor(playhead * project.fps + 1e-6) / project.fps;
  dispatch([
    { type: "addCaption", id, start, duration: 3, text: typeOnCanvas ? "" : "Teks baru", style: "boxed" },
    // Centre of the frame reads as "a title", not a subtitle.
    { type: "setClipProps", clipId: id, patch: { captionY: 45, captionSize: 0.8 } },
  ]);
  select(id);
  if (typeOnCanvas) useCanvasEdit.getState().edit(id);
  return id;
}

/**
 * Picture tool: an image (or a clip) as its own layer on top of the footage, at the
 * playhead, at half size so it reads as an overlay, then selected for moving.
 * Audio goes on the audio track at the playhead instead.
 */
export async function addMediaLayer(file: File) {
  const asset = await fileToAsset(file);
  if (!asset || (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio")) throw new Error("Pilih file gambar, video, atau audio");
  const st = useEditor.getState();
  st.addAsset(asset, { place: false });
  void saveMedia(asset.id, file);
  const { project, playhead } = useEditor.getState();
  const start = Math.floor(playhead * project.fps + 1e-6) / project.fps;
  const duration = asset.kind === "image" ? 4 : asset.duration;
  const id = crypto.randomUUID().slice(0, 8);
  if (asset.kind === "audio") {
    st.dispatch([{ type: "insertClip", id, assetId: asset.id, start, duration }]);
    st.select(id);
    return id;
  }
  st.dispatch([
    { type: "insertClip", id, assetId: asset.id, start, duration, trackId: pickLayer(project, start, duration, "motion") },
    { type: "setClipProps", clipId: id, patch: { transform: { scale: 0.5 } } },
  ]);
  st.select(id);
  useTools.getState().setMove(true);
  return id;
}
