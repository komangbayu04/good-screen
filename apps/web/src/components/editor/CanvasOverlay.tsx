"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_TRANSFORM, useEditor, type Clip } from "@goodscreen/editor-core";
import { moveCommand, positionOf, resetPosition, useCanvasEdit } from "@/lib/tools";

type Box = { x: number; y: number; w: number; h: number };

/** Clip is on screen right now and may be touched (track visible and unlocked). */
function interactive(clip: Clip) {
  const { project, playhead } = useEditor.getState();
  const track = project.tracks.find((t) => t.id === clip.trackId);
  return !!track && !track.hidden && !track.locked && playhead >= clip.start && playhead < clip.start + clip.duration;
}

/**
 * Direct manipulation on the preview, like any design tool: click an element
 * (text, caption, footage, screen frame) to select it, drag to move it, drag a
 * corner to scale it, double-click text to type into it. Click empty canvas to
 * deselect. One drag = one undo step.
 */
export function CanvasOverlay() {
  const ref = useRef<HTMLDivElement>(null);
  const selectedId = useEditor((s) => s.selectedClipId);
  const selected = useEditor((s) => s.project.clips.find((c) => c.id === s.selectedClipId));
  const editingId = useCanvasEdit((s) => s.editingId);
  const [box, setBox] = useState<Box | null>(null);

  // Element of a clip inside this preview (the composition marks them with data-clip-box).
  const elementOf = (id: string) => ref.current?.parentElement?.querySelector<HTMLElement>(`[data-clip-box="${id}"]`) ?? null;

  // Follow the selected element every frame (it moves with animation and keyframes).
  useEffect(() => {
    if (!selectedId) return setBox(null);
    let raf = 0;
    let last = "";
    const tick = () => {
      const host = ref.current?.getBoundingClientRect();
      const el = elementOf(selectedId);
      const clip = useEditor.getState().project.clips.find((c) => c.id === selectedId);
      let next: Box | null = null;
      if (host && el && clip && interactive(clip)) {
        const r = el.getBoundingClientRect();
        if (r.width > 1 && r.height > 1) next = { x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height };
      }
      const key = next ? `${Math.round(next.x)},${Math.round(next.y)},${Math.round(next.w)},${Math.round(next.h)}` : "";
      if (key !== last) {
        last = key;
        setBox(next);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Scroll scales the selected clip (not screen recordings: their frame has its own sizing).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { project, selectedClipId, dispatch } = useEditor.getState();
      const c = project.clips.find((x) => x.id === selectedClipId);
      if (!c || c.screen || !interactive(c)) return;
      e.preventDefault();
      const scale = Math.min(5, Math.max(0.1, (c.transform?.scale ?? 1) * (e.deltaY < 0 ? 1.05 : 0.95)));
      dispatch([{ type: "setClipProps", clipId: c.id, patch: { transform: { scale: Math.round(scale * 100) / 100 } } }]);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** Topmost clip under a screen point (captions above footage). */
  const hit = (x: number, y: number): Clip | undefined => {
    const { project } = useEditor.getState();
    for (const el of document.elementsFromPoint(x, y)) {
      if (!ref.current?.parentElement?.contains(el) || ref.current.contains(el)) continue;
      const id = (el as HTMLElement).closest<HTMLElement>("[data-clip-box]")?.dataset.clipBox;
      const clip = id ? project.clips.find((c) => c.id === id) : undefined;
      if (clip && interactive(clip)) return clip;
    }
    return undefined;
  };

  const drag = (e: React.PointerEvent, clip: Clip) => {
    const rect = ref.current!.getBoundingClientRect();
    const start = positionOf(clip);
    const x0 = e.clientX;
    const y0 = e.clientY;
    let began = false;
    const move = (ev: PointerEvent) => {
      if (!began) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
        began = true;
        useEditor.getState().beginGesture();
      }
      // Shift locks to the dominant axis.
      let dx = ev.clientX - x0;
      let dy = ev.clientY - y0;
      if (ev.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      useEditor.getState().live(moveCommand(clip, start.x + (dx / rect.width) * 100, start.y + (dy / rect.height) * 100));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const clip = hit(e.clientX, e.clientY);
    const st = useEditor.getState();
    if (!clip) {
      if (editingId) useCanvasEdit.getState().edit(null);
      else if (st.selectedClipId) st.select(null);
      return;
    }
    if (clip.id !== st.selectedClipId) st.select(clip.id);
    drag(e, clip);
  };

  const scaleFrom = (e: React.PointerEvent) => {
    if (!selected || !box) return;
    e.stopPropagation();
    e.preventDefault();
    const host = ref.current!.getBoundingClientRect();
    const cx = host.left + box.x + box.w / 2;
    const cy = host.top + box.y + box.h / 2;
    const d0 = Math.max(4, Math.hypot(e.clientX - cx, e.clientY - cy));
    const s0 = selected.transform?.scale ?? DEFAULT_TRANSFORM.scale;
    const id = selected.id;
    useEditor.getState().beginGesture();
    const move = (ev: PointerEvent) => {
      const s = Math.min(5, Math.max(0.1, (s0 * Math.hypot(ev.clientX - cx, ev.clientY - cy)) / d0));
      useEditor.getState().live({ type: "setClipProps", clipId: id, patch: { transform: { scale: Math.round(s * 100) / 100 } } });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const editing = editingId && selected?.id === editingId && selected.text !== undefined;
  const canScale = selected && !selected.screen;

  return (
    <div
      ref={ref}
      role="application"
      aria-label="Canvas: click to select, drag to move"
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        const clip = hit(e.clientX, e.clientY);
        if (clip?.text !== undefined) useCanvasEdit.getState().edit(clip.id);
        else if (clip) useEditor.getState().dispatch([resetPosition(clip)]);
      }}
      className="absolute inset-0 z-20 touch-none"
      style={{ cursor: "default" }}
    >
      {box && selected && !editing && (
        <div
          className="pointer-events-none absolute rounded-[3px] ring-[0.5px] ring-secondary/80"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        >
          {canScale &&
            (["-left-1.5 -top-1.5 cursor-nwse-resize", "-right-1.5 -top-1.5 cursor-nesw-resize", "-left-1.5 -bottom-1.5 cursor-nesw-resize", "-right-1.5 -bottom-1.5 cursor-nwse-resize"] as const).map((pos) => (
              <span
                key={pos}
                onPointerDown={scaleFrom}
                className={`pointer-events-auto absolute size-3 rounded-full border border-black/30 bg-white ${pos}`}
              />
            ))}
        </div>
      )}
      {box && editing && selected && <TextEditor clip={selected} box={box} />}
    </div>
  );
}

/** Typing straight onto the canvas; the composition re-renders the text live underneath. */
function TextEditor({ clip, box }: { clip: Clip; box: Box }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const begun = useRef(false);
  const [value, setValue] = useState(clip.text ?? "");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = () => {
    const text = value.trim();
    const st = useEditor.getState();
    useCanvasEdit.getState().edit(null);
    // A text box left empty disappears, like in any design tool.
    if (!text) {
      if (begun.current) st.live({ type: "deleteClip", clipId: clip.id });
      else st.dispatch([{ type: "deleteClip", clipId: clip.id }]);
    }
  };

  const minW = 180;
  const w = Math.max(minW, box.w + 24);
  return (
    <textarea
      ref={ref}
      value={value}
      placeholder="Type text…"
      aria-label="Text"
      rows={1}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        setValue(e.target.value);
        // The whole typing session is one undo step.
        if (!begun.current) {
          begun.current = true;
          useEditor.getState().beginGesture();
        }
        useEditor.getState().live({ type: "setClipProps", clipId: clip.id, patch: { text: e.target.value } });
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if ((e.key === "Enter" && !e.shiftKey) || e.key === "Escape") {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
      className="absolute resize-none rounded-[8px] bg-black/75 px-3 py-2 text-center text-base font-bold text-white shadow-2xl ring-[0.5px] ring-secondary/80 outline-none placeholder:text-white/50"
      style={{
        left: box.x + box.w / 2 - w / 2,
        top: box.y + box.h / 2 - Math.max(40, box.h) / 2,
        width: w,
        minHeight: Math.max(40, box.h),
      }}
    />
  );
}
