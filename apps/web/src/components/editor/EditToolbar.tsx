"use client";

import { Redo2, Scissors, Trash2, Undo2, Volume2, VolumeX, ZoomIn, ZoomOut } from "lucide-react";
import { useEditor } from "@goodscreen/editor-core";
import { IconButton } from "./Preview";
import { ToolbarKeyframe } from "./Keyframes";

/** Top bar of the timeline card; clip-specific tools live in the right panel's Edit tab. */
/** m:ss.d, e.g. 0:07.0 */
const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

/** `mobile`: time readout + mute replace undo/redo, which float over the phone preview. */
export function EditToolbar({ mobile }: { mobile?: boolean }) {
  const playhead = useEditor((s) => s.playhead);
  const videoMuted = useEditor((s) => s.project.tracks.find((t) => t.kind === "video")?.muted);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const hasSelection = useEditor((s) => s.selectedClipId !== null);
  const pps = useEditor((s) => s.pxPerSec);
  const { undo, redo, splitAtPlayhead, deleteSelected, setZoom } = useEditor.getState();

  return (
    <div className={`flex h-11 shrink-0 items-center gap-0.5 px-2 ${mobile ? "" : "border-b border-ink/[0.06]"}`}>
      {mobile ? (
        <>
          <span className="w-16 pl-1.5 font-mono text-xs text-fg/90 tabular-nums">{clock(playhead)}</span>
          <IconButton
            label={videoMuted ? "Nyalakan suara" : "Matikan suara"}
            onClick={() => {
              const t = useEditor.getState().project.tracks.find((tr) => tr.kind === "video");
              if (t) useEditor.getState().toggleTrack(t.id, "muted");
            }}
          >
            {videoMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </IconButton>
        </>
      ) : (
        <>
          <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
            <Undo2 className="size-4" />
          </IconButton>
          <IconButton label="Redo (Ctrl+Y)" onClick={redo} disabled={!canRedo}>
            <Redo2 className="size-4" />
          </IconButton>
        </>
      )}
      <span className="mx-1.5 h-4 w-px bg-line" aria-hidden="true" />
      <IconButton label="Split at playhead (S)" onClick={splitAtPlayhead}>
        <Scissors className="size-4" />
      </IconButton>
      <IconButton label="Delete clip (Delete)" onClick={deleteSelected} disabled={!hasSelection}>
        <Trash2 className="size-4" />
      </IconButton>
      <ToolbarKeyframe />
      <div className="ml-auto flex items-center gap-0.5">
        <IconButton label="Zoom timeline out" onClick={() => setZoom(pps / 1.4)}>
          <ZoomOut className="size-4" />
        </IconButton>
        {!mobile && <span className="w-10 text-center font-mono text-meta text-muted tabular-nums">{Math.round((pps / 40) * 100)}%</span>}
        <IconButton label="Zoom timeline in" onClick={() => setZoom(pps * 1.4)}>
          <ZoomIn className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}
