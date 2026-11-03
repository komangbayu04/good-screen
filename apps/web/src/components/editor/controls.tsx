"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEditor, type Clip, type EditCommand, type KeyProp } from "@goodscreen/editor-core";
import { KeyframeButton, useAnimated } from "./Keyframes";
import { usePersistentState } from "@/lib/persist";

/**
 * A collapsible group inside an inspector tab. Open/closed is remembered per
 * section, so a long list of tools stays the way the user left it. Toggling is
 * instant: it happens many times per session, so it gets no animation.
 * The heading is plain text (no icon): the panel's title already says what this is.
 * Resetting lives in one place, the Reset button at the bottom of the panel.
 */
export function Section({
  title,
  enabled,
  keyframe,
  children,
}: {
  title: string;
  /** Diamond in the header that keys every listed property at once. */
  keyframe?: { clip: Clip; props: KeyProp[] };
  /** Header checkbox that switches the whole group on or off (e.g. Blend). */
  enabled?: { checked: boolean; onChange: (checked: boolean) => void };
  children: React.ReactNode;
}) {
  const [open, setOpen] = usePersistentState(`reels.section.${title}`, true);
  const bodyId = useId();
  return (
    <section className="border-b border-ink/[0.06] last:border-b-0">
      <div className="flex items-center gap-1 px-2 py-1.5">
        {enabled && (
          <input
            type="checkbox"
            checked={enabled.checked}
            onChange={(e) => enabled.onChange(e.target.checked)}
            aria-label={`Enable ${title}`}
            className="ml-1.5 size-4 shrink-0 cursor-pointer accent-[var(--color-secondary)]"
          />
        )}
        <h4 className="min-w-0 flex-1">
          <button
            data-no-press
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(!open)}
            className="flex h-9 w-full items-center gap-2 rounded-[8px] px-1.5 text-left transition-colors hover:bg-ink/[0.03]"
          >
            <span className="min-w-0 flex-1 truncate text-ui font-semibold">{title}</span>
            <ChevronDown className={`size-3.5 shrink-0 text-muted ${open ? "" : "-rotate-90"}`} />
          </button>
        </h4>
        {keyframe && <KeyframeButton clip={keyframe.clip} props={keyframe.props} label={title} />}
      </div>
      <div
        id={bodyId}
        hidden={!open}
        inert={enabled ? !enabled.checked : undefined}
        className={`space-y-3 px-3.5 pt-1 pb-3.5 ${enabled && !enabled.checked ? "opacity-40" : ""}`}
      >
        {children}
      </div>
    </section>
  );
}

/** The panel's one Reset: a bar under the scrolling content, for everything the panel shows. */
export function ResetBar({ onReset, disabled }: { onReset: () => void; disabled?: boolean }) {
  return (
    <div className="flex shrink-0 justify-end border-t border-ink/[0.06] px-3 py-2">
      <button
        onClick={onReset}
        disabled={disabled}
        className="h-8 rounded-[8px] bg-panel-3 px-4 text-xs font-medium text-fg/90 transition-colors hover:bg-line disabled:opacity-40"
      >
        Reset
      </button>
    </div>
  );
}

export const FieldLabel =({ children }: { children: React.ReactNode }) => <p className="text-xs text-fg/75">{children}</p>;

/**
 * Number box with up/down steppers. Typing commits on blur/Enter; steppers
 * commit immediately. Values are shown through `format` and parsed back as numbers.
 */
