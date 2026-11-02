"use client";

import { Frame, MousePointerClick } from "lucide-react";
import { FPS_OPTIONS, FRAME_PRESETS, framePresetOf, useEditor } from "@goodscreen/editor-core";
import { ClipInspector } from "./ClipInspector";
import { FieldLabel, Section } from "./controls";

/** Right panel: the selected clip's sub-menus, or project-level tools when nothing is selected. */
export function Inspector() {
  const clip = useEditor((s) => s.project.clips.find((c) => c.id === s.selectedClipId));
  const track = useEditor((s) => s.project.tracks.find((t) => t.id === clip?.trackId));
  const asset = useEditor((s) => s.project.assets.find((a) => a.id === clip?.assetId));

  if (clip && track) return <ClipInspector key={clip.id} clip={clip} track={track} asset={asset} />;

  return (
    // Same structure as a clip's Edit tab: a header line, then collapsible sections.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5 border-b border-ink/[0.06] px-3.5 py-3">
        <MousePointerClick className="size-4 shrink-0 text-muted" />
        <p className="text-xs leading-relaxed text-muted">
Pilih clip di timeline untuk mengeditnya.
        </p>
      </div>
      <div className="scroll-fade scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <Section title="Canvas" icon={Frame}>
          <FieldLabel>Frame</FieldLabel>
          <FramePicker />
          <FieldLabel>Frame rate</FieldLabel>
          <FpsPicker />
        </Section>
      </div>
    </div>
  );
}

export function FramePicker() {
  const project = useEditor((s) => s.project);
  const active = framePresetOf(project);
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {FRAME_PRESETS.map((f) => {
        const on = f.id === active.id;
        const scale = 22 / Math.max(f.width, f.height);
        return (
          <button
            key={f.id}
            title={f.hint}
            onClick={() => !on && useEditor.getState().setFormat({ width: f.width, height: f.height })}
            className={`flex flex-col items-center gap-1.5 rounded-xl py-2.5 text-meta transition-colors ${
              on ? "bg-secondary/10 text-fg ring-1 ring-secondary" : "bg-panel-3/40 text-muted hover:text-fg"
            }`}
          >
            <span className="flex h-6 items-center">
              <span
                className={`rounded-[3px] border-[1.5px] ${on ? "border-secondary" : "border-current"}`}
                style={{ width: f.width * scale, height: f.height * scale }}
              />
            </span>
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

export function FpsPicker() {
  const fps = useEditor((s) => s.project.fps);
  return (
    <div className="grid grid-cols-4 gap-1 rounded-full bg-panel-3/40 p-1">
      {FPS_OPTIONS.map((f) => (
        <button
          key={f}
          onClick={() => f !== fps && useEditor.getState().setFormat({ fps: f })}
          className={`h-7 rounded-full font-mono text-xs transition-colors ${f === fps ? "bg-secondary text-on-secondary" : "text-muted hover:text-fg"}`}
        >
          {f}
        </button>
      ))}
    </div>
  );
}
