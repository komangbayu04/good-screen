"use client";

import { ProjectFiles } from "./ProjectFiles";
import { ProjectsPanel } from "./LibraryPanels";
import { RecordPanel } from "./RecordPanel";
import { TakesPanel } from "./TakesPanel";

export type LibraryMenu = "project" | "media" | "record" | "takes";

/** Library panels for the mobile bottom sheet; desktop has no library column. */
export function LibraryContent({ menu, onPicked }: { menu: LibraryMenu; onPicked?: () => void }) {
  switch (menu) {
    case "project":
      return <ProjectsPanel onPicked={onPicked} />;
    case "media":
      return (
        <ProjectFiles
          title="Media"
          kinds={["video", "image", "audio"]}
          accept="video/*,image/*,audio/*"
          emptyText="Your recordings and uploaded files show up here."
          onPicked={onPicked}
        />
      );
    case "record":
      return <RecordPanel />;
    case "takes":
      return <TakesPanel />;
  }
}
