"use client";

import { FPS_OPTIONS, FRAME_PRESETS, framePresetOf, useEditor } from "@goodscreen/editor-core";
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
      </div>
    </div>
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
