"use client";

import { useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { ChevronDown, Menu, Pause, Play, Redo2, SkipBack, SkipForward, Undo2, Volume2, VolumeX } from "lucide-react";
import { framePresetOf, projectDuration, useEditor } from "@goodscreen/editor-core";
import { ReelComposition } from "@goodscreen/motion";
import { bindPlayer, seek, togglePlay } from "@/lib/player-bridge";
import { formatTime } from "@/lib/media";
import { CanvasOverlay } from "./CanvasOverlay";
import { useTools } from "@/lib/tools";
import { FpsPicker, FramePicker } from "./Inspector";

/**
 * `mobile` switches to the phone layout: full-bleed black stage with floating corner
 * controls (frame, menu, undo/redo, play) instead of the docked transport bar.
 */
export function Preview({ onRecord, mobile }: { onRecord?: () => void; mobile?: { onOpenMenu: () => void } }) {
  const ref = useRef<PlayerRef>(null);
  const project = useEditor((s) => s.project);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const setPlaying = useEditor((s) => s.setPlaying);
  const empty = project.clips.length === 0;
  const moveOn = useTools((s) => s.move);
  const stageRef = useRef<HTMLDivElement>(null);
  const fit = useFitBox(stageRef, project.width / project.height);
  const durationInFrames = Math.max(project.fps, Math.ceil(projectDuration(project) * project.fps));

  useEffect(() => {
    const p = ref.current;
    bindPlayer(p);
    if (!p) return;
    // Resume where the timeline is (e.g. after switching between mobile and desktop layouts).
    p.seekTo(Math.round(useEditor.getState().playhead * project.fps));
    const onFrame = (e: { detail: { frame: number } }) => setPlayhead(e.detail.frame / project.fps);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
      bindPlayer(null);
    };
  }, [project.fps, setPlayhead, setPlaying]);

  return (
    <div className={`flex h-full min-h-0 w-full flex-col overflow-hidden ${mobile ? "bg-black" : ""}`}>
      <div ref={stageRef} className={`relative flex min-h-0 flex-1 items-center justify-center ${mobile ? "px-14 py-3" : "p-3 lg:p-4"}`}>
      {/* Sized to the exact frame ratio, so the canvas never shows letterbox bars. */}
      <div
        className="relative overflow-hidden rounded-2xl bg-black shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)] ring-1 ring-ink/10"
        style={fit ? { width: fit.w, height: fit.h } : { visibility: "hidden" }}
      >
        <Player
          ref={ref}
          component={ReelComposition}
          inputProps={{ project }}
          durationInFrames={durationInFrames}
          compositionWidth={project.width}
          compositionHeight={project.height}
          fps={project.fps}
          style={{ width: "100%", height: "100%" }}
          // Desktop clicks select things on the canvas; the phone stage keeps tap-to-play.
          clickToPlay={!!mobile || !moveOn}
          acknowledgeRemotionLicense
        />
        {!mobile && !empty && moveOn && <CanvasOverlay />}
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm font-medium">Belum ada rekaman</p>
            <p className="max-w-[240px] text-xs text-muted">Rekam layarmu, atau seret file video ke sini.</p>
            {onRecord && (
              <button
                onClick={onRecord}
                className="bg-accent-grad pointer-events-auto mt-1 flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-on-accent"
              >
                <span className="size-2 rounded-full bg-white" aria-hidden="true" /> Mulai rekam
              </button>
            )}
          </div>
        )}
      </div>
      {mobile && <MobileOverlays onOpenMenu={mobile.onOpenMenu} />}
      </div>
    </div>
  );
}

/** Largest box with the frame's aspect ratio that fits inside the stage's content box. */
function useFitBox(ref: React.RefObject<HTMLDivElement | null>, aspect: number) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const aw = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const ah = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (aw <= 0 || ah <= 0) return;
      const w = Math.min(aw, ah * aspect);
      setBox({ w: Math.floor(w), h: Math.floor(w / aspect) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, aspect]);
  return box;
}

