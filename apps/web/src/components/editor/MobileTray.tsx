"use client";

import { CircleDot, Film, SlidersHorizontal, Type, type LucideIcon } from "lucide-react";

export type TrayTarget = "media" | "text" | "record" | "edit";

/** Phone tool tray: record first, then the editing tools. */
export function MobileTray({ onOpen }: { onOpen: (target: TrayTarget) => void }) {
  return (
    <div className="scrollbar-thin flex items-end justify-center gap-2 overflow-x-auto px-3 pt-1 pb-3">
      <Tile icon={CircleDot} label="Rekam" onClick={() => onOpen("record")} />
      <Tile icon={Film} label="Media" onClick={() => onOpen("media")} />
      <Tile icon={Type} label="Teks" onClick={() => onOpen("text")} />
      <Tile icon={SlidersHorizontal} label="Edit" onClick={() => onOpen("edit")} />
    </div>
  );
}

function Tile({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-[56px] shrink-0 flex-col items-center gap-1.5">
      <span className="relative flex size-12 items-center justify-center rounded-[14px] bg-panel-3/70 text-fg/85 ring-1 ring-ink/[0.05]">
        <Icon className="size-5" />
      </span>
      <span className="text-2xs text-muted">{label}</span>
    </button>
  );
}
