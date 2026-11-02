"use client";

import { PanelHeader } from "./PanelHeader";
import { ProjectBrowser } from "./ProjectSwitcher";

/** Projects on phones (bottom sheet): the same browser as the header switcher. */
export function ProjectsPanel({ onPicked }: { onPicked?: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Proyek" />
      <ProjectBrowser onDone={onPicked} />
    </div>
  );
}
