"use client";

import { createContext, useContext } from "react";
import { PanelLeftClose } from "lucide-react";

/** Provided by the desktop layout so every library panel can collapse itself. */
export const CollapseLibraryContext = createContext<(() => void) | null>(null);

export function PanelHeader({ title, meta, children }: { title: string; meta?: string; children?: React.ReactNode }) {
  const collapse = useContext(CollapseLibraryContext);
  return (
    <div className="flex items-center gap-2 px-4 pt-4 pb-3">
      <h2 className="text-title font-semibold">{title}</h2>
      {meta && <span className="text-meta text-muted">{meta}</span>}
      <div className="ml-auto flex items-center gap-1">
        {children}
        {collapse && (
          <button
            onClick={collapse}
            aria-label="Close panel"
            title="Close panel"
            className="flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-panel-3 hover:text-fg"
          >
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
