"use client";

import { useEffect, useRef } from "react";
import { CircleDot, Image as ImageIcon, ImagePlus, MousePointer2, Plus, Type, Webcam, X, ZoomIn, type LucideIcon } from "lucide-react";
import { useEditor } from "@goodscreen/editor-core";
import { toast } from "@/lib/toast";
import { addMediaLayer, addText, footageClip, screenClip, useTools, type ToolId } from "@/lib/tools";
import { seek } from "@/lib/player-bridge";
import { BackgroundTab, CameraTab, ZoomTab } from "./ScreenInspector";

const TOOLS: { id: ToolId; label: string; icon: LucideIcon }[] = [
  { id: "background", label: "Latar dan bingkai", icon: ImageIcon },
  { id: "zoom", label: "Zoom", icon: ZoomIn },
  { id: "camera", label: "Layout kamera", icon: Webcam },
];

/**
 * Canvas tools beside the preview. Each one's settings open in the right panel
 * (see ToolPanel); none of them live in the Edit tab, which is for footage editing.
 */
export function ToolRail({ onRecord }: { onRecord: () => void }) {
  const active = useTools((s) => s.active);
  const move = useTools((s) => s.move);
  const fileRef = useRef<HTMLInputElement>(null);
  // Background/frame and camera layout only exist for screen recordings (camera: with a linked webcam).
  // A string selector keeps the subscription stable.
  const screen = useEditor((s) => {
    const shots = s.project.clips.filter((c) => c.screen);
    return shots.some((c) => c.screen?.camera) ? "camera" : shots.length ? "screen" : "none";
  });
  const tools = TOOLS.filter((t) => (t.id !== "background" || screen !== "none") && (t.id !== "camera" || screen === "camera"));

  // A tool whose subject disappeared (recording deleted) closes instead of showing an empty panel.
  useEffect(() => {
    if (active && !tools.some((t) => t.id === active)) useTools.getState().close();
  }, [active, tools]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && !(e.target instanceof Element && e.target.closest("input, textarea, select")) && useTools.getState().close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  return (
    <nav aria-label="Alat kanvas" className="flex w-11 shrink-0 flex-col items-center pt-2">
      <div className="glass flex flex-col gap-1 rounded-2xl p-1">
        {/* Record first, then layers: move them, add text, add a picture. Then the canvas tools. */}
        <RailButton icon={CircleDot} label="Rekam" accent onClick={onRecord} />
        <span className="mx-2 my-0.5 h-px bg-ink/[0.08]" aria-hidden="true" />
        <RailButton icon={MousePointer2} label="Geser layer (V)" active={move} onClick={() => useTools.getState().setMove(!move)} />
        <RailButton icon={Type} label="Teks (T)" onClick={() => addText()} />
        <RailButton icon={ImagePlus} label="Tambah gambar, video, atau audio" onClick={() => fileRef.current?.click()} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*,audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) addMediaLayer(f).catch((err) => toast(err instanceof Error ? err.message : "File tidak bisa dipakai"));
            e.target.value = "";
          }}
        />
        <span className="mx-2 my-0.5 h-px bg-ink/[0.08]" aria-hidden="true" />
        {tools.map((t) => (
          <RailButton key={t.id} icon={t.icon} label={t.label} active={active === t.id} onClick={() => useTools.getState().toggle(t.id)} />
        ))}
      </div>
    </nav>
  );
}

/** The active tool's settings, shown in the right panel in place of the clip settings. */
export function ToolPanel({ tool, onRecord }: { tool: ToolId; onRecord: () => void }) {
  const meta = TOOLS.find((t) => t.id === tool)!;
  const Icon = meta.icon;
  return (
    <section aria-label={meta.label} className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-ink/[0.06] pr-2 pl-4">
        <Icon className="size-4 text-fg/70" />
        <h2 className="flex-1 text-ui font-semibold">{meta.label}</h2>
        <button
          onClick={() => useTools.getState().close()}
          aria-label="Tutup alat"
          title="Tutup (Esc)"
          className="flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-panel-3 hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="scroll-fade scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <ToolBody tool={tool} onRecord={onRecord} />
      </div>
    </section>
  );
}

