"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { framePresetOf, projectDuration, useEditor } from "@goodscreen/editor-core";
import { downloadBlob, exportProject, fileName, type ExportContainer } from "@/lib/export";
import { formatTime } from "@/lib/media";
import { pause } from "@/lib/player-bridge";
import { Segmented } from "./controls";

type Phase = { kind: "idle" } | { kind: "rendering"; ratio: number } | { kind: "done"; blob: Blob; name: string } | { kind: "error"; message: string };

// Max 2K: beyond that the in-browser encoder gets slow and memory-hungry.
const QUALITY = [
  { id: "720", label: "720p", scale: 2 / 3, hint: "Smaller file, faster export." },
  { id: "1080", label: "1080p", scale: 1, hint: "Recommended for LinkedIn, X and Threads." },
  { id: "1440", label: "2K", scale: 4 / 3, hint: "Sharpest; slower to export." },
] as const;

const FORMAT_HINT: Record<ExportContainer, string> = {
  mp4: "Plays everywhere, including every social platform.",
  webm: "Smaller file; some platforms don't accept it.",
};

/** Native <dialog>: Escape, focus trap and inert background come from the platform. */
export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController | null>(null);
  const project = useEditor((s) => s.project);
  const [container, setContainer] = useState<ExportContainer>("mp4");
  const [quality, setQuality] = useState<(typeof QUALITY)[number]["id"]>("1080");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const duration = projectDuration(project);
  const empty = project.clips.length === 0;
  const scale = QUALITY.find((q) => q.id === quality)!.scale;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      pause();
      setPhase((p) => (p.kind === "rendering" ? p : { kind: "idle" }));
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const start = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: "rendering", ratio: 0 });
    try {
      const blob = await exportProject(project, {
        container,
        scale,
        signal: controller.signal,
        onProgress: (ratio) => setPhase({ kind: "rendering", ratio }),
      });
      const name = fileName(project.name, container);
      setPhase({ kind: "done", blob, name });
      downloadBlob(blob, name);
    } catch (e) {
      if (controller.signal.aborted) setPhase({ kind: "idle" });
      else
        setPhase({
          kind: "error",
          message: `Export failed (${e instanceof Error ? e.message : "unknown error"}). Try WebM or 720p, or use the latest Chrome.`,
        });
    } finally {
      abort.current = null;
    }
  };

  const outW = Math.round(project.width * scale);
  const outH = Math.round(project.height * scale);

  return (
    <dialog
      ref={ref}
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
      className="m-auto w-[min(420px,calc(100%-32px))] frost rounded-[20px] border border-ink/[0.14] bg-panel p-0 text-fg shadow-2xl backdrop:bg-black/60 open:motion-safe:starting:scale-[0.97] open:starting:opacity-0 transition-[opacity,scale,display,overlay] duration-200 ease-[var(--ease-out)] transition-discrete"
      aria-labelledby="export-title"
    >
      <div className="flex items-center justify-between px-5 pt-5">
        <h2 id="export-title" className="text-title font-semibold">
          Export video
        </h2>
        <button
          onClick={() => ref.current?.close()}
          aria-label="Close"
          className="flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-panel-3 hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-4 px-5 pt-3 pb-5">
        <dl className="grid grid-cols-3 gap-2 rounded-[12px] bg-panel-2/70 p-3 text-center">
          <Stat label="Duration" value={formatTime(duration)} />
          <Stat label="Frame" value={framePresetOf(project).label} />
          <Stat label="Size" value={`${outW}×${outH}`} />
        </dl>

        <div className="space-y-2">
          <p className="text-xs text-fg/75">Format</p>
          <Segmented
            options={[
              { id: "mp4", label: "MP4" },
              { id: "webm", label: "WebM" },
            ]}
            value={container}
            onChange={setContainer}
          />
          <p className="text-meta text-muted">{FORMAT_HINT[container]}</p>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-fg/75">Quality</p>
          <Segmented options={QUALITY.map(({ id, label }) => ({ id, label }))} value={quality} onChange={setQuality} />
          <p className="text-meta text-muted">{QUALITY.find((q) => q.id === quality)!.hint}</p>
        </div>

        {phase.kind === "rendering" && (
          <div className="space-y-1.5" role="status">
            <div className="flex justify-between text-meta text-muted">
              <span>Rendering on your device…</span>
              <span className="font-mono tabular-nums">{Math.round(phase.ratio * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-panel-3">
              <div className="h-full origin-left bg-secondary transition-transform duration-150" style={{ transform: `scaleX(${phase.ratio})` }} />
            </div>
          </div>
        )}
        {phase.kind === "done" && (
          <p role="status" className="text-meta text-fg/80">
            {phase.name} is ready ({(phase.blob.size / 1024 / 1024).toFixed(1)} MB). The download starts automatically.
          </p>
        )}
        {phase.kind === "error" && (
          <p role="alert" className="rounded-[10px] bg-red-500/10 px-3 py-2 text-meta leading-relaxed text-red-300">
            {phase.message}
          </p>
        )}
        {empty && <p className="text-meta text-muted">The timeline is empty. Add a video, then export.</p>}

        <div className="flex gap-2 pt-1">
          {phase.kind === "rendering" ? (
            <button onClick={() => abort.current?.abort()} className="h-10 flex-1 rounded-full bg-panel-3 text-sm font-medium transition-colors hover:bg-line">
              Cancel
            </button>
          ) : phase.kind === "done" ? (
            <button
              onClick={() => downloadBlob(phase.blob, phase.name)}
              className="bg-accent-grad flex h-10 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold text-on-accent"
            >
              <Download className="size-4" /> Download again
            </button>
          ) : (
            <button
              onClick={start}
              disabled={empty}
              className="bg-accent-grad flex h-10 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold text-on-accent disabled:opacity-40"
            >
              {phase.kind === "error" ? "Try again" : `Export ${container.toUpperCase()}`}
            </button>
          )}
        </div>
        {phase.kind === "rendering" && (
          <p className="flex items-center justify-center gap-1 text-2xs text-muted">
            <Loader2 className="size-3 animate-spin" /> Keep this tab open until it finishes.
          </p>
        )}
      </div>
    </dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-2xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-mono text-xs tabular-nums">{value}</dd>
    </div>
  );
}
