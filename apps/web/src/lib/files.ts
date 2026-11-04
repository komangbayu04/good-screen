import { useEditor, type Asset, type Project } from "@goodscreen/editor-core";
import { deleteMedia } from "./persistence";

/** Webcam takes recorded alongside a screen recording (they belong to that recording). */
const linkedCameras = (project: Project, assetId: string) =>
  [...new Set(project.clips.filter((c) => c.assetId === assetId && c.screen?.camera).map((c) => c.screen!.camera!.assetId))];

/**
 * The files a person manages in a project: recordings and uploads. A recording's own
 * webcam take isn't listed separately: it goes with its recording.
 */
export function projectFiles(project: Project): Asset[] {
  const cameras = new Set(project.clips.flatMap((c) => (c.screen?.camera ? [c.screen.camera.assetId] : [])));
  return project.assets.filter((a) => a.kind !== "motion" && !cameras.has(a.id));
}

/**
 * Deletes a whole project for good, with every recording and upload in it (their stored
 * originals too). Can't be undone, so ask first.
 */
export async function deleteProject(projectId: string) {
  const { project, otherProjects, deleteProject: remove } = useEditor.getState();
  const target = [project, ...otherProjects].find((p) => p.id === projectId);
  if (!target) return;
  const ids = target.assets.filter((a) => a.kind !== "motion").map((a) => a.id);
  const urls = target.assets.filter((a) => a.src).map((a) => a.src!);
  remove(projectId);
  urls.forEach((u) => URL.revokeObjectURL(u));
  await deleteMedia(ids);
}

/** Zoom segments that only magnify this file's footage (none of the remaining footage). */
function orphanedZooms(project: Project, assetId: string) {
  const overlaps = (a: { start: number; duration: number }, b: { start: number; duration: number }) => a.start < b.start + b.duration && b.start < a.start + a.duration;
  const mine = project.clips.filter((c) => c.assetId === assetId);
  const rest = project.clips.filter((c) => c.assetId && c.assetId !== assetId && project.assets.some((a) => a.id === c.assetId && a.kind === "video"));
  return project.clips.filter((z) => z.zoom && mine.some((c) => overlaps(z, c)) && !rest.some((c) => overlaps(z, c))).map((z) => z.id);
}

/**
 * Deletes a file for good: from the project (its clips too, and zooms that only covered
 * it), along with a recording's webcam take, and frees the stored original.
 * Can't be undone, so ask first.
 */
export async function deleteFile(assetId: string) {
  const { project, purgeAssets } = useEditor.getState();
  const ids = [assetId, ...linkedCameras(project, assetId)];
  const urls = project.assets.filter((a) => ids.includes(a.id) && a.src).map((a) => a.src!);
  purgeAssets(ids, orphanedZooms(project, assetId));
  urls.forEach((u) => URL.revokeObjectURL(u));
  await deleteMedia(ids);
}