function ToolBody({ tool, onRecord }: { tool: ToolId; onRecord: () => void }) {
  // Re-render on project / playhead changes so the panel follows the clip under the playhead.
  useEditor((s) => s.project);
  useEditor((s) => s.playhead);
  useEditor((s) => s.selectedClipId);

  if (tool === "zoom") return <ZoomTool />;

  const clip = screenClip();
  if (!clip) return <NoScreen onRecord={onRecord} />;
  return tool === "background" ? <BackgroundTab clip={clip} /> : <CameraTab clip={clip} />;
}

function NoScreen({ onRecord }: { onRecord: () => void }) {
  return (
    <div className="space-y-3 p-4 text-center">
      <p className="text-ui text-fg/85">Belum ada rekaman layar</p>
      <button onClick={onRecord} className="mx-auto flex h-9 items-center gap-2 rounded-full bg-fg px-4 text-xs font-semibold text-bg">
        <span className="size-2 rounded-full bg-red-600" aria-hidden="true" /> Mulai rekam
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- Zoom */

function ZoomTool() {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.project.clips.find((c) => c.id === s.selectedClipId && c.zoom));
  const zooms = project.clips.filter((c) => c.zoom).sort((a, b) => a.start - b.start);

  const add = () => {
    const clip = screenClip() ?? footageClip();
    if (!clip) return toast("Tambahkan video ke timeline dulu, lalu zoom bisa dipasang di atasnya.");
    const { playhead, dispatch, select } = useEditor.getState();
    const start = playhead >= clip.start && playhead < clip.start + clip.duration ? playhead : clip.start;
    const id = crypto.randomUUID().slice(0, 8);
    // On a recording with a pointer track, a new zoom follows the pointer.
    const follow = !!project.assets.find((a) => a.id === clip.assetId)?.cursor?.length;
    dispatch([{ type: "addZoom", id, start, duration: Math.min(3, clip.start + clip.duration - start), zoom: { follow } }]);
    select(id);
  };

  return (
    <>
      <div className="space-y-2 border-b border-ink/[0.06] p-3">
        <button onClick={add} className="bg-accent-grad flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] text-xs font-semibold text-on-accent">
          <Plus className="size-3.5" /> Tambah zoom di playhead
        </button>
        {zooms.length > 0 && (
          <ul className="space-y-1" aria-label="Segmen zoom">
            {zooms.map((z, i) => (
              <li key={z.id}>
                <button
                  onClick={() => {
                    useEditor.getState().select(z.id);
                    seek(z.start + Math.min(z.zoom?.ease ?? 0.4, z.duration / 2));
                  }}
                  aria-pressed={selected?.id === z.id}
                  className={`flex h-8 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-xs transition-colors ${
                    selected?.id === z.id ? "bg-secondary/10 text-fg ring-1 ring-secondary" : "text-fg/80 hover:bg-panel-3"
                  }`}
                >
                  <ZoomIn className="size-3.5 text-muted" />
                  <span className="flex-1">Zoom {i + 1}</span>
                  <span className="font-mono text-meta text-muted tabular-nums">
                    {z.start.toFixed(1)}s · {z.zoom?.scale.toFixed(1)}×
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selected ? <ZoomTab clip={selected} /> : zooms.length > 0 && <p className="p-4 text-meta text-muted">Pilih segmen zoom untuk mengatur fokus dan perbesarannya.</p>}
    </>
  );
}

function RailButton({ icon: Icon, label, onClick, active, accent }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={accent ? undefined : !!active}
      title={label}
      className={`flex size-9 items-center justify-center rounded-[12px] transition-colors ${
        active ? "bg-secondary/15 text-secondary ring-1 ring-secondary/30" : accent ? "text-red-400 hover:bg-panel-3" : "text-fg/85 hover:bg-panel-3"
      }`}
    >
      <Icon className="size-[18px]" />
    </button>
  );
}
