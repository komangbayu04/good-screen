"use client";

import { useState } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowRight,
  AudioLines,
  AudioWaveform,
  Brush,
  ChevronDown,
  Layers,
  Clapperboard,
  Eye,
  Gauge,
  Move,
  Palette,
  Timer,
  Type,
  Volume2,
  Wand2,
  FlipHorizontal2,
  Loader2,
  FlipVertical2,
  Scissors,
  ZoomIn,
} from "lucide-react";
import {
  DEFAULT_ADJUST,
  DEFAULT_ANIM_DURATION,
  DEFAULT_TRANSFORM,
  SPEED_MAX,
  SPEED_MIN,
  useEditor,
  type Asset,
  type BlendMode,
  type CaptionStyle,
  ADJUST_PROPS,
  TRANSFORM_PROPS,
  type Clip,
  type ClipPatch,
  type EditCommand,
  type Track,
  type Transition,
  type TransitionOut,
} from "@goodscreen/editor-core";
import { MOTION_TEMPLATES, templateMeta } from "@goodscreen/motion/templates";
import { CAPTION_DEFAULT_Y } from "@goodscreen/motion";
import { decodeAudio, findSpeech, silenceCommands } from "@/lib/audio";
import { useTools } from "@/lib/tools";
import { toast } from "@/lib/toast";
import { KeyframeBar, KeyframeButton, useAnimated } from "./Keyframes";
import { Chips, FieldLabel, NumberStepper, Section, Segmented, SliderField, ToggleRow, onTabListKeyDown } from "./controls";

type Tab = "video" | "speed" | "animation" | "adjust" | "audio" | "text" | "motion";

const TAB_LABEL: Record<Tab, string> = {
  video: "Video",
  speed: "Kecepatan",
  animation: "Animasi",
  adjust: "Warna",
  audio: "Audio",
  text: "Teks",
  motion: "Motion",
};

/** Which sub-menus apply to a clip, in the order shown. */
function tabsFor(track: Track, asset: Asset | undefined, clip: Clip): Tab[] {
  // Background, camera and zoom are canvas tools beside the preview, not footage editing.
  if (clip.screen) return ["video", "speed", "animation", "adjust", "audio"];
  if (clip.text !== undefined) return ["text", "animation"];
  if (clip.motion) return ["motion", "animation"];
  if (track.kind === "audio") return ["audio", "speed"];
  if (asset?.kind === "image") return ["video", "animation", "adjust"];
  return ["video", "speed", "animation", "adjust", "audio"];
}

const props = (clipId: string, patch: ClipPatch): EditCommand => ({ type: "setClipProps", clipId, patch });

// Remember the last sub-menu per clip kind, so hopping between clips keeps your place.
const lastTab = new Map<string, Tab>();

export function ClipInspector({ clip, track, asset }: { clip: Clip; track: Track; asset?: Asset }) {
  // Zoom segments are a canvas tool: point there instead of offering footage tabs.
  if (clip.zoom)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <ZoomIn className="size-5 text-muted" />
        <p className="text-ui text-fg/85">Segmen zoom</p>
        <button onClick={() => useTools.getState().open("zoom")} className="mt-1 h-8 rounded-full bg-panel-3 px-4 text-xs font-medium">
          Buka alat Zoom
        </button>
      </div>
    );
  return <FootageInspector clip={clip} track={track} asset={asset} />;
}

