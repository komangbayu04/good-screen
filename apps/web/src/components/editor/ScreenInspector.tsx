"use client";

import { useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  DEFAULT_SCREEN_STYLE,
  DEFAULT_ZOOM,
  useEditor,
  type CameraCorner,
  type CameraLayout,
  type Clip,
  type ClipPatch,
  type EditCommand,
  type ScreenCamera,
  type ZoomSpec,
} from "@goodscreen/editor-core";
import { SCREEN_BACKGROUNDS } from "@goodscreen/motion";
import { fileToAsset } from "@/lib/media";
import { saveMedia } from "@/lib/persistence";
import { Chips, FieldLabel, Section, SliderField, ToggleRow } from "./controls";

type ScreenPatch = NonNullable<ClipPatch["screen"]>;
const screenPatch = (clipId: string, screen: ScreenPatch): EditCommand => ({ type: "setClipProps", clipId, patch: { screen } });

/* ------------------------------------------------------------------ Background */

export function BackgroundTab({ clip }: { clip: Clip }) {
  const dispatch = useEditor((s) => s.dispatch);
  const style = { ...DEFAULT_SCREEN_STYLE, ...clip.screen };
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (screen: ScreenPatch) => dispatch([screenPatch(clip.id, screen)]);
  const bg = style.background;
  const tracked = useEditor((s) => !!s.project.assets.find((a) => a.id === clip.assetId)?.cursor?.length);

  const uploadImage = async (file: File) => {
    const asset = await fileToAsset(file);
    if (!asset) return;
    useEditor.getState().addAsset(asset, { place: false });
    void saveMedia(asset.id, file);
    set({ background: { kind: "image", value: asset.id } });
  };

  return (
    <>
      <Section title="Background">
        {/* Compact swatches, six to a row: a palette, not a gallery. */}
        <div className="grid grid-cols-6 gap-2">
          {SCREEN_BACKGROUNDS.map((b) => {
            const on = bg.kind === "gradient" && bg.value === b.id;
            return (
              <button
                key={b.id}
                title={b.label}
                aria-label={`${b.label} background`}
                aria-pressed={on}
                onClick={() => set({ background: { kind: "gradient", value: b.id } })}
                className={`aspect-square rounded-[10px] ring-offset-2 ring-offset-panel ${on ? "ring-[0.5px] ring-secondary/80" : "ring-1 ring-ink/10"}`}
                style={{ backgroundImage: b.css }}
              />
            );
          })}
          <label
            title="Solid color"
            className={`relative flex aspect-square cursor-pointer items-center justify-center rounded-[10px] ring-offset-2 ring-offset-panel ${
              bg.kind === "color" ? "ring-[0.5px] ring-secondary/80" : "ring-1 ring-ink/10"
            }`}
            style={{ background: bg.kind === "color" ? bg.value : "conic-gradient(#f87171,#facc15,#4ade80,#60a5fa,#c084fc,#f87171)" }}
          >
            <input
              type="color"
              aria-label="Solid color"
              value={bg.kind === "color" ? bg.value : "#111111"}
              onChange={(e) => set({ background: { kind: "color", value: e.target.value } })}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <button
            onClick={() => fileRef.current?.click()}
            aria-label="Upload background image"
            title="Your own image"
            className={`flex aspect-square items-center justify-center rounded-[10px] bg-panel-3/70 text-fg/75 ring-offset-2 ring-offset-panel ${
              bg.kind === "image" ? "ring-[0.5px] ring-secondary/80" : "ring-1 ring-ink/10"
            }`}
          >
            <Plus className="size-4" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadImage(f);
              e.target.value = "";
            }}
          />
        </div>
      </Section>
      <Section title="Frame">
        <SliderField label="Padding" value={style.padding} min={0} max={20} step={0.5} decimals={1} suffix="%" toCommand={(v) => screenPatch(clip.id, { padding: v })} />
        <SliderField label="Corners" value={style.radius} min={0} max={60} suffix="px" toCommand={(v) => screenPatch(clip.id, { radius: v })} />
        <SliderField label="Shadow" value={Math.round(style.shadow * 100)} min={0} max={100} suffix="%" toCommand={(v) => screenPatch(clip.id, { shadow: v / 100 })} />
        {tracked && (
          <>
            <ToggleRow label="Reframe to follow cursor" on={!!style.reframe} onChange={(reframe) => set({ reframe })} />
            <p className="text-meta leading-relaxed text-muted">In 1:1, 4:5 and 9:16 frames, the recording fills the frame and pans to follow the cursor.</p>
          </>
        )}
      </Section>
    </>
  );
}

