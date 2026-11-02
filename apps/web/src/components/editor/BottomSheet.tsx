"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

const EASE = "var(--ease-drawer)"; // iOS-like drawer curve, close to a critically damped spring

/** Apple's momentum projection: where a flick would come to rest. */
const project = (velocity: number, decel = 0.998) => ((velocity / 1000) * decel) / (1 - decel);

/** Progressive resistance past a boundary instead of a hard stop. */
const rubberband = (overshoot: number, dimension: number, c = 0.55) =>
  (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));

/**
 * Mobile sheet that tracks the finger 1:1 from the grab point, rubber-bands
 * upward, and decides dismiss vs. stay from the projected (not release) position.
 * Because closing is a CSS transition from the live inline transform, it can be
 * grabbed again mid-flight.
 */
export function BottomSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Callers pass an inline onClose; keep the latest without re-running the focus effect.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Modal focus: move in on open, return to the trigger on close, Escape closes.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [open]);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // Start from the presentation value so a sheet caught mid-animation doesn't jump.
    // Tailwind v4 positions with the standalone `translate` property; the drag drives it directly.
    const cs = getComputedStyle(el);
    const current = cs.translate === "none" ? 0 : parseFloat(cs.translate.split(" ")[1] ?? "0") || 0;
    const y0 = e.clientY - current;
    const height = el.offsetHeight;
    const samples: { y: number; t: number }[] = [{ y: e.clientY, t: e.timeStamp }];
    let offset = current;
    el.style.transition = "none";
    el.style.translate = `0 ${current}px`;

    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      offset = dy >= 0 ? dy : rubberband(dy, height);
      el.style.translate = `0 ${offset}px`;
      samples.push({ y: ev.clientY, t: ev.timeStamp });
      if (samples.length > 5) samples.shift();
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const first = samples[0]!;
      const dt = Math.max(1, ev.timeStamp - first.t);
      const velocity = ((ev.clientY - first.y) / dt) * 1000; // px/s
      const dismiss = Math.max(0, offset) + project(velocity) > height * 0.35;
      // Hand the finger's speed to the settle: faster flick, shorter settle.
      const remaining = dismiss ? height - offset : Math.abs(offset);
      const duration = Math.min(0.32, Math.max(0.16, Math.abs(velocity) > 50 ? remaining / Math.abs(velocity) : 0.3));
      el.style.transition = `translate ${duration}s ${EASE}, opacity ${duration}s ${EASE}`;
      // Animate from where the finger left it straight to the final position (no retarget hiccup).
      el.style.translate = dismiss ? "0 100%" : "";
      if (dismiss) onClose();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <>
      {/* Modal task: a scrim dims and separates the background. */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        inert={!open}
        onTransitionEnd={(e) => {
          if (e.target !== ref.current) return;
          ref.current.style.transition = "";
          ref.current.style.translate = "";
        }}
        style={{ transitionTimingFunction: EASE }}
        className={`motion-slide card-glow fixed inset-x-0 bottom-0 z-50 flex h-[80dvh] flex-col rounded-t-[26px] border-t border-ink/[0.08] pb-[env(safe-area-inset-bottom)] shadow-[0_-20px_60px_-20px_rgb(0_0_0/0.8)] transition-[translate,opacity] duration-300 ${
          open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0"
        }`}
      >
        <div onPointerDown={onPointerDown} className="relative flex h-7 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing">
          <div className="h-1 w-10 rounded-full bg-ink/25" />
          <button
            ref={closeRef}
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute top-1 right-2 flex size-8 items-center justify-center rounded-full text-muted"
            aria-label="Tutup"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </>
  );
}
