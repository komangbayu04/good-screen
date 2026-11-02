import { create } from "zustand";

/** One app-wide toast, so results survive the component that triggered them unmounting. */
export const useToast = create<{ message: string | null; show: (message: string) => void; clear: () => void }>((set) => ({
  message: null,
  show: (message) => set({ message }),
  clear: () => set({ message: null }),
}));

export const toast = (message: string) => useToast.getState().show(message);
