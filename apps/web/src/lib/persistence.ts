import { createStore as createIdbStore, delMany, get, set } from "idb-keyval";
import { create } from "zustand";
import { ensureTracks, useEditor, type Project } from "@goodscreen/editor-core";

/**
 * Local-first persistence: project JSON and the original media files live in
 * IndexedDB, so a refresh or a closed tab loses nothing. Swap for the projects
 * API + Blob storage when the backend exists; the shapes stay the same.
 */
// Created on first use: IndexedDB does not exist while the page is prerendered on the server.
let media: ReturnType<typeof createIdbStore> | undefined;
let state: ReturnType<typeof createIdbStore> | undefined;
const mediaDb = () => (media ??= createIdbStore("goodscreen-media", "blobs"));
const stateDb = () => (state ??= createIdbStore("goodscreen-state", "kv"));
const SESSION_KEY = "session-v1";

interface SavedSession {
  project: Project;
  otherProjects: Project[];
  savedAt: number;
}

export const useSaveStatus = create<{ status: "idle" | "saving" | "saved" | "error"; savedAt: number | null }>(() => ({
  status: "idle",
  savedAt: null,
}));

export async function saveMedia(assetId: string, blob: Blob) {
  try {
    await set(assetId, blob, mediaDb());
  } catch (e) {
    console.warn("[persistence] media not saved", e);
  }
}

/** Frees the stored originals of files the user deleted (only ever on their explicit request). */
export async function deleteMedia(assetIds: string[]) {
  try {
    await delMany(assetIds, mediaDb());
  } catch (e) {
    console.warn("[persistence] media not deleted", e);
  }
}

/** Object URLs die with the page: never persist them, re-create them on restore. */
function stripUrls(p: Project): Project {
  return { ...p, assets: p.assets.map(({ src: _src, ...a }) => a) };
}

async function rehydrate(p: Project): Promise<Project> {
  const assets = await Promise.all(
    p.assets.map(async (a) => {
      if (a.kind === "motion") return a;
      const blob = await get<Blob>(a.id, mediaDb()).catch(() => undefined);
      return blob ? { ...a, src: URL.createObjectURL(blob) } : a;
    }),
  );
  return ensureTracks({ ...p, assets });
}

/**
 * Loads the last session into the editor. Resolves false when nothing is saved yet;
 * THROWS when a saved session exists but can't be read, so the caller never starts
 * autosave over it (that would replace the user's work with an empty project).
 */
export async function restoreSession(): Promise<boolean> {
  const saved = await get<SavedSession>(SESSION_KEY, stateDb());
  if (!saved?.project) return false;

  const [project, ...otherProjects] = await Promise.all([saved.project, ...saved.otherProjects].map(rehydrate));
  useEditor.setState({
    project: project!,
    otherProjects,
    past: [],
    future: [],
    selectedClipId: null,
  });
  useSaveStatus.setState({ status: "saved", savedAt: saved.savedAt });
  // Media files are never deleted automatically: a session saved in a bad state must
  // not take the originals with it. Only an explicit delete (deleteMedia) frees them.
  return true;
}

/** Debounced autosave of the open project and the others. Returns an unsubscribe. */
export function startAutosave() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = async () => {
    const { project, otherProjects } = useEditor.getState();
    useSaveStatus.setState({ status: "saving" });
    try {
      const savedAt = Date.now();
      await set(
        SESSION_KEY,
        { project: stripUrls(project), otherProjects: otherProjects.map(stripUrls), savedAt } satisfies SavedSession,
        stateDb(),
      );
      useSaveStatus.setState({ status: "saved", savedAt });
    } catch (e) {
      console.warn("[persistence] session not saved", e);
      useSaveStatus.setState({ status: "error" });
    }
  };
  const unsubscribe = useEditor.subscribe((s, prev) => {
    if (s.project === prev.project && s.otherProjects === prev.otherProjects) return;
    clearTimeout(timer);
    timer = setTimeout(save, 600);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