function FootageInspector({ clip, track, asset }: { clip: Clip; track: Track; asset?: Asset }) {
  const tabs = tabsFor(track, asset, clip);
  const kindKey = `${track.kind}:${asset?.kind ?? ""}:${clip.screen ? "screen" : ""}`;
  const [tab, setTabState] = useState<Tab>(() => {
    const remembered = lastTab.get(kindKey);
    return remembered && tabs.includes(remembered) ? remembered : tabs[0]!;
  });
  const setTab = (t: Tab) => {
    lastTab.set(kindKey, t);
    setTabState(t);
  };
  const current = tabs.includes(tab) ? tab : tabs[0]!;
  const dispatch = useEditor((s) => s.dispatch);

  const reset: Record<Tab, () => void> = {
    video: () => dispatch([props(clip.id, { transform: DEFAULT_TRANSFORM, kenBurns: false }), { type: "clearKeyframes", clipId: clip.id, props: TRANSFORM_PROPS }]),
    speed: () => dispatch([{ type: "setSpeed", clipId: clip.id, speed: 1 }]),
    animation: () =>
      dispatch([props(clip.id, { transitionIn: "none", transitionOut: "none", transitionInDuration: undefined, transitionOutDuration: undefined })]),
    adjust: () => dispatch([props(clip.id, { adjust: DEFAULT_ADJUST }), { type: "clearKeyframes", clipId: clip.id, props: ADJUST_PROPS }]),
    audio: () => dispatch([props(clip.id, { volume: 1, fadeIn: 0, fadeOut: 0 }), { type: "clearKeyframes", clipId: clip.id, props: ["volume"] }]),
    text: () => dispatch([props(clip.id, { captionSize: 1, captionY: CAPTION_DEFAULT_Y, captionColor: "#ffffff" })]),
    motion: () => clip.motion && dispatch([{ type: "setMotionProps", clipId: clip.id, props: templateMeta(clip.motion.template).defaultProps }]),
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sub-menu */}
      <div role="tablist" onKeyDown={onTabListKeyDown} className="scrollbar-thin flex shrink-0 gap-4 overflow-x-auto border-b border-ink/[0.06] px-3.5">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            data-no-press
            aria-selected={t === current}
            tabIndex={t === current ? 0 : -1}
            onClick={() => setTab(t)}
            className={`relative h-10 shrink-0 text-ui font-medium transition-colors ${
              t === current ? "text-secondary" : "text-muted hover:text-fg"
            }`}
          >
            {TAB_LABEL[t]}
            {t === current && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-secondary" />}
          </button>
        ))}
      </div>

      <div className="scroll-fade scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {["video", "adjust", "audio"].includes(current) && <KeyframeBar clip={clip} />}
        {current === "video" && <VideoTab clip={clip} onReset={reset.video} />}
        {current === "speed" && <SpeedTab clip={clip} />}
        {current === "animation" && <AnimationTab clip={clip} />}
        {current === "adjust" && <AdjustTab clip={clip} onReset={reset.adjust} />}
        {current === "audio" && <AudioTab clip={clip} asset={asset} />}
        {current === "text" && <TextTab clip={clip} />}
        {current === "motion" && <MotionTab clip={clip} />}
      </div>

      <div className="flex shrink-0 justify-end border-t border-ink/[0.06] px-3 py-2">
        <button onClick={reset[current]} className="h-8 rounded-[8px] bg-panel-3 px-4 text-xs font-medium text-fg/90 transition-colors hover:bg-line">
          Atur ulang
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Video */

