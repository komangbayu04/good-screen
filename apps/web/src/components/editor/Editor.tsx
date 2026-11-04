"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, CloudOff, Loader2, Upload } from "lucide-react";
import { projectDuration, useEditor } from "@goodscreen/editor-core";
import { importFiles, importScreenTake } from "@/lib/import";
import { useToast } from "@/lib/toast";
import { restoreSession, startAutosave, useSaveStatus } from "@/lib/persistence";
import { usePersistentState } from "@/lib/persist";
import { BottomSheet } from "./BottomSheet";
import { ExportDialog } from "./ExportDialog";
import { FloatingControls } from "./FloatingControls";
import { useRecorder } from "@/lib/recorder";
import { trackCursor } from "@/lib/cursor-track";
import { createDetector } from "@/lib/cursor-detect";
import { addText, useTools } from "@/lib/tools";
import { seek, togglePlay } from "@/lib/player-bridge";
import { PlayerControls, Preview } from "./Preview";
import { RightPanel } from "./RightPanel";
import { Timeline } from "./Timeline";
import { EditToolbar } from "./EditToolbar";
import { MobileTray } from "./MobileTray";
import { ToolRail } from "./ToolRail";
import { setWorkspace, useWorkspace } from "@/lib/workspace";
import { RecordPanel } from "./RecordPanel";
import { ProjectSwitcher, openProjectSwitcher } from "./ProjectSwitcher";
import { LibraryContent, type LibraryMenu } from "./Library";

type Sheet = { kind: "library"; menu: LibraryMenu } | { kind: "right" } | null;

