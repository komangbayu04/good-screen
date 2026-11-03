"use client";

import { ChevronLeft, ChevronRight, Diamond, Trash2 } from "lucide-react";
import {
  KEY_EPS,
  keyAt,
  keyTimes,
  propAt,
  sourceTime,
  timelineTime,
  useEditor,
  type Clip,
  type KeyEase,
  type KeyProp,
} from "@goodscreen/editor-core";
import { seek } from "@/lib/player-bridge";

/** Playhead as this clip's source time, and whether the playhead is on the clip at all. */
export function useClipTime(clip: Clip) {
  const playhead = useEditor((s) => s.playhead);
  const inRange = playhead >= clip.start - 1e-3 && playhead <= clip.start + clip.duration + 1e-3;
  return { src: sourceTime(clip, Math.min(clip.start + clip.duration, Math.max(clip.start, playhead))), inRange };
}

/** Value of a property at the playhead (animated when keyed), in model units. */
export function useAnimated(clip: Clip, prop: KeyProp) {
  const { src } = useClipTime(clip);
  return propAt(clip, prop, src);
}

/**
 * The diamond next to a property (CapCut): filled = keyframe on this frame,
 * outline = the property is animated, faint = not animated yet. Click toggles
 * the keyframe at the playhead; the arrows jump to the previous/next keyframe.
 */
export function KeyframeButton({ clip, props, label }: { clip: Clip; props: KeyProp[]; label: string }) {
  const { src, inRange } = useClipTime(clip);
  const dispatch = useEditor((s) => s.dispatch);
  const times = keyTimes(clip, props);
  const onFrame = props.some((p) => keyAt(clip, p, src));
  const animated = times.length > 0;
  const prev = [...times].reverse().find((t) => t < src - KEY_EPS);
  const next = times.find((t) => t > src + KEY_EPS);

  const toggle = () => {
    if (!inRange) return;
    if (onFrame) dispatch([{ type: "removeKeyframe", clipId: clip.id, t: src, props }]);
    else dispatch(props.map((prop) => ({ type: "setKeyframe" as const, clipId: clip.id, prop, t: src })));
  };

  return (
    <span className="flex items-center">
      {animated && (
        <NavButton label={`Previous ${label} keyframe`} disabled={prev === undefined} onClick={() => prev !== undefined && seek(timelineTime(clip, prev))}>
          <ChevronLeft className="size-3" />
        </NavButton>
      )}
      <button
        data-no-press
        onClick={toggle}
        disabled={!inRange}
        aria-pressed={onFrame}
        aria-label={onFrame ? `Remove ${label} keyframe` : `Add ${label} keyframe`}
        title={!inRange ? "Put the playhead on this clip to add a keyframe" : onFrame ? "Remove the keyframe at this frame" : "Add a keyframe at the playhead"}
        className={`flex size-6 items-center justify-center rounded-[6px] transition-colors hover:bg-panel-3 disabled:opacity-30 ${
          onFrame ? "text-secondary" : animated ? "text-fg/85" : "text-muted/70 hover:text-fg"
        }`}
      >
        <Diamond className={`size-3.5 ${onFrame ? "fill-current" : ""}`} strokeWidth={2} />
      </button>
      {animated && (
        <NavButton label={`Next ${label} keyframe`} disabled={next === undefined} onClick={() => next !== undefined && seek(timelineTime(clip, next))}>
          <ChevronRight className="size-3" />
        </NavButton>
      )}
    </span>
  );
}

function NavButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      data-no-press
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-5 items-center justify-center rounded-[5px] text-muted transition-colors hover:bg-panel-3 hover:text-fg disabled:opacity-25"
    >
      {children}
    </button>
  );
}

const CURVES: { id: KeyEase; label: string; path: string }[] = [
  { id: "linear", label: "Linear", path: "M2 14 L18 2" },
  { id: "ease-in", label: "Ease in", path: "M2 14 C12 14 16 8 18 2" },
  { id: "ease-out", label: "Ease out", path: "M2 14 C4 8 8 2 18 2" },
  { id: "ease-in-out", label: "Ease in-out", path: "M2 14 C10 14 10 2 18 2" },
  { id: "hold", label: "Hold", path: "M2 14 L18 14 L18 2" },
];

/**
 * Keyframe bar on top of the footage inspector: count, jump between keyframes,
 * the curve of the keyframe on the playhead, and clearing all animation.
 */
