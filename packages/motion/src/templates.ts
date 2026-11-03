import type { MotionSpec, MotionTemplateId } from "@goodscreen/editor-core";

export interface MotionTemplateMeta {
  id: MotionTemplateId;
  name: string;
  description: string;
  defaultDuration: number;
  defaultProps: MotionSpec["props"];
}

/** Catalogue shared by the UI library panel and the agent's tool schema. */
export const MOTION_TEMPLATES: MotionTemplateMeta[] = [
  { id: "kinetic-title", name: "Kinetic Title", description: "A big title animated word by word, made for the hook in the first seconds.", defaultDuration: 2.5, defaultProps: { text: "WATCH THIS", accent: "#ff7a1a" } },
  { id: "zoom-punch", name: "Zoom Punch", description: "A quick zoom into the video to stress a key moment.", defaultDuration: 0.8, defaultProps: { amount: 1.25 } },
  { id: "lower-third", name: "Lower Third", description: "A name or caption along the bottom of the screen.", defaultDuration: 3, defaultProps: { title: "Your Name", subtitle: "Creator", accent: "#a78bfa" } },
  { id: "progress-bar", name: "Progress Bar", description: "A progress bar over the video that keeps viewers watching to the end.", defaultDuration: 15, defaultProps: { color: "#ff7a1a" } },
  { id: "emoji-pop", name: "Emoji Pop", description: "A popping emoji for reactions.", defaultDuration: 1.2, defaultProps: { emoji: "\u{1F525}", x: 0.75, y: 0.3 } },
  { id: "flash", name: "Flash", description: "A short white flash as a beat transition.", defaultDuration: 0.3, defaultProps: { color: "#ffffff" } },
];

export const templateMeta = (id: MotionTemplateId) => MOTION_TEMPLATES.find((t) => t.id === id)!;