export function Editor() {
  const mode = useWorkspace((s) => s.mode);
  const [timelineH, setTimelineH] = usePersistentState("goodscreen.timelineHeight", TIMELINE_DEFAULT);
  const [panelW, setPanelW] = usePersistentState("goodscreen.rightPanelWidth", PANEL_DEFAULT);
  const [mobileTimelineH, setMobileTimelineH] = usePersistentState("goodscreen.timelineHeightMobile", MOBILE_TIMELINE_DEFAULT);

  const [dragging, setDragging] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const toastMessage = useToast((s) => s.message);
  const setToast = (m: string | null) => (m ? useToast.getState().show(m) : useToast.getState().clear());
  const [exportOpen, setExportOpen] = useState(false);
  // Lives here, not in the Record panel, so switching menus never closes it mid-take.
  const floatingControls = useRecorder((s) => s.floating);
  const lastSheet = useRef<Sheet>(null);
  if (sheet) lastSheet.current = sheet;
  const shownSheet = sheet ?? lastSheet.current;
  const desktop = useIsDesktop();
  const recStatus = useRecorder((s) => s.status);
  const prevRec = useRef(recStatus);

  // A finished take lands on the timeline: go straight to editing it.
  useEffect(() => {
    if (prevRec.current === "saving" && recStatus === "idle" && useWorkspace.getState().mode === "record") setWorkspace("edit");
    prevRec.current = recStatus;
  }, [recStatus]);

  const onDropFiles = async (files: FileList) => {
    const { errors } = await importFiles(files);
    if (errors.length) setToast(`Couldn't upload ${errors.join(", ")}. Use a video, audio or image file, then try again.`);
  };

  // Restore the last session first, then start autosaving (so an empty editor never overwrites it).
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    // Autosave only starts once the saved session is safely loaded (or there is none):
    // saving after a failed restore would overwrite the user's projects with an empty one.
    restoreSession()
      .then(() => {
        if (!cancelled) stop = startAutosave();
      })
      .catch((e) => {
        console.error("[persistence] restore failed", e);
        useToast.getState().show("Your saved projects couldn't be loaded. Reload the page; new changes aren't saved until this works.");
        useSaveStatus.setState({ status: "error" });
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  // Dev hook so automated checks can import generated media.
  useEffect(() => {
    if (process.env.NODE_ENV === "development") (window as unknown as { __goodscreen: unknown }).__goodscreen = { importFiles, importScreenTake, trackCursor, createDetector, useEditor, useRecorder };
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Key events sent to the window or document (extensions, scripts) have no element target.
      const el = e.target instanceof Element ? (e.target as HTMLElement) : document.body;
      // Text fields keep their own keys (incl. native undo); sliders and toggles don't.
      const typing = el.closest("textarea, select, [contenteditable='true']") || (el instanceof HTMLInputElement && !["range", "checkbox", "radio", "button", "color"].includes(el.type));
      if (typing) return;
      const isUndoKey = (e.metaKey || e.ctrlKey) && ["z", "y"].includes(e.key.toLowerCase());
      if (el instanceof HTMLInputElement && !isUndoKey) return;
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !el.closest('[role="tablist"]')) {
        // Playhead by one frame (Shift: one second); the keyboard twin of scrubbing the ruler.
        e.preventDefault();
        seek(s.playhead + (e.shiftKey ? 1 : 1 / s.project.fps) * (e.key === "ArrowLeft" ? -1 : 1));
      } else if (e.key === "Home") {
        e.preventDefault();
        seek(0);
      } else if (e.key === "End") {
        e.preventDefault();
        seek(projectDuration(s.project));
      } else if (e.key === "v" && !mod) useTools.getState().setMove(!useTools.getState().move);
      else if (e.key === "t" && !mod && useWorkspace.getState().mode === "edit") {
        e.preventDefault();
        addText();
      } else if (e.key === "s" && !mod) s.splitAtPlayhead();
      else if (e.key === "Delete" || e.key === "Backspace") s.deleteSelected();
      else if (e.key === "Escape") s.select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    // Long results need time to read: ~60ms per character, at least 3.2s.
    const id = setTimeout(() => useToast.getState().clear(), Math.max(3200, toastMessage.length * 60));
    return () => clearTimeout(id);
  }, [toastMessage]);

  const openRecord = () => {
    if (!desktop) return setSheet({ kind: "library", menu: "record" });
    setWorkspace("record");
  };

  const openProjects = () => {
    if (!desktop) return setSheet({ kind: "library", menu: "project" });
    openProjectSwitcher();
  };

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden pt-[env(safe-area-inset-top)]"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onDropFiles(e.dataTransfer.files);
      }}
    >
      <Header
        desktop={desktop === true}
        onProjects={openProjects}
        onExport={() => setExportOpen(true)}
      />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      {floatingControls && <FloatingControls onClose={() => useRecorder.getState().setFloating(false)} />}

      {/* Only one layout is mounted so there is a single Remotion Player. */}
      {desktop === true && (
        <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
          <main className="flex min-w-0 flex-1 flex-col">
            {/* Record (from the tool rail) swaps the main area for the recorder until it is closed or a take lands. */}
            {mode === "record" ? (
              <RecordWorkspace />
            ) : (
              <>
            {/* Tools sit beside the preview only, so the timeline below keeps its full width. */}
            <div className="flex min-h-[180px] flex-1 gap-2">
              <div className="min-w-0 flex-1">
                <Preview />
              </div>
              <ToolRail onRecord={openRecord} />
            </div>
            {/* Transport spans preview and tools, so its divider runs the full width. */}
            <PlayerControls />
            <ResizeHandle height={timelineH} onChange={setTimelineH} />
            <section className="surface flex shrink-0 flex-col overflow-hidden" style={{ height: timelineH }}>
              <EditToolbar />
              <Timeline />
            </section>
              </>
            )}
          </main>
          {/* Right card: settings of the selected clip or the active tool. */}
          <SideResizeHandle width={panelW} onChange={setPanelW} />
          <aside className="surface shrink-0 overflow-hidden" style={{ width: panelW }}>
            <RightPanel onRecord={openRecord} />
          </aside>
        </div>
      )}

      {desktop === false && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <Preview
              mobile={{ onOpenMenu: () => setSheet({ kind: "library", menu: "project" }) }}
            />
          </div>
          {/* One continuous surface down to the screen edge: no gaps between tools. */}
          <section className="frost flex shrink-0 flex-col rounded-t-[22px] bg-panel pb-[env(safe-area-inset-bottom)] shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]">
            <ResizeHandle
              height={mobileTimelineH}
              onChange={setMobileTimelineH}
              fallback={MOBILE_TIMELINE_DEFAULT}
              limits={() => ({ min: 120, max: Math.round(window.innerHeight * 0.5) })}
              className="group flex h-5 shrink-0 cursor-row-resize touch-none items-center justify-center outline-none"
            />
            <EditToolbar mobile />
            <div className="flex min-h-0 flex-col" style={{ height: mobileTimelineH }}>
              <Timeline />
            </div>
            <MobileTray
              onOpen={(target) => {
                if (target === "text") {
                  // Phones type in the Text tab of the sheet instead of on the stage.
                  addText({ typeOnCanvas: false });
                  setSheet({ kind: "right" });
                } else if (target === "edit") setSheet({ kind: "right" });
                else setSheet({ kind: "library", menu: target });
              }}
            />
          </section>
        </div>
      )}

      {/* Mobile bottom sheet: keeps its last content while sliding out (same path in and out). */}
      {desktop === false && (
        <BottomSheet open={!!sheet} onClose={() => setSheet(null)}>
          {shownSheet?.kind === "library" && <LibraryContent key={shownSheet.menu} menu={shownSheet.menu} onPicked={() => setSheet(null)} />}
          {shownSheet?.kind === "right" && <RightPanel />}
        </BottomSheet>
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-50 flex flex-col items-center justify-center gap-2 rounded-[26px] border-2 border-dashed border-secondary bg-black/70">
          <Upload className="size-6 text-secondary" />
          <p className="text-lg font-semibold">Drop to add to the timeline</p>
        </div>
      )}

      <div role="status" aria-live="polite" className="contents">
        {toastMessage && (
        <div
          className="motion-slide fixed bottom-24 left-1/2 z-50 w-[calc(100%-32px)] max-w-md -translate-x-1/2 frost rounded-2xl border border-line bg-panel px-4 py-3 text-sm shadow-2xl transition-[translate,opacity] duration-250 ease-[var(--ease-out)] starting:translate-y-3 starting:opacity-0 lg:bottom-6"
        >
          {toastMessage}
        </div>
        )}
      </div>
    </div>
  );
}