/* ----------------------------------------------------------------- Camera */

const LAYOUTS: { id: CameraLayout; label: string }[] = [
  { id: "screen", label: "Screen only" },
  { id: "overlay", label: "Overlay" },
  { id: "split", label: "Split" },
  { id: "camera", label: "Camera" },
];

function LayoutGlyph({ id }: { id: CameraLayout }) {
  const screen = "rounded-[2px] bg-current opacity-70";
  return (
    <span className="relative block h-9 w-6 overflow-hidden rounded-[4px] bg-black/40 p-[3px]">
      {id === "screen" && <span className={`absolute inset-x-[3px] top-1/2 h-3 -translate-y-1/2 ${screen}`} />}
      {id === "overlay" && (
        <>
          <span className={`absolute inset-x-[3px] top-1/2 h-3 -translate-y-1/2 ${screen}`} />
          <span className="absolute right-[3px] bottom-[3px] size-2 rounded-full bg-secondary" />
        </>
      )}
      {id === "split" && (
        <>
          <span className={`absolute inset-x-[3px] top-[3px] h-[13px] ${screen}`} />
          <span className="absolute inset-x-[3px] bottom-[3px] h-[13px] rounded-[2px] bg-secondary" />
        </>
      )}
      {id === "camera" && <span className="absolute inset-[3px] rounded-[2px] bg-secondary" />}
    </span>
  );
}

