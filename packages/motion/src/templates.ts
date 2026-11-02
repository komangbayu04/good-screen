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
  { id: "kinetic-title", name: "Kinetic Title", description: "Judul besar dengan animasi kata per kata, cocok untuk hook di detik awal.", defaultDuration: 2.5, defaultProps: { text: "WATCH THIS", accent: "#ff7a1a" } },
  { id: "zoom-punch", name: "Zoom Punch", description: "Zoom cepat ke video untuk menekankan momen penting.", defaultDuration: 0.8, defaultProps: { amount: 1.25 } },
  { id: "lower-third", name: "Lower Third", description: "Nama atau keterangan di bagian bawah layar.", defaultDuration: 3, defaultProps: { title: "Your Name", subtitle: "Creator", accent: "#a78bfa" } },
  { id: "progress-bar", name: "Progress Bar", description: "Bar progres di atas video agar penonton bertahan sampai akhir.", defaultDuration: 15, defaultProps: { color: "#ff7a1a" } },
  { id: "emoji-pop", name: "Emoji Pop", description: "Emoji yang meletup untuk reaksi.", defaultDuration: 1.2, defaultProps: { emoji: "\u{1F525}", x: 0.75, y: 0.3 } },
  { id: "flash", name: "Flash", description: "Kilatan putih singkat sebagai transisi beat.", defaultDuration: 0.3, defaultProps: { color: "#ffffff" } },
];

export const templateMeta = (id: MotionTemplateId) => MOTION_TEMPLATES.find((t) => t.id === id)!;