function Header({ desktop, onProjects, onExport }: { desktop: boolean; onProjects: () => void; onExport: () => void }) {
  const name = useEditor((s) => s.project.name);
  return (
    // The project is the header's anchor on the left; the one action (Export) sits on the right.
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 bg-black/30 px-3 lg:h-16 lg:bg-transparent lg:px-4">
      <div className="flex min-w-0 items-center gap-2">
        {/* Projects sit above the workspaces: switch, filter by tag, or start a new one. */}
        {desktop ? (
          <ProjectSwitcher />
        ) : (
          <button onClick={onProjects} className="flex min-w-0 items-center gap-1 rounded-full px-3 py-1.5 text-ui transition-colors hover:bg-panel-2">
            <span className="max-w-[160px] truncate" title={name}>
              {name}
            </span>
            <ChevronDown className="size-3.5 text-muted" />
          </button>
        )}
        <SaveIndicator />
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onExport}
          className="bg-accent-grad flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-on-accent"
        >
          <Upload className="size-4" /> Export
        </button>
      </div>
    </header>
  );
}

/** Autosave state, in words as well as an icon. */
function SaveIndicator() {
  const status = useSaveStatus((s) => s.status);
  if (status === "idle") return null;
  const label = status === "saving" ? "Saving…" : status === "error" ? "Couldn't save" : "Saved";
  return (
    <span role="status" className={`hidden items-center gap-1 text-meta lg:flex ${status === "error" ? "text-red-400" : "text-muted"}`}>
      {status === "saving" ? <Loader2 className="size-3 animate-spin" /> : status === "error" ? <CloudOff className="size-3" /> : <Check className="size-3" />}
      {label}
    </span>
  );
}

