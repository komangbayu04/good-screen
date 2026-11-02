"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Film, Layers2, Music, Type, Wand2, ZoomIn } from "lucide-react";
import { MIN_CLIP, clipRole, projectDuration, useEditor, type Asset, type Clip, type Track, type TrackKind } from "@goodscreen/editor-core";
import { nearestFrame, useFilmstrip } from "@/lib/filmstrip";
import { seek } from "@/lib/player-bridge";
import { ClipKeyMarkers } from "./Keyframes";

const ROW_H: Record<TrackKind, string> = {
  layer: "h-9 lg:h-11",
  video: "h-12 lg:h-16",
  audio: "h-9 lg:h-11",
};
const TRACK_ICON = { layer: Layers2, video: Film, audio: Music };
const ROLE_ICON = { motion: Wand2, zoom: ZoomIn, caption: Type, media: null };
const SNAP_PX = 8;
const RULER_H = 32;

export function Timeline() {
  const project = useEditor((s) => s.project);
  const pps = useEditor((s) => s.pxPerSec);
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const selectedId = useEditor((s) => s.selectedClipId);
  const scrollRef = useRef<HTMLDivElement>(null);

  const total = projectDuration(project);
  const width = Math.max(total + 8, 30) * pps;

  // Keep the playhead visible while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = playhead * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 40;
  }, [playhead, playing, pps]);

  // Ctrl / Cmd + wheel zooms around the cursor.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { pxPerSec, setZoom } = useEditor.getState();
      const rect = el.getBoundingClientRect();
      const t = (e.clientX - rect.left + el.scrollLeft) / pxPerSec;
      const next = Math.min(200, Math.max(8, pxPerSec * (e.deltaY < 0 ? 1.15 : 0.87)));
      setZoom(next);
      requestAnimationFrame(() => (el.scrollLeft = t * next - (e.clientX - rect.left)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    return (clientX - el.getBoundingClientRect().left + el.scrollLeft) / pps;
  };

  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    useEditor.getState().select(null);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => seek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden px-2 pt-2 pb-2 select-none">
      {/* Track icons */}
      <div className="w-7 shrink-0 lg:w-14">
        <div style={{ height: RULER_H }} />
        {project.tracks.map((t) => (
          <TrackHeader key={t.id} track={t} />
        ))}
      </div>

      {/* Scrollable lanes */}
      <div ref={scrollRef} className="scrollbar-thin relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="relative" style={{ width }}>
          <Ruler pps={pps} width={width} onPointerDown={scrub} />
          {project.tracks.map((t) => (
            <div key={t.id} data-track-id={t.id} data-track-kind={t.kind} className={`relative py-1 ${ROW_H[t.kind]} ${t.hidden ? "opacity-35" : ""}`} onPointerDown={scrub}>
              <div className="absolute inset-x-0 inset-y-1 rounded-xl bg-panel-2/45" />
              {project.clips
                .filter((c) => c.trackId === t.id)
                .map((c) => (
                  <ClipView key={c.id} clip={c} track={t} pps={pps} selected={c.id === selectedId} />
                ))}
            </div>
          ))}
          {/* Playhead */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 left-0 z-20 w-0.5 bg-accent will-change-transform"
            style={{ transform: `translateX(${playhead * pps - 1}px)` }}
          >
            <div className="bg-accent-grad absolute top-1.5 left-1/2 h-5 w-3.5 -translate-x-1/2 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackHeader({ track }: { track: Track }) {
  const toggle = useEditor((s) => s.toggleTrack);
  const Icon = TRACK_ICON[track.kind];
  const audible = track.kind === "audio";
  const layerNo = track.kind === "layer" ? track.name.replace(/\D/g, "") : null;
  const off = audible ? track.muted : track.hidden;
  return (
    <div className={`flex items-center justify-center py-1 ${ROW_H[track.kind]}`}>
      <button
        onClick={() => toggle(track.id, audible ? "muted" : "hidden")}
        title={`${track.name} — klik untuk ${audible ? (off ? "nyalakan suara" : "mute") : off ? "tampilkan" : "sembunyikan"}`}
        aria-label={`${track.name}: ${off ? "nonaktif" : "aktif"}`}
        className={`flex size-7 items-center justify-center rounded-lg transition-colors hover:bg-panel-3 lg:size-9 lg:rounded-xl ${off ? "text-muted/40 line-through" : "text-fg/60 lg:text-fg/70"}`}
      >
        <Icon className="size-3.5 lg:size-[18px]" />
        {layerNo && <span className="ml-px font-mono text-2xs leading-none">{layerNo}</span>}
      </button>
    </div>
  );
}

function Ruler({ pps, width, onPointerDown }: { pps: number; width: number; onPointerDown: (e: React.PointerEvent) => void }) {
  const step = pps >= 60 ? 1 : pps >= 25 ? 2 : pps >= 12 ? 5 : 10;
  const seconds = Math.ceil(width / pps);
  const labels = useMemo(() => Array.from({ length: Math.floor(seconds / step) + 1 }, (_, i) => i * step), [seconds, step]);
  const dotGap = (pps * step) / 5;
  return (
    <div className="relative mx-0 cursor-text rounded-full bg-panel-2/60" style={{ height: RULER_H - 6, marginBottom: 6 }} onPointerDown={onPointerDown}>
      {/* minor ticks as dots */}
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2"
        style={{ backgroundImage: "radial-gradient(circle, rgb(255 255 255 / 0.28) 1px, transparent 1.4px)", backgroundSize: `${dotGap}px 2px` }}
      />
      {labels.map((t) => (
        <span
          key={t}
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 bg-panel-2 px-1 font-mono text-2xs text-muted"
          style={{ left: Math.max(10, t * pps) }}
        >
          {t}s
        </span>
      ))}
    </div>
  );
}

function ClipView({ clip, track, pps, selected }: { clip: Clip; track: Track; pps: number; selected: boolean }) {
  const asset = useEditor((s) => s.project.assets.find((a) => a.id === clip.assetId));
  const fps = useEditor((s) => s.project.fps);
  const label = clip.zoom ? `Zoom ${clip.zoom.scale.toFixed(1)}×` : (clip.text ?? asset?.name ?? clip.motion?.template ?? "Clip");

  // Keyboard path for everything the pointer does: Enter selects, arrows move by a frame
  // (Shift: 1s), Alt+arrows trim the end. Each press is one undo step.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const st = useEditor.getState();
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      st.select(clip.id);
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    st.select(clip.id);
    if (track.locked) return;
    const step = (e.shiftKey ? 1 : 1 / fps) * (e.key === "ArrowLeft" ? -1 : 1);
    if (e.altKey) st.dispatch([{ type: "trimClip", clipId: clip.id, duration: clip.duration + step }]);
    else st.dispatch([{ type: "moveClip", clipId: clip.id, start: clip.start + step }]);
  };

  const onPointerDown = (e: React.PointerEvent, mode: "move" | "trim-l" | "trim-r") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const st = useEditor.getState();
    st.select(clip.id);
    if (track.locked) return;
    // Window listeners drive the drag; the clip may re-mount in another layer row mid-drag.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}

    const orig = { ...clip };
    const x0 = e.clientX;
    const y0 = e.clientY;
    const touch = e.pointerType === "touch";
    // Hysteresis: fingers need more travel than a mouse before a drag commits.
    const threshold = touch ? 8 : 3;
    let started = false;
    let lastSnap: number | undefined;
    // Snap targets: timeline start, playhead and every other clip edge.
    const edges = [0, st.playhead, ...st.project.clips.filter((c) => c.id !== clip.id).flatMap((c) => [c.start, c.start + c.duration])];
    const snap = (t: number) => {
      const hit = edges.find((edge) => Math.abs(edge - t) * pps < SNAP_PX);
      // A tiny tick on the frame the clip locks to an edge (touch only, once per snap).
      if (hit !== undefined && hit !== lastSnap && touch) navigator.vibrate?.(8);
      lastSnap = hit;
      return hit ?? Math.round(t * 20) / 20;
    };

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!started) {
        if (Math.abs(dx) < threshold && Math.abs(ev.clientY - y0) < threshold) return;
        started = true;
        useEditor.getState().beginGesture();
      }
      const dt = dx / pps;
      const { live } = useEditor.getState();
      if (mode === "move") {
        let start = snap(orig.start + dt);
        const end = snap(orig.start + dt + orig.duration);
        if (end !== Math.round((orig.start + dt + orig.duration) * 20) / 20) start = end - orig.duration;
        // Overlay clips follow the pointer to whichever layer row it is over.
        const row = track.kind === "layer" ? layerRowAt(ev.clientX, ev.clientY) : undefined;
        live({ type: "moveClip", clipId: clip.id, start: Math.max(0, start), trackId: row });
      } else if (mode === "trim-l") {
        const media = asset?.kind === "video" || asset?.kind === "audio";
        // Timeline seconds map to source seconds through the clip's speed.
        const speed = orig.speed ?? 1;
        let start = snap(orig.start + dt);
        start = Math.max(0, media ? orig.start - orig.offset / speed : 0, Math.min(start, orig.start + orig.duration - MIN_CLIP));
        const shift = start - orig.start;
        live({ type: "moveClip", clipId: clip.id, start });
        live({ type: "trimClip", clipId: clip.id, offset: media ? orig.offset + shift * speed : 0, duration: orig.duration - shift });
      } else {
        const end = snap(orig.start + orig.duration + dt);
        live({ type: "trimClip", clipId: clip.id, duration: end - orig.start });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!started) seek(Math.max(clip.start, Math.min(clip.start + clip.duration, useEditor.getState().playhead)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const w = Math.max(4, clip.duration * pps);
  const RoleIcon = ROLE_ICON[clipRole(clip)];
  const thumb = track.kind === "video" ? asset?.thumbnail : undefined;

  return (
    <div
      onPointerDown={(e) => onPointerDown(e, "move")}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${track.name}: ${label}, mulai ${clip.start.toFixed(1)} detik, durasi ${clip.duration.toFixed(1)} detik`}
      className={`absolute top-1 bottom-1 touch-none overflow-hidden rounded-xl border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-1 focus-visible:ring-offset-panel ${
        selected ? "z-10 border-secondary bg-panel-3" : "border-ink/10 bg-panel-2 hover:border-ink/25"
      } ${
        track.locked ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"
      }`}
      style={{ left: clip.start * pps, width: w }}
    >
      {track.kind === "video" ? (
        <>
          <Filmstrip clip={clip} asset={asset} pps={pps} fallback={thumb} />
          {/* Frames stay fully visible; effects sit as bold tags in the top-left corner. */}
          <div className={`pointer-events-none absolute top-1 right-1 flex min-w-0 flex-wrap gap-1 ${selected ? "left-6 lg:left-5" : "left-1.5"}`}>
            {clipTags(clip).map((t) => (
              <span key={t.label} className={`rounded-[5px] px-1.5 py-px text-2xs leading-4 font-bold whitespace-nowrap uppercase shadow-sm bg-black/75 text-white`}>
                {t.label}
              </span>
            ))}
          </div>
        </>
      ) : (
      <div className={`relative flex h-full items-center gap-2 ${selected ? "px-6 lg:px-5" : "px-1.5"}`}>
        {track.kind === "audio" && (
          <div className="absolute inset-x-2 inset-y-2 opacity-60 [background:repeating-linear-gradient(90deg,#fff_0_2px,transparent_2px_5px)] [mask-image:linear-gradient(transparent,#000_25%,#000_75%,transparent)]" />
        )}
        {RoleIcon && <RoleIcon className="size-3 shrink-0 text-fg/60" />}
        <span className={`relative truncate text-meta text-fg/90 ${track.kind === "audio" ? "ml-auto rounded bg-panel-2/80 px-1" : ""}`}>{label}</span>
        {clip.speed && clip.speed !== 1 && (
          <span className="shrink-0 rounded-full bg-black/50 px-1.5 font-mono text-2xs text-fg/90">{clip.speed}x</span>
        )}
      </div>
      )}
      <ClipKeyMarkers clip={clip} pps={pps} selected={selected} />
      {/* Trim handles: orange caps when selected */}
      <div
        onPointerDown={(e) => onPointerDown(e, "trim-l")}
        className={`absolute inset-y-0 left-0 flex cursor-ew-resize items-center justify-center ${selected ? "w-5 bg-secondary lg:w-4" : "w-4 lg:w-3"}`}
      >
        {selected && <ChevronLeft className="size-3 text-on-secondary" strokeWidth={3} />}
      </div>
      <div
        onPointerDown={(e) => onPointerDown(e, "trim-r")}
        className={`absolute inset-y-0 right-0 flex cursor-ew-resize items-center justify-center ${selected ? "w-5 bg-secondary lg:w-4" : "w-4 lg:w-3"}`}
      >
        {selected && <ChevronRight className="size-3 text-on-secondary" strokeWidth={3} />}
      </div>
    </div>
  );
}

/** Tags for what's applied to a footage clip, most noticeable first. */
function clipTags(clip: Clip): { label: string }[] {
  const tags: { label: string }[] = [];
  if (clip.speed && clip.speed !== 1) tags.push({ label: `${clip.speed}×` });
  if (clip.transitionIn && clip.transitionIn !== "none") tags.push({ label: clip.transitionIn });
  if (clip.transitionOut && clip.transitionOut !== "none") tags.push({ label: `${clip.transitionOut} out` });
  const adj = clip.adjust;
  if (adj && Object.values(adj).some((v) => v)) tags.push({ label: "Warna" });
  if (clip.kenBurns) tags.push({ label: "Ken Burns" });
  if ((clip.fadeIn ?? 0) > 0 || (clip.fadeOut ?? 0) > 0) tags.push({ label: "Fade audio" });
  if (clip.volume !== undefined && clip.volume !== 1) tags.push({ label: `Vol ${Math.round(clip.volume * 100)}%` });
  return tags;
}

/** The footage itself, frame by frame across the whole clip (like CapCut's filmstrip). */
function Filmstrip({ clip, asset, pps, fallback }: { clip: Clip; asset?: Asset; pps: number; fallback?: string }) {
  const strip = useFilmstrip(asset);
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(56);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight || 56));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const aspect = asset?.width && asset.height ? asset.width / asset.height : 16 / 9;
  const tileW = Math.max(24, Math.round(h * aspect));
  const w = clip.duration * pps;
  const count = Math.max(1, Math.ceil(w / tileW));
  const speed = clip.speed ?? 1;

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 flex overflow-hidden bg-black/40" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const src = strip?.frames.length ? strip.frames[nearestFrame(strip, clip.offset + ((i + 0.5) * tileW * speed) / pps)] : fallback;
        return src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={src} alt="" draggable={false} className="h-full shrink-0 object-cover" style={{ width: tileW }} />
        ) : (
          <span key={i} className="h-full shrink-0 border-r border-black/30 bg-panel-3" style={{ width: tileW }} />
        );
      })}
    </div>
  );
}

/** Layer row under a screen point, for dragging overlay clips between layers. */
function layerRowAt(x: number, y: number): string | undefined {
  for (const el of document.elementsFromPoint(x, y)) {
    const row = (el as HTMLElement).closest?.<HTMLElement>("[data-track-kind]");
    if (row) return row.dataset.trackKind === "layer" ? row.dataset.trackId : undefined;
  }
  return undefined;
}
