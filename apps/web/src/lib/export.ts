import { canRenderMediaOnWeb, renderMediaOnWeb } from "@remotion/web-renderer";
import { projectDuration, type Project } from "@goodscreen/editor-core";
import { ReelComposition } from "@goodscreen/motion";

export type ExportContainer = "mp4" | "webm";

/**
 * Renders the project in the browser with the same composition the preview uses
 * and encodes it with WebCodecs. No upload, no server.
 */
export async function exportProject(
  project: Project,
  opts: { container: ExportContainer; scale: number; signal: AbortSignal; onProgress: (ratio: number) => void },
): Promise<Blob> {
  const width = project.width;
  const height = project.height;
  const fps = project.fps;
  const durationInFrames = Math.max(fps, Math.ceil(projectDuration(project) * fps));

  const check = await canRenderMediaOnWeb({ container: opts.container, width, height, scale: opts.scale });
  if (!check.canRender) {
    throw new Error(check.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; ") || "This browser can't render video yet");
  }

  const result = await renderMediaOnWeb({
    composition: { component: ReelComposition, id: "reel", width, height, fps, durationInFrames, defaultProps: { project } },
    inputProps: { project },
    container: opts.container,
    scale: opts.scale,
    videoBitrate: "high",
    signal: opts.signal,
    onProgress: (p) => opts.onProgress(p.progress),
  });
  return result.getBlob();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const fileName = (name: string, container: ExportContainer) =>
  `${name.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "reel"}.${container}`;