const TIMELINE_DEFAULT = 300;
const MOBILE_TIMELINE_DEFAULT = 208;
const TIMELINE_MIN = 190;
const PREVIEW_MIN = 180;

/** Drag to trade height between preview and timeline; double-click resets. */
function ResizeHandle({
  height,
  onChange,
  limits,
  fallback = TIMELINE_DEFAULT,
  className = "group flex h-3 shrink-0 cursor-row-resize items-center justify-center outline-none",
}: {
  height: number;
  onChange: (h: number) => void;
  /** Override the min/max (default: keep the preview at least PREVIEW_MIN tall). */
  limits?: () => { min: number; max: number };
  fallback?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const clamp = (h: number) => {
    if (limits) {
      const { min, max } = limits();
      return Math.round(Math.min(max, Math.max(min, h)));
    }
    const main = ref.current?.parentElement?.clientHeight ?? 800;
    return Math.round(Math.min(main - PREVIEW_MIN - 12, Math.max(TIMELINE_MIN, h)));
  };
  // Keep the stored height valid when the window gets smaller.
  useEffect(() => {
    const fit = () => onChange(clamp(height));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize timeline"
      aria-valuenow={height}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        const y0 = e.clientY;
        const h0 = height;
        document.body.style.cursor = "row-resize";
        const move = (ev: PointerEvent) => onChange(clamp(h0 + (y0 - ev.clientY)));
        const up = () => {
          document.body.style.cursor = "";
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      onDoubleClick={() => onChange(clamp(fallback))}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp") onChange(clamp(height + 24));
        if (e.key === "ArrowDown") onChange(clamp(height - 24));
      }}
      className={className}
    >
      <span className="h-1 w-10 rounded-full bg-line transition-colors group-hover:bg-secondary group-focus-visible:bg-secondary group-active:bg-secondary" />
    </div>
  );
}

const PANEL_DEFAULT = 380;
const PANEL_MIN = 320;
const PANEL_MAX = 640;
const MAIN_MIN = 420;

/** Vertical twin of ResizeHandle: drag to trade width between the editor and the right panel. */
function SideResizeHandle({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const clamp = (w: number) => {
    // Never squeeze the preview/timeline column below MAIN_MIN.
    const row = ref.current?.parentElement?.clientWidth ?? 1440;
    const others = [...(ref.current?.parentElement?.children ?? [])]
      .filter((el) => el.tagName !== "MAIN" && el !== ref.current && el.tagName !== "ASIDE")
      .reduce((sum, el) => sum + (el as HTMLElement).offsetWidth, 0);
    const max = Math.min(PANEL_MAX, row - others - MAIN_MIN - 36);
    return Math.round(Math.min(Math.max(PANEL_MIN, max), Math.max(PANEL_MIN, w)));
  };
  useEffect(() => {
    const fit = () => onChange(clamp(width));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize right panel"
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        const x0 = e.clientX;
        const w0 = width;
        document.body.style.cursor = "col-resize";
        const move = (ev: PointerEvent) => onChange(clamp(w0 + (x0 - ev.clientX)));
        const up = () => {
          document.body.style.cursor = "";
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      onDoubleClick={() => onChange(clamp(PANEL_DEFAULT))}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(clamp(width + 24));
        if (e.key === "ArrowRight") onChange(clamp(width - 24));
      }}
      // Sits inside the flex gap: negative margins cancel the extra gap it would add.
      className="group -mx-3 flex w-3 shrink-0 cursor-col-resize items-center justify-center outline-none"
    >
      <span className="h-10 w-1 rounded-full bg-line transition-colors group-hover:bg-secondary group-focus-visible:bg-secondary group-active:bg-secondary" />
    </div>
  );
}

/** Recording as its own workspace: the recorder, centered and roomy, in the main area. */
function RecordWorkspace() {
  return (
    <div className="surface flex h-full min-h-0 justify-center overflow-hidden">
      <div className="h-full w-full max-w-[560px]">
        <RecordPanel onClose={() => setWorkspace("edit")} />
      </div>
    </div>
  );
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}