export function KeyframeBar({ clip }: { clip: Clip }) {
  const { src, inRange } = useClipTime(clip);
  const dispatch = useEditor((s) => s.dispatch);
  const times = keyTimes(clip);
  if (!times.length) return null;
  const here = inRange ? times.find((t) => Math.abs(t - src) < KEY_EPS) : undefined;
  const ease =
    here !== undefined
      ? (Object.values(clip.keyframes ?? {})
          .flatMap((k) => k ?? [])
          .find((k) => Math.abs(k.t - here) < KEY_EPS)?.ease ?? "linear")
      : undefined;
  const prev = [...times].reverse().find((t) => t < src - KEY_EPS);
  const next = times.find((t) => t > src + KEY_EPS);

  return (
    <div className="space-y-2.5 border-b border-ink/[0.06] px-3.5 py-3">
      <div className="flex items-center gap-1.5">
        <Diamond className="size-3.5 fill-current text-fg/70" />
        <span className="flex-1 text-ui font-medium">
          {times.length} keyframe
        </span>
        <NavButton label="Previous keyframe" disabled={prev === undefined} onClick={() => prev !== undefined && seek(timelineTime(clip, prev))}>
          <ChevronLeft className="size-3.5" />
        </NavButton>
        <NavButton label="Next keyframe" disabled={next === undefined} onClick={() => next !== undefined && seek(timelineTime(clip, next))}>
          <ChevronRight className="size-3.5" />
        </NavButton>
        <button
          onClick={() => dispatch([{ type: "clearKeyframes", clipId: clip.id }])}
          aria-label="Remove all keyframes"
          title="Remove all keyframes"
          className="flex size-6 items-center justify-center rounded-[6px] text-muted transition-colors hover:bg-panel-3 hover:text-red-400"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {here !== undefined ? (
        <div className="space-y-1.5">
          <p className="text-meta text-muted">Curve to the next keyframe</p>
          <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label="Keyframe curve">
            {CURVES.map((c) => (
              <button
                key={c.id}
                role="radio"
                aria-checked={ease === c.id}
                title={c.label}
                onClick={() => dispatch([{ type: "setKeyframeEase", clipId: clip.id, t: here, ease: c.id }])}
                className={`flex h-10 flex-col items-center justify-center gap-0.5 rounded-[8px] transition-colors ${
                  ease === c.id ? "is-selected" : "bg-panel-3/50 text-muted hover:text-fg"
                }`}
              >
                <svg viewBox="0 0 20 16" className="h-3.5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true">
                  <path d={c.path} />
                </svg>
                <span className="text-[9px] leading-none">{c.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Timeline toolbar diamond: keys the selected clip's main properties (transform, or volume for audio) at the playhead. */
export function ToolbarKeyframe() {
  const clip = useEditor((s) => s.project.clips.find((c) => c.id === s.selectedClipId));
  const kind = useEditor((s) => s.project.tracks.find((t) => t.id === clip?.trackId)?.kind);
  if (!clip || clip.zoom) return <KeyPlaceholder />;
  const props: KeyProp[] = kind === "audio" ? ["volume"] : ["x", "y", "scale", "rotate", "opacity"];
  return (
    <span className="flex h-8 items-center rounded-full px-0.5">
      <KeyframeButton clip={clip} props={props} label={kind === "audio" ? "volume" : "transform"} />
    </span>
  );
}

function KeyPlaceholder() {
  return (
    <span title="Select a clip to add keyframes" className="flex size-8 items-center justify-center text-muted/40" aria-hidden="true">
      <Diamond className="size-3.5" />
    </span>
  );
}

/**
 * Keyframe diamonds along the bottom of a clip on the timeline. On the selected
 * clip they can be clicked (jump there) and dragged (retime the keyframe).
 */
export function ClipKeyMarkers({ clip, pps, selected }: { clip: Clip; pps: number; selected: boolean }) {
  const playhead = useEditor((s) => s.playhead);
  const times = keyTimes(clip).filter((t) => {
    const tl = timelineTime(clip, t);
    return tl >= clip.start - 1e-3 && tl <= clip.start + clip.duration + 1e-3;
  });
  if (!times.length) return null;
  const speed = clip.speed ?? 1;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0.5 h-3">
      {times.map((t) => {
        const x = (timelineTime(clip, t) - clip.start) * pps;
        const here = Math.abs(timelineTime(clip, t) - playhead) < 1 / 60;
        return (
          <button
            key={t}
            data-no-press
            tabIndex={selected ? 0 : -1}
            aria-label={`Keyframe at ${timelineTime(clip, t).toFixed(2)}s`}
            onPointerDown={(e) => {
              if (!selected || e.button !== 0) return;
              e.stopPropagation();
              e.preventDefault();
              const x0 = e.clientX;
              let last = t;
              let moved = false;
              const move = (ev: PointerEvent) => {
                const dx = ev.clientX - x0;
                if (!moved && Math.abs(dx) < 3) return;
                if (!moved) useEditor.getState().beginGesture();
                moved = true;
                const lo = clip.offset;
                const hi = clip.offset + clip.duration * speed;
                const to = Math.round(Math.min(hi, Math.max(lo, t + (dx / pps) * speed)) * 100) / 100;
                useEditor.getState().live({ type: "moveKeyframe", clipId: clip.id, from: last, to });
                last = to;
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                seek(timelineTime(useEditor.getState().project.clips.find((c) => c.id === clip.id) ?? clip, last));
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
            className={`absolute top-0 -ml-1.5 flex size-3 items-center justify-center ${selected ? "pointer-events-auto cursor-ew-resize" : ""}`}
            style={{ left: x }}
          >
            <Diamond className={`size-2.5 drop-shadow ${here ? "fill-secondary text-secondary" : "fill-white text-black/60"}`} strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}
