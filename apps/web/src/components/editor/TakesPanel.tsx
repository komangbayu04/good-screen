"use client";

import { useMemo } from "react";
import { Video } from "lucide-react";
import { useEditor, type Asset } from "@goodscreen/editor-core";
import { formatDuration } from "@/lib/media";
import { setWorkspace } from "@/lib/workspace";
import { PanelHeader } from "./PanelHeader";

// Takes recorded before the English UI have Indonesian names ("Rekaman layar …").
const isTake = (a: Asset) => a.kind === "video" && /^((Screen|Camera) recording|Rekaman (layar|kamera)) /.test(a.name) && !/\((camera|kamera)\)/.test(a.name);

/** Everything recorded in this project; opening one jumps to it in Edit. */
export function TakesPanel() {
  const assets = useEditor((s) => s.project.assets);
  const takes = useMemo(() => assets.filter(isTake).reverse(), [assets]);

  const open = (a: Asset) => {
    const { project, dispatch, select } = useEditor.getState();
    let clip = project.clips.find((c) => c.assetId === a.id);
    if (!clip) {
      const vt = project.tracks.find((t) => t.kind === "video")!.id;
      const end = project.clips.filter((c) => c.trackId === vt).reduce((m, c) => Math.max(m, c.start + c.duration), 0);
      const id = crypto.randomUUID().slice(0, 8);
      dispatch([{ type: "insertClip", id, assetId: a.id, start: end }]);
      clip = useEditor.getState().project.clips.find((c) => c.id === id);
    }
    if (clip) select(clip.id);
    setWorkspace("edit");
  };

  if (!takes.length) return <EmptyPanel title="Recordings" icon={Video} text="Screen and camera recordings in this project show up here." />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Recordings" meta={`${takes.length}`} />
      <ul className="scroll-fade scrollbar-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 pb-2">
        {takes.map((a) => (
          <li key={a.id}>
            <button
              onClick={() => open(a)}
              title="Open in the editor"
              className="flex w-full items-center gap-3 rounded-[14px] p-2 text-left transition-colors hover:bg-panel-2"
            >
              <span className="flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-panel-3 outline-1 -outline-offset-1 outline-white/10">
                {a.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.thumbnail} alt="" className="size-full object-cover" />
                ) : (
                  <Video className="size-4 text-fg/70" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui font-medium">{a.name.replace(/\.(webm|mp4)$/, "")}</span>
                <span className="block font-mono text-meta text-muted tabular-nums">{formatDuration(a.duration)}</span>
              </span>
              <span className="text-meta text-muted">Edit</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------- shared */

function EmptyPanel({ title, icon: Icon, text, headless }: { title: string; icon: typeof Video; text: string; headless?: boolean }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {!headless && <PanelHeader title={title} />}
      <div className="px-6 py-10 text-center">
        <Icon className="mx-auto size-6 text-muted/60" />
        <p className="mt-2 text-xs leading-relaxed text-muted">{text}</p>
      </div>
    </div>
  );
}
