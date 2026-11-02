"use client";

import { useEffect } from "react";
import { useEditor } from "@goodscreen/editor-core";
import { useTools } from "@/lib/tools";
import { Inspector } from "./Inspector";
import { ToolPanel } from "./ToolRail";

/** Right card: the selected clip's settings, or the settings of the active canvas tool. */
export function RightPanel({ onRecord }: { onRecord?: () => void }) {
  const selectSeq = useEditor((s) => s.selectSeq);
  const tool = useTools((s) => s.active);

  // Clicking a zoom segment on the timeline opens the Zoom tool; any other clip opens its settings.
  useEffect(() => {
    const { project, selectedClipId } = useEditor.getState();
    const clip = project.clips.find((c) => c.id === selectedClipId);
    if (!clip) return;
    if (clip.zoom) return useTools.getState().open("zoom");
    useTools.getState().close();
  }, [selectSeq]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {tool && onRecord ? <ToolPanel key={tool} tool={tool} onRecord={onRecord} /> : <Inspector />}
    </div>
  );
}
