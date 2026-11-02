import { create } from "zustand";

/** What the main area shows: the editor, or the recorder. */
export type Workspace = "edit" | "record";

export const useWorkspace = create<{ mode: Workspace }>(() => ({ mode: "edit" }));
export const setWorkspace = (mode: Workspace) => useWorkspace.setState({ mode });
