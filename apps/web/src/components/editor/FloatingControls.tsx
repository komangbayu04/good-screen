"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pause, Play, Square } from "lucide-react";
import { useRecorder } from "@/lib/recorder";
import { formatTime } from "@/lib/media";
import { useElapsed } from "./RecordPanel";

type DocumentPip = { requestWindow: (o: { width: number; height: number }) => Promise<Window>; window: Window | null };
const pipApi = () => (typeof window !== "undefined" ? (window as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture : undefined);

/** Document Picture-in-Picture: Chrome/Edge 116+. */
export const canFloat = () => !!pipApi();

/** Copy the app's CSS into the PiP document so Tailwind classes render there too. */
function adoptStyles(target: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = target.createElement("style");
      style.textContent = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join("\n");
      target.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = target.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.head.appendChild(link);
      }
    }
  }
  target.documentElement.className = document.documentElement.className;
  target.body.className = "font-sans antialiased bg-bg text-fg";
}

/**
 * Always-on-top recording controls that stay visible while the user works in
 * another app or tab. Opening needs a click (browser rule), hence the button.
 */
export function FloatingControls({ onClose }: { onClose: () => void }) {
  const [win, setWin] = useState<Window | null>(null);

  useEffect(() => {
    let w: Window | null = null;
    let cancelled = false;
    pipApi()
      ?.requestWindow({ width: 300, height: 76 })
      .then((pip) => {
        if (cancelled) return pip.close();
        w = pip;
        adoptStyles(pip.document);
        pip.addEventListener("pagehide", onClose);
        setWin(pip);
      })
      .catch(onClose);
    return () => {
      cancelled = true;
      w?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!win) return null;
  return createPortal(<PipBar />, win.document.body);
}

function PipBar() {
  const rec = useRecorder();
  const seconds = useElapsed();
  const paused = rec.status === "paused";
  return (
    <div className="flex h-screen items-center gap-2 px-3">
      <span className={`size-2.5 shrink-0 rounded-full ${paused ? "bg-amber-400" : "bg-red-500"}`} aria-hidden="true" />
      <span className="flex-1 font-mono text-lg text-fg tabular-nums">
        {rec.status === "countdown" ? `Mulai dalam ${rec.countdown}` : formatTime(seconds)}
      </span>
      {rec.status !== "countdown" && (
        <button
          onClick={paused ? rec.resume : rec.pause}
          aria-label={paused ? "Lanjut" : "Jeda"}
          className="flex size-10 items-center justify-center rounded-full bg-panel-3 text-fg"
        >
          {paused ? <Play className="size-4 fill-current" /> : <Pause className="size-4 fill-current" />}
        </button>
      )}
      <button onClick={rec.stop} aria-label="Stop dan simpan" className="flex size-10 items-center justify-center rounded-full bg-red-600 text-white">
        <Square className="size-3.5 fill-current" />
      </button>
    </div>
  );
}
