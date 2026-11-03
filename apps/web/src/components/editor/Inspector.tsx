"use client";

import { useState } from "react";
import { Film, Image as ImageIcon, Music, Trash2 } from "lucide-react";
import { FPS_OPTIONS, FRAME_PRESETS, framePresetOf, useEditor } from "@goodscreen/editor-core";
import { deleteFile, projectFiles } from "@/lib/files";
import { formatDuration } from "@/lib/media";
import { ClipInspector } from "./ClipInspector";
import { FieldLabel } from "./controls";

/** Right panel: the selected clip's sub-menus, or project-level tools when nothing is selected. */
export function Inspector() {
  const clip = useEditor((s) => s.project.clips.find((c) => c.id === s.selectedClipId));
  const track = useEditor((s) => s.project.tracks.find((t) => t.id === clip?.trackId));
  const asset = useEditor((s) => s.project.assets.find((a) => a.id === clip?.assetId));

  if (clip && track) return <ClipInspector key={clip.id} clip={clip} track={track} asset={asset} />;

  return (
    // Nothing selected: the project's output settings, titled like every other panel
    // (same header height as the tool panels), as flat labelled groups.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center border-b border-ink/[0.06] px-4">
        <h2 className="text-ui font-semibold">Canvas</h2>
      </div>
      <div className="scroll-fade scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <Group label="Aspect ratio">
          <FramePicker detailed />
        </Group>
        <Group label="Frame rate">
          <FpsPicker />
        </Group>
        <OutputSize />
        <Files />
        <p className="text-meta leading-relaxed text-muted">Select a clip on the timeline to edit it.</p>
      </div>
    </div>
  );
}

/**
 * The project's recordings and uploads, each deletable. Deleting frees the stored file
 * and can't be undone, so the row turns into a confirmation first.
 */
function Files() {
  const project = useEditor((s) => s.project);
  const files = projectFiles(project);
  const [confirming, setConfirming] = useState<string | null>(null);
  if (!files.length) return null;
  return (
    <Group label="Files">
      <ul className="space-y-1">
        {files.map((a) => {
          const Icon = a.kind === "video" ? Film : a.kind === "audio" ? Music : ImageIcon;
          const used = project.clips.filter((c) => c.assetId === a.id).length;
          return (
            <li key={a.id} className="flex h-11 items-center gap-2.5 rounded-[10px] bg-panel-3/40 pr-1.5 pl-1.5">
              {confirming === a.id ? (
                <>
                  <p className="min-w-0 flex-1 truncate pl-1 text-xs text-fg/90">
                    Delete this file{used ? ` and its ${used === 1 ? "clip" : `${used} clips`}` : ""}? This can&apos;t be undone.
                  </p>
                  <button onClick={() => setConfirming(null)} className="h-7 shrink-0 rounded-[7px] px-2.5 text-xs text-muted transition-colors hover:text-fg">
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setConfirming(null);
                      void deleteFile(a.id);
                    }}
                    className="h-7 shrink-0 rounded-[7px] bg-red-500/90 px-2.5 text-xs font-medium text-white transition-colors hover:bg-red-500"
                  >
                    Delete
                  </button>
                </>
              ) : (
                <>
                  <span className="flex h-8 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-panel-3">
                    {a.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.thumbnail} alt="" className="size-full object-cover" />
                    ) : (
                      <Icon className="size-3.5 text-muted" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-fg/90" title={a.name}>
                      {a.name}
                    </span>
                    <span className="block font-mono text-2xs text-muted tabular-nums">
                      {a.kind === "image" ? "Image" : formatDuration(a.duration)}
                      {used ? ` · on timeline` : ""}
                    </span>
                  </span>
                  <button
                    onClick={() => setConfirming(a.id)}
                    aria-label={`Delete ${a.name}`}
                    title="Delete file"
                    className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-muted transition-colors hover:bg-panel-3 hover:text-red-400"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Group>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

function OutputSize() {
  const width = useEditor((s) => s.project.width);
  const height = useEditor((s) => s.project.height);
  return (
    <div className="flex items-center justify-between">
      <FieldLabel>Output size</FieldLabel>
      <span className="font-mono text-xs text-fg/90 tabular-nums">
        {width} × {height} <span className="text-muted">px</span>
      </span>
    </div>
  );
}

/**
 * Aspect ratio cards: a true-to-shape outline, the ratio, and (when `detailed`) its name.
 * Where each one is used is in the tooltip. Selected = tinted fill + secondary ring,
 * the same as every other card picker (cursor style, camera layout, animation).
 */
export function FramePicker({ detailed }: { detailed?: boolean }) {
  const project = useEditor((s) => s.project);
  const active = framePresetOf(project);
  return (
    <div role="radiogroup" aria-label="Aspect ratio" className="grid grid-cols-4 gap-1.5">
      {FRAME_PRESETS.map((f) => {
        const on = f.id === active.id;
        const scale = 20 / Math.max(f.width, f.height);
        return (
          <button
            key={f.id}
            role="radio"
            aria-checked={on}
            title={f.hint}
            onClick={() => !on && useEditor.getState().setFormat({ width: f.width, height: f.height })}
            className={`flex flex-col items-center gap-1 rounded-[10px] pt-2.5 pb-2 transition-colors ${
              on ? "is-selected" : "bg-panel-3/40 text-muted hover:bg-panel-3/70 hover:text-fg"
            }`}
          >
            <span className="flex h-6 items-center" aria-hidden="true">
              <span
                className={`rounded-[3px] border ${on ? "border-secondary bg-secondary/10" : "border-current"}`}
                style={{ width: f.width * scale, height: f.height * scale }}
              />
            </span>
            <span className="font-mono text-meta tabular-nums">{f.label}</span>
            {detailed && <span className={`text-2xs ${on ? "text-fg/70" : "text-muted"}`}>{f.name}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Frame rate: the same segmented control as Format and Quality elsewhere. */
export function FpsPicker() {
  const fps = useEditor((s) => s.project.fps);
  return (
    <div role="radiogroup" aria-label="Frame rate" className="grid grid-cols-4 gap-1 rounded-[10px] bg-panel-3/50 p-1">
      {FPS_OPTIONS.map((f) => (
        <button
          key={f}
          role="radio"
          aria-checked={f === fps}
          aria-label={`${f} fps`}
          onClick={() => f !== fps && useEditor.getState().setFormat({ fps: f })}
          className={`h-7 rounded-[7px] font-mono text-xs tabular-nums transition-colors ${f === fps ? "is-selected font-medium" : "text-muted hover:text-fg"}`}
        >
          {f}
        </button>
      ))}
    </div>
  );
}