/** Phone stage controls, parked in the corners outside the 9:16 frame. */
function MobileOverlays({ onOpenMenu }: { onOpenMenu: () => void }) {
  const playing = useEditor((s) => s.playing);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const square = "glass flex size-10 items-center justify-center rounded-[12px] text-white/90";
  return (
    <>
      <div className="absolute top-3 left-3 z-10">
        <FrameMenu placement="down" compact />
      </div>
      <button onClick={onOpenMenu} aria-label="Menu proyek" className={`${square} absolute top-3 right-3 z-10`}>
        <Menu className="size-[18px]" />
      </button>
      <div className="glass absolute bottom-3 left-3 z-10 flex flex-col overflow-hidden rounded-[12px]">
        <button
          onClick={() => useEditor.getState().undo()}
          disabled={!canUndo}
          aria-label="Undo"
          className="flex size-10 items-center justify-center text-white/90 disabled:opacity-35"
        >
          <Undo2 className="size-[18px]" />
        </button>
        <span className="mx-2.5 h-px bg-ink/10" aria-hidden="true" />
        <button
          onClick={() => useEditor.getState().redo()}
          disabled={!canRedo}
          aria-label="Redo"
          className="flex size-10 items-center justify-center text-white/90 disabled:opacity-35"
        >
          <Redo2 className="size-[18px]" />
        </button>
      </div>
      <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} className={`${square} absolute right-3 bottom-3 z-10`}>
        {playing ? <Pause className="size-[18px] fill-current" /> : <Play className="ml-0.5 size-[18px] fill-current" />}
      </button>
    </>
  );
}

/** Transport bar under the preview: time | transport | output settings. */
export function PlayerControls() {
  const playing = useEditor((s) => s.playing);
  const playhead = useEditor((s) => s.playhead);
  const project = useEditor((s) => s.project);
  const videoMuted = useEditor((s) => s.project.tracks.find((t) => t.kind === "video")?.muted);
  const total = projectDuration(project);
  const edges = [...new Set(project.clips.flatMap((c) => [c.start, c.start + c.duration]))].sort((a, b) => a - b);

  return (
    // Glass bar: it sits on the background photo, so its text needs a surface of its own.
    <div className="glass mt-1 grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 rounded-2xl px-2 sm:gap-2 sm:px-3">
      <span className="font-mono text-xs whitespace-nowrap text-fg/90 tabular-nums">
        {formatTime(playhead)} <span className="text-muted">/ {formatTime(total)}</span>
      </span>

      <div className="flex items-center gap-1">
        <BarButton label="Ke potongan sebelumnya" onClick={() => seek([...edges].reverse().find((e) => e < playhead - 0.05) ?? 0)}>
          <SkipBack className="size-4" />
        </BarButton>
        <button
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="flex size-9 items-center justify-center rounded-full bg-fg text-bg transition-colors hover:bg-white"
        >
          {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
        </button>
        <BarButton label="Ke potongan berikutnya" onClick={() => seek(edges.find((e) => e > playhead + 0.05) ?? total)}>
          <SkipForward className="size-4" />
        </BarButton>
      </div>

      <div className="flex items-center justify-end gap-1">
        <BarButton
          label={videoMuted ? "Nyalakan suara" : "Matikan suara"}
          onClick={() => {
            const t = useEditor.getState().project.tracks.find((tr) => tr.kind === "video");
            if (t) useEditor.getState().toggleTrack(t.id, "muted");
          }}
        >
          {videoMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </BarButton>
        <FrameMenu />
      </div>
    </div>
  );
}

function BarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-8 items-center justify-center rounded-full text-fg/75 transition-colors hover:bg-panel-3 hover:text-fg"
    >
      {children}
    </button>
  );
}

function FrameMenu({ placement = "up", compact }: { placement?: "up" | "down"; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const project = useEditor((s) => s.project);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Ubah frame & frame rate"
        className={
          compact
            ? "glass flex h-10 items-center gap-1 rounded-[12px] px-3 font-mono text-meta whitespace-nowrap text-white/90"
            : "flex h-8 items-center gap-1 rounded-full px-2.5 font-mono text-meta whitespace-nowrap text-fg/80 transition-colors hover:bg-panel-3 hover:text-fg"
        }
      >
        {framePresetOf(project).label}
        <span className="hidden sm:inline">· {project.fps}fps</span>
        <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {/* Grows out of its trigger corner and returns along the same path. */}
      <div
        inert={!open}
        aria-hidden={!open}
        className={`motion-slide absolute z-30 w-64 space-y-3 ${placement === "up" ? "right-0 bottom-full mb-2 origin-bottom-right" : "top-full left-0 mt-2 origin-top-left"} frost rounded-2xl border border-line bg-panel p-3 shadow-2xl transition-[opacity,scale,translate] ease-[var(--ease-out)] ${
          open ? "scale-100 opacity-100 duration-200" : "pointer-events-none translate-y-1 scale-95 opacity-0 duration-150"
        }`}
      >
        <p className="text-meta text-muted">Frame</p>
        <FramePicker />
        <p className="text-meta text-muted">Frame rate</p>
        <FpsPicker />
      </div>
    </div>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  active,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`flex size-9 items-center justify-center rounded-full transition-colors hover:bg-panel-3 disabled:pointer-events-none disabled:opacity-30 lg:size-8 ${
        active ? "text-secondary" : "text-fg/80"
      }`}
    >
      {children}
    </button>
  );
}
