"use client";

import { useRef } from "react";
import { Film, Image as ImageIcon, Music, Plus, Trash2, Wand2 } from "lucide-react";
import { useEditor, type Asset, type AssetKind } from "@goodscreen/editor-core";
import { formatDuration } from "@/lib/media";
import { importFiles } from "@/lib/import";
import { PanelHeader } from "./PanelHeader";

/** File list for one kind of project asset (recordings and uploads). */
export function ProjectFiles({
  title,
  kinds,
  accept,
  emptyText,
  onPicked,
  onPick,
  pickLabel = "ke timeline",
  headless,
}: {
  title: string;
  kinds: AssetKind[];
  accept: string;
  emptyText: string;
  onPicked?: () => void;
  /** Replaces "add to timeline" (for a custom pick action). */
  onPick?: (a: Asset) => void;
  pickLabel?: string;
  /** Inside another panel's header (tabs); no header of its own. */
  headless?: boolean;
}) {
  const assets = useEditor((s) => s.project.assets);
  const fileRef = useRef<HTMLInputElement>(null);
  const shown = assets.filter((a) => kinds.includes(a.kind));

  const addToTimeline = (a: Asset) => {
    const { project, playhead, dispatch } = useEditor.getState();
    // Motion lands at the playhead on a free layer; footage and audio append to their track.
    const trackId = project.tracks.find((t) => t.kind === (a.kind === "audio" ? "audio" : "video"))!.id;
    const end = project.clips.filter((c) => c.trackId === trackId).reduce((m, c) => Math.max(m, c.start + c.duration), 0);
    dispatch([{ type: "insertClip", assetId: a.id, start: a.kind === "motion" ? playhead : end }]);
    onPicked?.();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) importFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {!headless && <PanelHeader title={title} meta={`${shown.length} file`} />}

      <div className="scroll-fade scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {shown.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Film className="mx-auto size-6 text-muted/60" />
            <p className="mt-2 text-sm text-fg/80">Belum ada file</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{emptyText}</p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {shown.map((a) => (
              <FileRow key={a.id} asset={a} pickLabel={pickLabel} onAdd={() => (onPick ? onPick(a) : addToTimeline(a))} />
            ))}
          </ul>
        )}
      </div>

      {/* Upload: recordings land here on their own; this adds other files. */}
      <div className="p-2">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-xs text-muted transition-colors hover:bg-panel-3 hover:text-fg"
        >
          <Plus className="size-3.5" /> Tambah file
        </button>
      </div>
    </div>
  );
}

function FileRow({ asset, onAdd, pickLabel }: { asset: Asset; onAdd: () => void; pickLabel: string }) {
  const Icon = asset.kind === "video" ? Film : asset.kind === "audio" ? Music : asset.kind === "image" ? ImageIcon : Wand2;
  const meta =
    asset.kind === "motion"
      ? `Motion · ${asset.motion?.template ?? ""}`
      : asset.width
        ? `${asset.width}×${asset.height}`
        : asset.kind === "audio"
          ? "Audio"
          : "Gambar";

  return (
    <li className="group relative">
      <button
        onClick={onAdd}
        title={`Tambah "${asset.name}" ${pickLabel}`}
        className="hover-surface flex w-full items-center gap-3 rounded-[14px] p-2 text-left transition-colors"
      >
        <div
          className={`relative flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[6px] ${
            "bg-panel-3"
          }`}
        >
          {asset.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={asset.thumbnail} alt="" className="size-full object-cover" />
          ) : (
            <Icon className="size-4 text-fg/70" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-ui font-medium break-all" title={asset.name}>{asset.name}</p>
          <p className="truncate text-meta text-muted">
            {meta} · <span className="font-mono tabular-nums">{formatDuration(asset.duration)}</span>
          </p>
        </div>
      </button>
      <button
        onClick={() => useEditor.getState().removeAsset(asset.id)}
        aria-label={`Hapus ${asset.name}`}
        className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted opacity-100 transition-opacity hover:bg-panel-3 hover:text-fg lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}
