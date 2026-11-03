import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { applyCommand, resolveKeyed, trackEnd, trackKindForAsset, type EditCommand } from "./commands";
import { createProject } from "./project";
import type { Asset, Author, Project } from "./types";

const HISTORY_LIMIT = 60;

export interface EditorState {
  project: Project;
  /** Other projects of this session (in memory until the projects API exists). */
  otherProjects: Project[];
  selectedClipId: string | null;
  /** Bumps on every select (even of the same clip) so panels can react to a click. */
  selectSeq: number;
  playhead: number; // seconds
  playing: boolean;
  pxPerSec: number;
  past: Project[];
  future: Project[];

  /** Adds an asset; by default it is also placed at the end of its track. */
  addAsset: (asset: Asset, opts?: { place?: boolean }) => void;
  updateAsset: (id: string, patch: Partial<Asset>) => void;
  removeAsset: (id: string) => void;
  /** Applies commands as ONE undoable step. */
  dispatch: (commands: EditCommand[], author?: Author) => void;
  /** Start of a drag gesture: snapshot once, then use `live` for each move. */
  beginGesture: () => void;
  live: (command: EditCommand) => void;
  undo: () => void;
  redo: () => void;
  select: (clipId: string | null) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setZoom: (pxPerSec: number) => void;
  toggleTrack: (trackId: string, key: "muted" | "hidden" | "locked") => void;
  splitAtPlayhead: () => void;
  deleteSelected: () => void;
  renameProject: (name: string) => void;
  /** Canvas frame (aspect ratio) and frame rate. Clip times are in seconds, so nothing else moves. */
  setFormat: (format: Partial<Pick<Project, "width" | "height" | "fps">>) => void;
  newProject: () => void;
  openProject: (id: string) => void;
}

export const useEditor = create<EditorState>()(
  immer((set, get) => {
    const snapshot = () =>
      set((s) => {
        s.past.push(get().project);
        if (s.past.length > HISTORY_LIMIT) s.past.shift();
        s.future = [];
      });

    const switchTo = (next: Project, current: Project) =>
      set((s) => {
        s.otherProjects = [current, ...s.otherProjects.filter((p) => p.id !== next.id && p.id !== current.id)];
        s.project = next;
        s.past = [];
        s.future = [];
        s.selectedClipId = null;
        s.playhead = 0;
        s.playing = false;
      });

    return {
      project: createProject(),
      otherProjects: [],
      selectedClipId: null,
      selectSeq: 0,
      playhead: 0,
      playing: false,
      pxPerSec: 40,
      past: [],
      future: [],

      addAsset: (asset, opts) => {
        snapshot();
        set((s) => {
          s.project.assets.push(asset);
          s.project.updatedAt = Date.now();
          if (opts?.place === false) return;
          const start = trackEnd(s.project, trackKindForAsset(asset));
          applyCommand(s.project, { type: "insertClip", assetId: asset.id, start }, asset.createdBy);
        });
      },
      updateAsset: (id, patch) =>
        set((s) => {
          const a = s.project.assets.find((a) => a.id === id);
          if (!a) return;
          Object.assign(a, patch);
          // Keep clips in sync once real metadata (duration) is known.
          if (patch.duration !== undefined)
            s.project.clips
              .filter((c) => c.assetId === id && c.duration > patch.duration! - c.offset)
              .forEach((c) => (c.duration = Math.max(0.2, patch.duration! - c.offset)));
        }),
      removeAsset: (id) => {
        snapshot();
        set((s) => {
          s.project.assets = s.project.assets.filter((a) => a.id !== id);
          s.project.clips = s.project.clips.filter((c) => c.assetId !== id);
        });
      },
      dispatch: (commands, author = "user") => {
        if (!commands.length) return;
        snapshot();
        set((s) => {
          for (const cmd of commands) for (const c of resolveKeyed(s.project, cmd, s.playhead)) applyCommand(s.project, c, author);
          s.project.updatedAt = Date.now();
          if (s.selectedClipId && !s.project.clips.some((c) => c.id === s.selectedClipId)) s.selectedClipId = null;
        });
      },
      beginGesture: snapshot,
      live: (command) =>
        set((s) => {
          for (const c of resolveKeyed(s.project, command, s.playhead)) applyCommand(s.project, c, "user");
        }),
      undo: () =>
        set((s) => {
          const prev = s.past.pop();
          if (!prev) return;
          s.future.push(get().project);
          s.project = prev;
        }),
      redo: () =>
        set((s) => {
          const next = s.future.pop();
          if (!next) return;
          s.past.push(get().project);
          s.project = next;
        }),
      select: (clipId) =>
        set((s) => {
          s.selectedClipId = clipId;
          s.selectSeq += 1;
        }),
      setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
      setPlaying: (playing) => set({ playing }),
      setZoom: (pxPerSec) => set({ pxPerSec: Math.min(200, Math.max(8, pxPerSec)) }),
      toggleTrack: (trackId, key) =>
        set((s) => {
          const t = s.project.tracks.find((t) => t.id === trackId);
          if (t) t[key] = !t[key];
        }),
      splitAtPlayhead: () => {
        const { project, playhead, selectedClipId } = get();
        const targets = project.clips.filter(
          (c) => (selectedClipId ? c.id === selectedClipId : true) && playhead > c.start && playhead < c.start + c.duration,
        );
        get().dispatch(targets.map((c) => ({ type: "splitClip", clipId: c.id, at: playhead })));
      },
      deleteSelected: () => {
        const id = get().selectedClipId;
        if (id) get().dispatch([{ type: "deleteClip", clipId: id }]);
      },
      setFormat: (format) => {
        snapshot();
        set((s) => {
          Object.assign(s.project, format);
        });
      },
      newProject: () => {
        const current = get().project;
        const n = get().otherProjects.length + 2;
        switchTo(createProject(`Recording ${n}`), current);
      },
      openProject: (id) => {
        const target = get().otherProjects.find((p) => p.id === id);
        if (target) switchTo(target, get().project);
      },
      renameProject: (name) =>
        set((s) => {
          s.project.name = name.trim() || "Untitled recording";
        }),
    };
  }),
);
