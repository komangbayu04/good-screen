"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, History, Loader2, Monitor, Pause, PictureInPicture2, Play, Square, Trash2, X } from "lucide-react";
import { canRecordCamera, canRecordScreen, elapsedSeconds, useRecorder, type RecordSource } from "@/lib/recorder";
import { formatTime } from "@/lib/media";
import { usePersistentState } from "@/lib/persist";
import { PanelHeader } from "./PanelHeader";
import { ToggleRow, onTabListKeyDown } from "./controls";
import { canFloat } from "./FloatingControls";

const SOURCES: { id: RecordSource; label: string; icon: typeof Monitor; hint: string }[] = [
  { id: "screen", label: "Layar", icon: Monitor, hint: "Seluruh layar, satu jendela, atau tab browser" },
  { id: "camera", label: "Kamera", icon: Camera, hint: "Kamera depan, cocok untuk talking-head" },
];

/** Ticks while recording so timers stay live without re-rendering the whole editor. */
export function useElapsed() {
  const s = useRecorder();
  const [, force] = useState(0);
  useEffect(() => {
    if (s.status !== "recording") return;
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [s.status]);
  return elapsedSeconds(s);
}

/** Recorder: pick a source and options, see it live, one primary action per state. */
export function RecordPanel({ onClose }: { onClose?: () => void }) {
  const rec = useRecorder();
  const [source, setSource] = usePersistentState<RecordSource>("goodscreen.rec.source", "screen");
  const [camera, setCamera] = usePersistentState("goodscreen.rec.camera", true);
  const [mic, setMic] = usePersistentState("goodscreen.rec.mic", true);
  const [systemAudio, setSystemAudio] = usePersistentState("goodscreen.rec.system", true);
  const [countdown, setCountdown] = usePersistentState("goodscreen.rec.countdown", true);
  const [support, setSupport] = useState({ screen: true, camera: true });
  const floating = useRecorder((s) => s.floating);
  const setFloating = useRecorder((s) => s.setFloating);

  useEffect(() => {
    const s = { screen: canRecordScreen(), camera: canRecordCamera() };
    setSupport(s);
    if (!s.screen && s.camera) setSource("camera");
    void useRecorder.getState().scanRecoverable();
  }, [setSource]);

  const live = rec.status === "recording" || rec.status === "paused" || rec.status === "countdown";
  const shown = live && rec.source ? rec.source : source;
  const supported = support[shown];
  const meta = SOURCES.find((s) => s.id === shown)!;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Rekam">
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Tutup perekam"
            title="Kembali ke editor"
            className="flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-panel-3 hover:text-fg"
          >
            <X className="size-4" />
          </button>
        )}
      </PanelHeader>
      <div className="scroll-fade scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
        {rec.recoverable.map((t) => (
          <div key={t.id} role="alert" className="flex items-center gap-3 rounded-[12px] bg-secondary/10 px-3 py-2.5 ring-1 ring-secondary/30">
            <History className="size-4 shrink-0 text-secondary" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">Rekaman belum tersimpan</p>
              <p className="text-meta text-muted">
                {new Date(t.startedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} · ±{t.seconds} detik
                {t.hasCamera ? " · dengan kamera" : ""}
              </p>
            </div>
            <button onClick={() => rec.recover(t.id)} className="h-7 rounded-full bg-secondary px-3 text-xs font-medium text-on-secondary">
              Pulihkan
            </button>
            <button onClick={() => rec.discard(t.id)} aria-label="Buang rekaman" className="flex size-7 items-center justify-center rounded-full text-muted hover:text-fg">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}

        <div role="tablist" aria-label="Sumber rekaman" onKeyDown={onTabListKeyDown} className="grid grid-cols-2 gap-1 rounded-[10px] bg-panel-3/50 p-1">
          {SOURCES.map((s) => {
            const on = s.id === shown;
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                disabled={live}
                onClick={() => setSource(s.id)}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-[7px] text-xs transition-colors disabled:cursor-not-allowed ${
                  on ? "bg-panel-3 font-medium text-fg" : "text-muted hover:text-fg"
                }`}
              >
                <s.icon className="size-3.5" />
                {s.label}
              </button>
            );
          })}
        </div>

        <Stage source={shown} supported={supported} hint={meta.hint} />

        <div className="space-y-2.5 rounded-[12px] bg-panel-2/60 px-3 py-3" inert={live}>
          {shown === "screen" && <ToggleRow label="Rekam webcam juga" on={camera} onChange={setCamera} />}
          <ToggleRow label="Mikrofon (peredam bising)" on={mic} onChange={setMic} />
          {shown === "screen" && <ToggleRow label="Audio sistem / tab" on={systemAudio} onChange={setSystemAudio} />}
          <ToggleRow label="Hitung mundur 3 detik" on={countdown} onChange={setCountdown} />
        </div>

        {rec.status === "countdown" ? (
          <button onClick={rec.cancel} className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-panel-3 text-sm font-medium">
            <X className="size-4" /> Batalkan ({rec.countdown})
          </button>
        ) : rec.status === "recording" || rec.status === "paused" ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button
                onClick={rec.status === "paused" ? rec.resume : rec.pause}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-panel-3 text-sm font-medium transition-colors hover:bg-line"
              >
                {rec.status === "paused" ? <Play className="size-4 fill-current" /> : <Pause className="size-4 fill-current" />}
                {rec.status === "paused" ? "Lanjut" : "Jeda"}
              </button>
              <button onClick={rec.stop} className="flex h-10 flex-[1.4] items-center justify-center gap-2 rounded-full bg-red-600 text-sm font-semibold text-white hover:bg-red-700">
                <Square className="size-3.5 fill-current" /> Stop dan simpan
              </button>
            </div>
            {canFloat() && !floating && (
              <button
                onClick={() => setFloating(true)}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-full text-xs text-fg/80 ring-1 ring-line transition-colors hover:bg-panel-3"
              >
                <PictureInPicture2 className="size-3.5" /> Tampilkan kontrol melayang
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => rec.start({ source, camera: source === "screen" && camera, mic, systemAudio: source === "screen" && systemAudio, countdown: countdown ? 3 : 0 })}
            disabled={!supported || rec.status === "saving"}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-fg text-sm font-semibold text-bg transition-colors hover:bg-white disabled:opacity-40"
          >
            {rec.status === "saving" ? <Loader2 className="size-4 animate-spin" /> : <span className="size-2.5 rounded-full bg-red-600" aria-hidden="true" />}
            {rec.status === "saving" ? "Menyimpan rekaman…" : `Mulai rekam ${meta.label.toLowerCase()}`}
          </button>
        )}

        {rec.error && (
          <p role="alert" className="rounded-[10px] bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-300">
            {rec.error}
          </p>
        )}
        <p className="px-1 text-meta leading-relaxed text-muted">
          Rekaman disimpan tiap detik di perangkatmu, jadi tetap bisa dipulihkan kalau tab tertutup. Hasilnya langsung masuk ke timeline dengan latar dan bingkai.
        </p>
      </div>
    </div>
  );
}

function Stage({ source, supported, hint }: { source: RecordSource; supported: boolean; hint: string }) {
  const rec = useRecorder();
  const seconds = useElapsed();
  const screenRef = useRef<HTMLVideoElement>(null);
  const camRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (screenRef.current) screenRef.current.srcObject = rec.screenStream;
  }, [rec.screenStream]);
  useEffect(() => {
    if (camRef.current) camRef.current.srcObject = rec.cameraStream;
  }, [rec.cameraStream]);

  return (
    <div className="relative aspect-video overflow-hidden rounded-[12px] bg-black/40 ring-1 ring-ink/[0.06] ring-inset">
      {rec.screenStream ? (
        <>
          <video ref={screenRef} autoPlay muted playsInline className={`size-full object-contain ${rec.source === "camera" ? "-scale-x-100" : ""}`} />
          {rec.cameraStream && (
            <video ref={camRef} autoPlay muted playsInline className="absolute right-2 bottom-2 size-14 -scale-x-100 rounded-full object-cover ring-2 ring-white/80" />
          )}
          {rec.status === "countdown" ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55">
              <span key={rec.countdown} className="font-mono text-5xl font-semibold text-white tabular-nums">
                {rec.countdown}
              </span>
            </div>
          ) : (
            <span className="glass absolute top-2 left-2 flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-meta text-white tabular-nums">
              <span className={`size-2 rounded-full ${rec.status === "paused" ? "bg-amber-400" : "bg-red-500"}`} aria-hidden="true" />
              {rec.status === "paused" ? "JEDA" : "REC"} {formatTime(seconds)}
            </span>
          )}
        </>
      ) : rec.status === "saving" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <Loader2 className="size-5 animate-spin text-secondary" />
          <p className="text-meta text-muted">Menyimpan rekaman…</p>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
          {source === "screen" ? <ScreenGlyph /> : <CameraGlyph />}
          <p className="text-meta text-muted">{supported ? hint : "Tidak didukung di browser ini. Coba sumber lain."}</p>
        </div>
      )}
    </div>
  );
}

/** Line-art monitor with a cursor: reads as "screen" without a stock icon blown up. */
function ScreenGlyph() {
  return (
    <svg viewBox="0 0 72 48" className="h-12 w-[72px] text-white/55" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="6" y="3" width="60" height="34" rx="4" />
      <path d="M28 45h16M36 37v8" strokeLinecap="round" />
      <path d="M44 18l9 3.5-4 1.5-1.5 4z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Viewfinder corners around a head-and-shoulders silhouette. */
function CameraGlyph() {
  return (
    <svg viewBox="0 0 72 48" className="h-12 w-[72px] text-white/55" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M14 4H8a4 4 0 0 0-4 4v6M58 4h6a4 4 0 0 1 4 4v6M14 44H8a4 4 0 0 1-4-4v-6M58 44h6a4 4 0 0 0 4-4v-6" strokeLinecap="round" />
      <circle cx="36" cy="19" r="7" />
      <path d="M22 40c2-7 7.5-10 14-10s12 3 14 10" strokeLinecap="round" />
      <circle cx="61" cy="11" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
