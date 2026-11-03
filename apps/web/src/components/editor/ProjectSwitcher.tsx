"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { Check, ChevronDown, Plus, Search, Video } from "lucide-react";
import { projectDuration, useEditor, type Project } from "@goodscreen/editor-core";
import { formatTime } from "@/lib/media";
import { setWorkspace } from "@/lib/workspace";

/** Open state lives here so the header, keyboard and other entry points share it. */
export const useProjectSwitcher = create<{ open: boolean }>(() => ({ open: false }));
export const openProjectSwitcher = () => useProjectSwitcher.setState({ open: true });

/** Header trigger: the project name; the browser opens beneath it. */
export function ProjectSwitcher() {
  const open = useProjectSwitcher((s) => s.open);
  const project = useEditor((s) => s.project);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && useProjectSwitcher.setState({ open: false });
    const esc = (e: KeyboardEvent) => e.key === "Escape" && useProjectSwitcher.setState({ open: false });
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => useProjectSwitcher.setState({ open: !open })}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex min-w-0 items-center gap-2 rounded-full py-1.5 pr-2.5 pl-3 text-ui transition-colors hover:bg-panel-2"
      >
        <span className="max-w-[160px] truncate font-medium sm:max-w-[260px]" title={project.name}>
          {project.name}
        </span>
        <ChevronDown className={`size-3.5 text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Projects"
          className="absolute top-full left-0 z-50 mt-2 w-[min(420px,calc(100vw-24px))] origin-top-left frost overflow-hidden rounded-[18px] border border-ink/[0.14] bg-panel shadow-2xl transition-[opacity,scale] duration-150 ease-out starting:scale-[0.97] starting:opacity-0"
        >
          <ProjectBrowser onDone={() => useProjectSwitcher.setState({ open: false })} />
        </div>
      )}
    </div>
  );
}

const ago = (t?: number) => {
  if (!t) return null;
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
};

/**
 * Every project, newest first and searchable; plus "New project", which opens the
 * recorder. Used in the header popover and the phone sheet.
 */
export function ProjectBrowser({ onDone }: { onDone?: () => void }) {
  const project = useEditor((s) => s.project);
  const others = useEditor((s) => s.otherProjects);
  const [q, setQ] = useState("");

  const all = useMemo(() => [project, ...[...others].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))], [project, others]);
  const shown = all.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));

  const open = (p: Project) => {
    if (p.id !== project.id) useEditor.getState().openProject(p.id);
    // An empty project goes to the recorder; one with clips to the editor.
    setWorkspace(p.clips.length ? "edit" : "record");
    onDone?.();
  };
  const start = () => {
    useEditor.getState().newProject();
    setWorkspace("record");
    onDone?.();
  };

  return (
    <div className="flex max-h-[min(560px,70vh)] flex-col">
      <div className="space-y-2 p-3 pb-2">
        <label className="flex h-9 items-center gap-2 rounded-[10px] bg-panel-2 px-3 ring-1 ring-ink/[0.06] focus-within:ring-secondary/60">
          <Search className="size-3.5 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            aria-label="Search projects"
            placeholder="Search projects"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted lg:text-ui"
          />
        </label>
      </div>

      <ul className="scroll-fade scrollbar-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2">
        {shown.length === 0 && <li className="px-3 py-6 text-center text-meta text-muted">No matching projects.</li>}
        {shown.map((p) => {
          const current = p.id === project.id;
          const thumb = p.assets.find((a) => a.thumbnail)?.thumbnail;
          return (
            <li key={p.id}>
              <button
                onClick={() => open(p)}
                aria-current={current ? "true" : undefined}
                className={`flex w-full items-center gap-3 rounded-[12px] p-2 text-left transition-colors ${current ? "bg-panel-2" : "hover:bg-panel-2"}`}
              >
                <span className="flex h-9 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-panel-3 outline-1 -outline-offset-1 outline-white/10">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="size-full object-cover" />
                  ) : (
                    <Video className="size-3.5 text-muted" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui font-medium">{p.name}</span>
                  <span className="block truncate text-meta text-muted">
                    {p.assets.length} file{p.assets.length === 1 ? "" : "s"} · {formatTime(projectDuration(p))}
                    {ago(p.updatedAt) && ` · ${ago(p.updatedAt)}`}
                  </span>
                </span>
                {current && <Check className="size-4 shrink-0 text-secondary" aria-label="Open now" />}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-ink/[0.06] p-2">
        <button
          onClick={start}
          className="flex h-10 w-full items-center justify-center gap-1.5 rounded-[10px] text-ui font-medium transition-colors hover:bg-panel-2"
        >
          <Plus className="size-4" /> New recording
        </button>
      </div>
    </div>
  );
}