export function NumberStepper({
  value,
  step,
  min,
  max,
  suffix = "",
  decimals = 0,
  label,
  onCommit,
  className = "w-[92px]",
}: {
  value: number;
  step: number;
  min: number;
  max: number;
  suffix?: string;
  decimals?: number;
  label: string;
  onCommit: (v: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const commit = (v: number) => onCommit(Number(clamp(v).toFixed(decimals)));
  return (
    <div className={`flex h-8 shrink-0 items-center rounded-[8px] bg-panel-3/70 pl-2.5 ring-1 ring-ink/[0.04] focus-within:ring-secondary/60 ${className}`}>
      <input
        aria-label={label}
        inputMode="decimal"
        value={draft ?? `${value.toFixed(decimals)}${suffix}`}
        onFocus={(e) => {
          setDraft(value.toFixed(decimals));
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = parseFloat(draft ?? "");
          if (Number.isFinite(v)) commit(v);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            commit(value + (e.key === "ArrowUp" ? step : -step) * (e.shiftKey ? 10 : 1));
          }
        }}
        className="h-full w-full min-w-0 bg-transparent font-mono text-base tabular-nums outline-none lg:text-xs"
      />
      <div className="flex h-full flex-col border-l border-ink/[0.06]">
        <button data-no-press aria-label={`Increase ${label}`} onClick={() => commit(value + step)} className="flex flex-1 items-center px-1 text-muted hover:text-fg">
          <ChevronUp className="size-3" />
        </button>
        <button data-no-press aria-label={`Decrease ${label}`} onClick={() => commit(value - step)} className="flex flex-1 items-center px-1 text-muted hover:text-fg">
          <ChevronDown className="size-3" />
        </button>
      </div>
    </div>
  );
}

/**
 * Slider + number box on one row (CapCut-style). Dragging is one undo step:
 * snapshot on pointer-down, live updates while moving.
 */
export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  decimals = 0,
  ticks,
  toCommand,
  keyframe,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  decimals?: number;
  /** Optional tick marks, in slider units. */
  ticks?: number[];
  toCommand: (v: number) => EditCommand;
  /** Makes the property keyframeable; `scale` converts model units to slider units (e.g. 100 for %). */
  keyframe?: { clip: Clip; prop: KeyProp; scale?: number };
}) {
  if (keyframe) return <KeyedSliderField {...{ label, min, max, step, suffix, decimals, ticks, toCommand, keyframe }} />;
  return <SliderBody {...{ label, value, min, max, step, suffix, decimals, ticks, toCommand }} />;
}

function KeyedSliderField(p: Omit<Parameters<typeof SliderField>[0], "value"> & { keyframe: NonNullable<Parameters<typeof SliderField>[0]["keyframe"]> }) {
  const { clip, prop, scale = 1 } = p.keyframe;
  const raw = useAnimated(clip, prop) * scale;
  const value = Number(raw.toFixed(p.decimals ?? 0));
  return <SliderBody {...p} value={value} extra={<KeyframeButton clip={clip} props={[prop]} label={p.label} />} />;
}

function SliderBody({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  decimals = 0,
  ticks,
  toCommand,
  extra,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  decimals?: number;
  ticks?: number[];
  toCommand: (v: number) => EditCommand;
  extra?: React.ReactNode;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <FieldLabel>{label}</FieldLabel>
        {extra}
      </div>
      <div className="flex items-center gap-3">
        <div className="relative flex h-8 flex-1 items-center">
          {ticks?.map((t) => (
            <span
              key={t}
              className="pointer-events-none absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-ink/25"
              style={{ left: `${((t - min) / (max - min)) * 100}%` }}
            />
          ))}
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-label={label}
            onPointerDown={() => useEditor.getState().beginGesture()}
            onKeyDown={() => useEditor.getState().beginGesture()}
            onChange={(e) => useEditor.getState().live(toCommand(Number(e.target.value)))}
            style={{ "--fill": `${pct}%` } as React.CSSProperties}
            className="range-field relative w-full"
          />
        </div>
        <NumberStepper
          label={label}
          value={value}
          min={min}
          max={max}
          step={step >= 1 ? step : step * 5}
          suffix={suffix}
          decimals={decimals}
          onCommit={(v) => useEditor.getState().dispatch([toCommand(v)])}
        />
      </div>
    </div>
  );
}

export function Chips<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => o.id !== value && onChange(o.id)}
          className={`h-7 rounded-full px-3 text-xs transition-colors ${
            o.id === value ? "border border-transparent is-selected" : "border border-line text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** APG tabs keyboard: arrows/Home/End move focus and activate. Put on the `role="tablist"` element. */
export function onTabListKeyDown(e: React.KeyboardEvent<HTMLElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  e.stopPropagation();
  const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]!.focus();
  tabs[next]!.click();
}

/** Full-width segmented control (Standard / Curve style). */
export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div
      role="tablist"
      onKeyDown={onTabListKeyDown}
      className="grid gap-1 rounded-[10px] bg-panel-3/50 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={o.id === value}
          tabIndex={o.id === value ? 0 : -1}
          onClick={() => onChange(o.id)}
          className={`h-7 rounded-[7px] text-xs transition-colors ${o.id === value ? "is-selected font-medium" : "text-muted hover:text-fg"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-secondary" : "bg-panel-3"}`}
    >
      {/* On: white track, dark thumb (the selection colour is white, so a white thumb would vanish). */}
      <span className={`absolute top-0.5 left-0 size-4 rounded-full transition-transform ${on ? "translate-x-[18px] bg-on-secondary" : "translate-x-0.5 bg-white"}`} />
    </button>
  );
}

export function ToggleRow({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <FieldLabel>{label}</FieldLabel>
      <Toggle label={label} on={on} onChange={onChange} />
    </div>
  );
}