function VideoTab({ clip, onReset }: { clip: Clip; onReset: () => void }) {
  const dispatch = useEditor((s) => s.dispatch);
  const tf = { ...DEFAULT_TRANSFORM, ...clip.transform };
  // Shown values follow the animation at the playhead.
  const ax = useAnimated(clip, "x");
  const ay = useAnimated(clip, "y");
  const arot = useAnimated(clip, "rotate");
  const set = (patch: Partial<typeof tf>) => dispatch([props(clip.id, { transform: patch })]);
  // Aligning only makes sense when the clip is smaller than the frame.
  const edge = Math.max(0, (1 - tf.scale) * 50);
  const ALIGN = [
    { label: "Rata kiri", icon: AlignStartVertical, patch: { x: -edge } },
    { label: "Tengah horizontal", icon: AlignCenterVertical, patch: { x: 0 } },
    { label: "Rata kanan", icon: AlignEndVertical, patch: { x: edge } },
    { label: "Rata atas", icon: AlignStartHorizontal, patch: { y: -edge } },
    { label: "Tengah vertikal", icon: AlignCenterHorizontal, patch: { y: 0 } },
    { label: "Rata bawah", icon: AlignEndHorizontal, patch: { y: edge } },
  ];

  return (
    <>
      <Section title="Transform" icon={Move} onReset={onReset} keyframe={{ clip, props: TRANSFORM_PROPS }}>
        <SliderField
          label="Skala"
          value={Math.round(tf.scale * 100)}
          min={10}
          max={300}
          suffix="%"
          ticks={[100]}
          keyframe={{ clip, prop: "scale", scale: 100 }}
          toCommand={(v) => props(clip.id, { transform: { scale: v / 100 } })}
        />
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>Posisi</FieldLabel>
          <div className="flex items-center gap-1.5">
            <AxisField axis="X" value={Math.round(ax * 10) / 10} onCommit={(x) => set({ x })} />
            <AxisField axis="Y" value={Math.round(ay * 10) / 10} onCommit={(y) => set({ y })} />
            <KeyframeButton clip={clip} props={["x", "y"]} label="posisi" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>Rotasi</FieldLabel>
          <div className="flex items-center gap-1.5">
            <NumberStepper label="Rotasi" value={Math.round(arot)} min={-360} max={360} step={1} suffix="°" onCommit={(rotate) => set({ rotate })} />
            <KeyframeButton clip={clip} props={["rotate"]} label="rotasi" />
          </div>
        </div>
        <div className="flex gap-1 rounded-[10px] bg-panel-3/50 p-1">
          {ALIGN.map((a, i) => (
            <button
              key={a.label}
              title={a.label}
              aria-label={a.label}
              onClick={() => set(a.patch)}
              className={`flex h-7 flex-1 items-center justify-center rounded-[7px] text-fg/75 transition-colors hover:bg-panel-3 hover:text-fg ${i === 3 ? "ml-1 border-l border-ink/[0.06]" : ""}`}
            >
              <a.icon className="size-4" />
            </button>
          ))}
        </div>
      </Section>

      <BlendSection clip={clip} />

      <Section title="Tampilan" icon={Eye}>
        <div className="space-y-2">
          <FieldLabel>Ukuran di frame</FieldLabel>
          <Segmented
            options={[
              { id: "fill", label: "Isi frame" },
              { id: "fit", label: "Pas (letterbox)" },
            ]}
            value={tf.fit}
            onChange={(fit) => set({ fit })}
          />
        </div>
        <div className="flex items-center justify-between">
          <FieldLabel>Balik</FieldLabel>
          <div className="flex gap-1.5">
            <IconToggle label="Balik horizontal" on={tf.flipH} onClick={() => set({ flipH: !tf.flipH })}>
              <FlipHorizontal2 className="size-4" />
            </IconToggle>
            <IconToggle label="Balik vertikal" on={tf.flipV} onClick={() => set({ flipV: !tf.flipV })}>
              <FlipVertical2 className="size-4" />
            </IconToggle>
          </div>
        </div>
        <ToggleRow label="Ken Burns (zoom pelan)" on={!!clip.kenBurns} onChange={(on) => dispatch([props(clip.id, { kenBurns: on })])} />
      </Section>
    </>
  );
}

function AxisField({ axis, value, onCommit }: { axis: "X" | "Y"; value: number; onCommit: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-meta text-muted">{axis}</span>
      <NumberStepper label={`Posisi ${axis}`} value={value} min={-200} max={200} step={1} suffix="%" onCommit={onCommit} className="w-[84px]" />
    </div>
  );
}

