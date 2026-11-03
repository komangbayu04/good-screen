import { nanoid } from "nanoid";
import { DEFAULT_CAMERA_LAYOUT, DEFAULT_SCREEN_STYLE, autoZoomSegments, trackEnd, useEditor, type Asset, type CursorSample, type EditCommand } from "@goodscreen/editor-core";
import { fileToAsset } from "./media";
import { saveMedia } from "./persistence";

/**
 * Imports local files from any entry point (media tab, drag & drop, the recorder).
 * Each asset lands in Media and on the timeline.
 */
export async function importFiles(files: Iterable<File>) {
  const assets: Asset[] = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      const asset = await fileToAsset(file);
      if (!asset) {
        errors.push(`${file.name}: unsupported format`);
        continue;
      }
      useEditor.getState().addAsset(asset);
      void saveMedia(asset.id, file);
      assets.push(asset);
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : "couldn't be read"}`);
    }
  }
  return { assets, errors };
}

/**
 * A finished screen take: the screen file becomes a timeline clip dressed with the
 * default screen style; the webcam file is linked to it (not a separate clip).
 * With a pointer track, zooms that follow the pointer are added where it works in one area.
 */
export async function importScreenTake(screenFile: File, cameraFile: File | null, cursor?: CursorSample[]) {
  const screen = await fileToAsset(screenFile);
  if (!screen) throw new Error("couldn't read the screen recording");
  if (cursor?.length) screen.cursor = cursor;
  const camera = cameraFile ? await fileToAsset(cameraFile).catch(() => null) : null;

  const editor = useEditor.getState();
  editor.addAsset(screen, { place: false });
  void saveMedia(screen.id, screenFile);
  if (camera && cameraFile) {
    editor.addAsset(camera, { place: false });
    void saveMedia(camera.id, cameraFile);
  }

  const clipId = nanoid(8);
  const start = trackEnd(useEditor.getState().project, "video");
  // Fresh WebM files often report no duration yet; the pointer track tells how long it ran.
  const duration = Number.isFinite(screen.duration) && screen.duration > 0 ? screen.duration : (cursor?.at(-1)?.t ?? 0) + 1;
  const zooms: EditCommand[] = autoZoomSegments(cursor, duration).map((z) => ({
    type: "addZoom",
    start: start + z.start,
    duration: z.end - z.start,
    zoom: { x: z.x, y: z.y, follow: true },
  }));
  editor.dispatch([
    { type: "insertClip", id: clipId, assetId: screen.id, start },
    {
      type: "setClipProps",
      clipId,
      patch: {
        screen: {
          ...DEFAULT_SCREEN_STYLE,
          camera: camera ? { assetId: camera.id, ...DEFAULT_CAMERA_LAYOUT } : undefined,
        },
      },
    },
    ...zooms,
  ]);
  editor.select(clipId);
  return clipId;
}

export const ACCEPT_MEDIA = "video/*,audio/*,image/*";