export function CameraTab({ clip }: { clip: Clip }) {
  const dispatch = useEditor((s) => s.dispatch);
  const cam = clip.screen?.camera;
  if (!cam)
    return (
      <Section title="Camera">
        <p className="text-meta leading-relaxed text-muted">This recording has no webcam.</p>
      </Section>
    );
  const setCam = (camera: Partial<ScreenCamera>) => dispatch([screenPatch(clip.id, { camera })]);
  const CORNERS: { id: CameraCorner; label: string }[] = [
    { id: "tl", label: "Top left" },
    { id: "tr", label: "Top right" },
    { id: "bl", label: "Bottom left" },
    { id: "br", label: "Bottom right" },
  ];

  return (
    <>
      <Section title="Layout">
        <div className="grid grid-cols-4 gap-1.5">
          {LAYOUTS.map((l) => {
            const on = cam.layout === l.id;
            return (
              <button
                key={l.id}
                aria-pressed={on}
                onClick={() => setCam({ layout: l.id })}
                className={`flex flex-col items-center gap-1.5 rounded-[10px] py-2.5 text-meta transition-colors ${
                  on ? "is-selected" : "bg-panel-3/40 text-muted hover:text-fg"
                }`}
              >
                <LayoutGlyph id={l.id} />
                {l.label}
              </button>
            );
          })}
        </div>
      </Section>
      {cam.layout === "overlay" && (
        <Section title="Shape and position">
          <Chips
            options={[
              { id: "circle", label: "Circle" },
              { id: "rounded", label: "Rounded" },
            ]}
            value={cam.shape}
            onChange={(shape) => setCam({ shape })}
          />
          <SliderField
            label="Size"
            value={Math.round(cam.size * 100)}
            min={12}
            max={45}
            suffix="%"
            toCommand={(v) => screenPatch(clip.id, { camera: { size: v / 100 } })}
          />
          <div className="flex items-center justify-between">
            <FieldLabel>Corner</FieldLabel>
            <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-panel-3/50 p-1">
              {CORNERS.map((c) => (
                <button
                  key={c.id}
                  aria-label={c.label}
                  aria-pressed={cam.corner === c.id}
                  onClick={() => setCam({ corner: c.id })}
                  className={`flex size-7 items-center justify-center rounded-[6px] ${cam.corner === c.id ? "is-selected" : "text-muted hover:bg-panel-3"}`}
                >
                  <span className="size-2 rounded-full bg-current" />
                </button>
              ))}
            </div>
          </div>
        </Section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- Zoom */

export function ZoomTab({ clip }: { clip: Clip }) {
  const project = useEditor((s) => s.project);
  const z = { ...DEFAULT_ZOOM, ...clip.zoom };
  const zoomCmd = (zoom: Partial<ZoomSpec>): EditCommand => ({ type: "setClipProps", clipId: clip.id, patch: { zoom } });
  // The recording under this zoom, for the focus picker's backdrop.
  const videoTrack = project.tracks.find((t) => t.kind === "video")?.id;
  const under = project.clips.find((c) => c.trackId === videoTrack && clip.start < c.start + c.duration && clip.start + clip.duration > c.start);
  const asset = project.assets.find((a) => a.id === under?.assetId);
  const aspect = asset?.width && asset.height ? asset.width / asset.height : 16 / 9;
  const pickRef = useRef<HTMLDivElement>(null);

  // Picking a point always works: it fixes the focus there (and stops following the cursor).
  const pointTo = (clientX: number, clientY: number, live: boolean) => {
    const r = pickRef.current!.getBoundingClientRect();
    const x = Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * 1000) / 1000;
    const y = Math.round(Math.min(1, Math.max(0, (clientY - r.top) / r.height)) * 1000) / 1000;
    if (live) useEditor.getState().live(zoomCmd({ x, y, follow: false }));
    else useEditor.getState().dispatch([zoomCmd({ x, y, follow: false })]);
  };
  const following = !!z.follow && !!asset?.cursor?.length;

  return (
    <>
      <Section title="Focus">
        {!!asset?.cursor?.length && (
          <ToggleRow label="Follow cursor" on={!!z.follow} onChange={(follow) => useEditor.getState().dispatch([zoomCmd({ follow })])} />
        )}
        <p className="text-meta leading-relaxed text-muted">
          {following ? "The zoom moves with the cursor. Click the picture to fix the focus on a point instead." : "Click or drag on the picture to choose where the zoom looks."}
        </p>
        <div
          ref={pickRef}
          role="slider"
          tabIndex={0}
          aria-label="Zoom focus point"
          aria-valuetext={`${Math.round(z.x * 100)}% from the left, ${Math.round(z.y * 100)}% from the top`}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            useEditor.getState().beginGesture();
            pointTo(e.clientX, e.clientY, true);
            const move = (ev: PointerEvent) => pointTo(ev.clientX, ev.clientY, true);
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.1 : 0.02;
            const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
            if (!d) return;
            e.preventDefault();
            e.stopPropagation();
            useEditor.getState().dispatch([zoomCmd({ x: Math.min(1, Math.max(0, z.x + d[0]!)), y: Math.min(1, Math.max(0, z.y + d[1]!)), follow: false })]);
          }}
          className="relative w-full cursor-crosshair touch-none overflow-hidden rounded-[10px] bg-black ring-1 ring-ink/10 outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          style={{ aspectRatio: aspect }}
        >
          {asset?.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={asset.thumbnail} alt="" draggable={false} className="size-full object-cover opacity-70" />
          )}
          {/* Visible area at this zoom level, centred on the focus point. */}
          <span
            className="pointer-events-none absolute rounded-[4px] border border-secondary/60 bg-secondary/10"
            style={{
              width: `${100 / z.scale}%`,
              height: `${100 / z.scale}%`,
              left: `${z.x * 100 * (1 - 1 / z.scale)}%`,
              top: `${z.y * 100 * (1 - 1 / z.scale)}%`,
            }}
          />
          {/* While following, the marker is dimmed: the real focus moves with the cursor. */}
          <span
            className={`pointer-events-none absolute size-3 -translate-1/2 rounded-full border-2 border-white bg-accent ${following ? "opacity-40" : ""}`}
            style={{ left: `${z.x * 100}%`, top: `${z.y * 100}%` }}
          />
        </div>
      </Section>
      <Section title="Selected zoom">
        <SliderField label="Magnification" value={z.scale} min={1.1} max={4} step={0.05} decimals={2} suffix="×" ticks={[2, 3]} toCommand={(v) => zoomCmd({ scale: v })} />
        <SliderField label="Transition" value={z.ease} min={0.1} max={1.5} step={0.05} decimals={2} suffix="s" toCommand={(v) => zoomCmd({ ease: v })} />
        <button
          onClick={() => useEditor.getState().dispatch([{ type: "deleteClip", clipId: clip.id }])}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] text-xs text-fg/80 ring-1 ring-line transition-colors hover:text-red-400"
        >
          <Trash2 className="size-3.5" /> Delete zoom
        </button>
      </Section>
    </>
  );
}
