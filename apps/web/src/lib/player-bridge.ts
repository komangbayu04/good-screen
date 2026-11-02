import type { PlayerRef } from "@remotion/player";
import { useEditor } from "@goodscreen/editor-core";

/**
 * Single place that talks to the Remotion Player, so the timeline, keyboard
 * shortcuts and transport buttons stay in sync with the preview.
 */
let player: PlayerRef | null = null;

export const bindPlayer = (ref: PlayerRef | null) => {
  player = ref;
};

export function seek(t: number) {
  const { project, setPlayhead } = useEditor.getState();
  const time = Math.max(0, t);
  player?.seekTo(Math.round(time * project.fps));
  setPlayhead(time);
}

export function togglePlay() {
  if (!player) return;
  if (player.isPlaying()) player.pause();
  else player.play();
}

export const pause = () => player?.pause();