function IconToggle({ label, on, onClick, children }: { label: string; on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      title={label}
      className={`flex size-8 items-center justify-center rounded-[8px] transition-colors ${
        on ? "bg-secondary/15 text-secondary ring-1 ring-secondary/40" : "bg-panel-3/60 text-fg/75 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- Speed */

const SPEED_PRESETS = [0.5, 1, 1.5, 2, 3];

function SpeedTab({ clip }: { clip: Clip }) {
  const dispatch = useEditor((s) => s.dispatch);
  const speed = clip.speed ?? 1;
  const sourceSpan = clip.duration * speed;
  const setSpeed = (s: number): EditCommand => ({ type: "setSpeed", clipId: clip.id, speed: s });

  return (
    <>
      <Section title="Kecepatan" icon={Gauge}>
        <SliderField
          label="Kecepatan"
          value={speed}
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={0.05}
          decimals={2}
          suffix="x"
          ticks={[1, 2, 3]}
          toCommand={setSpeed}
        />
        <div className="flex flex-wrap gap-1.5">
          {SPEED_PRESETS.map((s) => (
            <button
              key={s}
              onClick={() => dispatch([setSpeed(s)])}
              className={`h-7 rounded-full px-3 font-mono text-xs transition-colors ${
                Math.abs(s - speed) < 0.001 ? "border border-secondary bg-secondary/10 text-fg" : "border border-line text-muted hover:text-fg"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </Section>
      <Section title="Durasi" icon={Timer}>
        {/* Source length on the left, resulting timeline length on the right (editable). */}
        <div className="flex items-center gap-3">
          <span className="w-12 font-mono text-xs text-muted">{sourceSpan.toFixed(1)}s</span>
          <div className="flex flex-1 items-center text-white/25">
            <span className="h-px flex-1 border-t border-dashed border-current" />
            <ArrowRight className="size-3.5" />
          </div>
          <NumberStepper
            label="Durasi"
            value={clip.duration}
            min={0.2}
            max={600}
            step={0.1}
            decimals={1}
            suffix="s"
            onCommit={(d) => dispatch([setSpeed(sourceSpan / d)])}
          />
        </div>
        <p className="text-meta leading-relaxed text-muted">
          Durasi mengubah kecepatan; potongan sumbernya tetap.
        </p>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------- Animation */

const IN_PRESETS: { id: Transition; label: string }[] = [
  { id: "none", label: "Tidak ada" },
  { id: "fade", label: "Fade" },
  { id: "slide", label: "Geser" },
  { id: "slide-up", label: "Naik" },
  { id: "zoom", label: "Zoom" },
  { id: "pop", label: "Pop" },
  { id: "blur", label: "Blur" },
  { id: "flash", label: "Flash" },
];
const OUT_PRESETS: { id: TransitionOut; label: string }[] = [
  { id: "none", label: "Tidak ada" },
  { id: "fade", label: "Fade" },
  { id: "slide", label: "Geser" },
  { id: "slide-down", label: "Turun" },
  { id: "zoom", label: "Zoom" },
  { id: "blur", label: "Blur" },
];

function AnimationTab({ clip }: { clip: Clip }) {
  const dispatch = useEditor((s) => s.dispatch);
  const [dir, setDir] = useState<"in" | "out">("in");
  const isIn = dir === "in";
  const active = (isIn ? clip.transitionIn : clip.transitionOut) ?? "none";
  const duration = (isIn ? clip.transitionInDuration : clip.transitionOutDuration) ?? DEFAULT_ANIM_DURATION;
  const presets = isIn ? IN_PRESETS : OUT_PRESETS;

  return (
    <Section title="Animasi" icon={Clapperboard}>
      <Segmented
        options={[
          { id: "in", label: "Masuk" },
          { id: "out", label: "Keluar" },
        ]}
        value={dir}
        onChange={setDir}
      />
      <div className="grid grid-cols-4 gap-1.5">
        {presets.map((p) => {
          const on = p.id === active;
          return (
            <button
              key={p.id}
              onClick={() => dispatch([props(clip.id, isIn ? { transitionIn: p.id as Transition } : { transitionOut: p.id as TransitionOut })])}
              className={`flex flex-col items-center gap-1.5 rounded-[10px] py-2.5 text-meta transition-colors ${
                on ? "bg-secondary/10 text-fg ring-1 ring-secondary" : "bg-panel-3/40 text-muted hover:text-fg"
              }`}
            >
              <AnimGlyph id={p.id} out={!isIn} />
              {p.label}
            </button>
          );
        })}
      </div>
      {active !== "none" && (
        <SliderField
          label="Durasi animasi"
          value={Math.round(duration * 10) / 10}
          min={0.1}
          max={Math.max(0.2, Math.min(3, clip.duration))}
          step={0.1}
          decimals={1}
          suffix="s"
          toCommand={(v) => props(clip.id, isIn ? { transitionInDuration: v } : { transitionOutDuration: v })}
        />
      )}
    </Section>
  );
}

/** Tiny pictogram for each animation preset. */
function AnimGlyph({ id, out }: { id: string; out: boolean }) {
  const box = "absolute inset-1.5 rounded-[3px] bg-current";
  const glyph: Record<string, React.ReactNode> = {
    none: <span className="absolute inset-1.5 rounded-[3px] border border-dashed border-current" />,
    fade: <span className={`${box} opacity-40`} />,
    slide: <span className={box} style={{ translate: out ? "-35% 0" : "35% 0", opacity: 0.8 }} />,
    "slide-up": <span className={box} style={{ translate: "0 30%", opacity: 0.8 }} />,
    "slide-down": <span className={box} style={{ translate: "0 30%", opacity: 0.8 }} />,
    zoom: <span className={box} style={{ scale: out ? "0.7" : "1.15", opacity: 0.8 }} />,
    pop: <span className={box} style={{ scale: "0.75" }} />,
    blur: <span className={box} style={{ filter: "blur(2px)", opacity: 0.8 }} />,
    flash: <span className={`${box} bg-white`} />,
  };
  return <span className="relative block size-7 overflow-hidden rounded-[6px] bg-black/30">{glyph[id]}</span>;
}

/* ---------------------------------------------------------------- Adjust */

function AdjustTab({ clip, onReset }: { clip: Clip; onReset: () => void }) {
  const adj = { ...DEFAULT_ADJUST, ...clip.adjust };
  const field = (key: keyof typeof adj, label: string, min: number, max: number, suffix = "") => (
    <SliderField
      key={key}
      label={label}
      value={adj[key]}
      min={min}
      max={max}
      suffix={suffix}
      ticks={min < 0 ? [0] : undefined}
      keyframe={{ clip, prop: key }}
      toCommand={(v) => props(clip.id, { adjust: { [key]: v } })}
    />
  );
  return (
    <Section title="Warna" icon={Palette} onReset={onReset} keyframe={{ clip, props: ADJUST_PROPS }}>
      {field("brightness", "Kecerahan", -100, 100)}
      {field("contrast", "Kontras", -100, 100)}
      {field("saturation", "Saturasi", -100, 100)}
      {field("hue", "Hue", -180, 180, "°")}
      {field("blur", "Blur", 0, 20, "px")}
    </Section>
  );
}

/* ----------------------------------------------------------------- Audio */

function AudioTab({ clip, asset }: { clip: Clip; asset?: Asset }) {
  const dispatch = useEditor((s) => s.dispatch);
  const volume = Math.round((clip.volume ?? 1) * 100);
  const maxFade = Math.max(0.1, Math.min(5, clip.duration / 2));
  return (
    <>
      <Section title="Volume" icon={Volume2}>
        <SliderField label="Volume" value={volume} min={0} max={100} suffix="%" keyframe={{ clip, prop: "volume", scale: 100 }} toCommand={(v) => props(clip.id, { volume: v / 100 })} />
        <ToggleRow label="Bisukan clip" on={volume === 0} onChange={(on) => dispatch([props(clip.id, { volume: on ? 0 : 1 })])} />
      </Section>
      <Section title="Fade" icon={AudioWaveform}>
        <SliderField
          label="Fade in"
          value={clip.fadeIn ?? 0}
          min={0}
          max={maxFade}
          step={0.1}
          decimals={1}
          suffix="s"
          toCommand={(v) => props(clip.id, { fadeIn: v })}
        />
        <SliderField
          label="Fade out"
          value={clip.fadeOut ?? 0}
          min={0}
          max={maxFade}
          step={0.1}
          decimals={1}
          suffix="s"
          toCommand={(v) => props(clip.id, { fadeOut: v })}
        />
      </Section>
      {asset?.src && (asset.kind === "video" || asset.kind === "audio") && <SilenceSection clip={clip} src={asset.src} />}
    </>
  );
}

const SENSITIVITY = [
  { id: "low", label: "Rendah", db: -45 },
  { id: "medium", label: "Sedang", db: -38 },
  { id: "high", label: "Tinggi", db: -30 },
] as const;

/** Detect pauses in the clip's audio (Web Audio, no upload) and cut them out. */
function SilenceSection({ clip, src }: { clip: Clip; src: string }) {
  const [sensitivity, setSensitivity] = useState<(typeof SENSITIVITY)[number]["id"]>("medium");
  const [minSilence, setMinSilence] = useState(0.5);
  const [state, setState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });

  const run = async () => {
    setState({ busy: true, message: null });
    try {
      const buffer = await decodeAudio(src);
      const speed = clip.speed ?? 1;
      const from = clip.offset;
      const to = Math.min(buffer.duration, clip.offset + clip.duration * speed);
      const db = SENSITIVITY.find((s) => s.id === sensitivity)!.db;
      const speech = await findSpeech(buffer, from, to, { thresholdDb: db, minSilence, padding: 0.12 });
      if (speech.length === 0) {
        setState({ busy: false, message: "Seluruh clip terdeteksi sunyi. Turunkan sensitivitas, lalu coba lagi." });
        return;
      }
      const { commands, removed, pieces } = silenceCommands(useEditor.getState().project, clip, speech);
      if (removed < 0.05) {
        setState({ busy: false, message: "Tidak ada jeda yang cukup panjang untuk dipotong." });
        return;
      }
      useEditor.getState().dispatch(commands);
      // This clip no longer exists: keep the user on the first piece and report through the app toast.
      const first = commands.find((c) => c.type === "insertClip");
      if (first?.type === "insertClip" && first.id) useEditor.getState().select(first.id);
      toast(`Jeda dipotong: ${pieces} bagian bicara dipertahankan, durasi berkurang ${removed.toFixed(1)} detik. Tekan Undo kalau terlalu banyak.`);
    } catch (e) {
      setState({ busy: false, message: `Audio clip tidak bisa dianalisis (${e instanceof Error ? e.message : "format tidak didukung"}). Coba file MP4 atau WAV.` });
    }
  };

  return (
    <Section title="Potong jeda" icon={Scissors}>
      <div className="space-y-2">
        <FieldLabel>Sensitivitas</FieldLabel>
        <Segmented options={SENSITIVITY.map(({ id, label }) => ({ id, label }))} value={sensitivity} onChange={setSensitivity} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>Jeda minimal</FieldLabel>
        <NumberStepper label="Jeda minimal" value={minSilence} min={0.2} max={3} step={0.1} decimals={1} suffix="s" onCommit={setMinSilence} />
      </div>
      <button
        onClick={run}
        disabled={state.busy}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-[10px] bg-panel-3 text-xs font-medium text-fg transition-colors hover:bg-line disabled:opacity-60"
      >
        {state.busy ? <Loader2 className="size-3.5 animate-spin" /> : <AudioLines className="size-3.5" />}
        {state.busy ? "Menganalisis audio…" : "Potong jeda"}
      </button>
      {state.message && (
        <p role="status" className="text-meta leading-relaxed text-fg/80">
          {state.message}
        </p>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ Text */

const CAPTION_STYLES: { id: CaptionStyle; label: string }[] = [
  { id: "bold", label: "Bold" },
  { id: "boxed", label: "Boxed" },
  { id: "karaoke", label: "Karaoke" },
];
const CAPTION_COLORS = ["#ffffff", "#ffe14d", "#ff7a1a", "#6ea8fe", "#111111"];

function TextTab({ clip }: { clip: Clip }) {
  const dispatch = useEditor((s) => s.dispatch);
  const color = clip.captionColor ?? "#ffffff";
  return (
    <>
      <Section title="Teks" icon={Type}>
        <textarea
          key={clip.id}
          defaultValue={clip.text}
          rows={3}
          onBlur={(e) => e.target.value !== clip.text && dispatch([props(clip.id, { text: e.target.value })])}
          className="w-full resize-none rounded-[10px] bg-panel-3/60 px-3 py-2 outline-none focus:ring-1 focus:ring-secondary/60"
          aria-label="Teks caption"
        />
        <Chips options={CAPTION_STYLES} value={clip.captionStyle ?? "bold"} onChange={(s) => dispatch([props(clip.id, { captionStyle: s })])} />
      </Section>
      <Section title="Gaya" icon={Brush}>
        <SliderField
          label="Ukuran"
          value={Math.round((clip.captionSize ?? 1) * 100)}
          min={50}
          max={200}
          suffix="%"
          ticks={[100]}
          toCommand={(v) => props(clip.id, { captionSize: v / 100 })}
        />
        <SliderField
          label="Posisi vertikal"
          value={Math.round(clip.captionY ?? CAPTION_DEFAULT_Y)}
          min={4}
          max={90}
          suffix="%"
          toCommand={(v) => props(clip.id, { captionY: v })}
        />
        <div className="flex items-center justify-between">
          <FieldLabel>Warna</FieldLabel>
          <div className="flex items-center gap-1.5">
            {CAPTION_COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Warna ${c}`}
                onClick={() => dispatch([props(clip.id, { captionColor: c })])}
                className={`size-6 rounded-full ring-offset-2 ring-offset-panel ${color === c ? "ring-2 ring-secondary" : "ring-1 ring-ink/15"}`}
                style={{ background: c }}
              />
            ))}
            <input
              type="color"
              value={color}
              aria-label="Warna lain"
              onChange={(e) => dispatch([props(clip.id, { captionColor: e.target.value })])}
              className="size-6 cursor-pointer rounded-full bg-transparent"
            />
          </div>
        </div>
      </Section>
    </>
  );
}

/* ---------------------------------------------------------------- Motion */

function MotionTab({ clip }: { clip: Clip }) {
  const dispatch = useEditor((s) => s.dispatch);
  if (!clip.motion) return null;
  const meta = MOTION_TEMPLATES.find((t) => t.id === clip.motion!.template);
  const set = (key: string, value: string | number) => dispatch([{ type: "setMotionProps", clipId: clip.id, props: { [key]: value } }]);
  return (
    <>
    <Section title={meta?.name ?? "Motion"} icon={Wand2}>
      {Object.entries(clip.motion.props).map(([key, value]) =>
        typeof value === "number" ? (
          <SliderField
            key={key}
            label={key === "amount" ? "Kekuatan zoom" : key === "x" ? "Posisi X" : key === "y" ? "Posisi Y" : key}
            value={Math.round(value * 100)}
            min={key === "amount" ? 100 : 0}
            max={key === "amount" ? 160 : 100}
            suffix="%"
            toCommand={(v) => ({ type: "setMotionProps", clipId: clip.id, props: { [key]: v / 100 } })}
          />
        ) : typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? (
          <div key={key} className="flex items-center justify-between">
            <FieldLabel>{key === "accent" || key === "color" ? "Warna" : key}</FieldLabel>
            <span className="flex items-center gap-2 font-mono text-meta text-muted">
              {value}
              <input type="color" value={value} onChange={(e) => set(key, e.target.value)} className="size-7 cursor-pointer rounded-md bg-transparent" />
            </span>
          </div>
        ) : typeof value === "string" ? (
          <label key={key} className="block space-y-1.5">
            <FieldLabel>{key === "text" ? "Teks" : key === "title" ? "Judul" : key === "subtitle" ? "Subjudul" : key}</FieldLabel>
            <input
              key={`${clip.id}-${key}`}
              defaultValue={value}
              onBlur={(e) => e.target.value !== value && set(key, e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="h-9 w-full rounded-[10px] bg-panel-3/60 px-3 outline-none focus:ring-1 focus:ring-secondary/60"
            />
          </label>
        ) : null,
      )}
    </Section>
    <BlendSection clip={clip} />
    </>
  );
}

const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: "normal", label: "Default" },
  { id: "multiply", label: "Multiply" },
  { id: "screen", label: "Screen" },
  { id: "overlay", label: "Overlay" },
  { id: "darken", label: "Darken" },
  { id: "lighten", label: "Lighten" },
  { id: "color-dodge", label: "Color dodge" },
  { id: "color-burn", label: "Color burn" },
  { id: "soft-light", label: "Soft light" },
  { id: "hard-light", label: "Hard light" },
  { id: "difference", label: "Difference" },
  { id: "exclusion", label: "Exclusion" },
];

/** Blend: how this clip mixes with the tracks below it, plus its opacity. */
function BlendSection({ clip }: { clip: Clip }) {
  const dispatch = useEditor((s) => s.dispatch);
  const tf = { ...DEFAULT_TRANSFORM, ...clip.transform };
  const set = (patch: Partial<typeof tf>) => dispatch([props(clip.id, { transform: patch })]);
  return (
    <Section
      title="Blend"
      icon={Layers}
      onReset={() => set({ blendMode: "normal", opacity: 1 })}
    >
      <div className="flex items-center justify-between gap-3">
        <FieldLabel>Mode</FieldLabel>
        <label className="relative w-[170px]">
          <select
            value={tf.blendMode}
            onChange={(e) => set({ blendMode: e.target.value as BlendMode })}
            aria-label="Mode blend"
            className="h-8 w-full appearance-none rounded-[8px] bg-panel-3/70 pr-8 pl-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-secondary lg:text-xs"
          >
            {BLEND_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted" />
        </label>
      </div>
      <SliderField
        label="Opasitas"
        value={Math.round(tf.opacity * 100)}
        min={0}
        max={100}
        suffix="%"
        keyframe={{ clip, prop: "opacity", scale: 100 }}
        toCommand={(v) => props(clip.id, { transform: { opacity: v / 100 } })}
      />
      {tf.blendMode !== "normal" && (
        <p className="text-meta leading-relaxed text-muted">Mode blend tampil di preview. Ekspor di browser belum mendukung blend; opasitas tetap ikut.</p>
      )}
    </Section>
  );
}
