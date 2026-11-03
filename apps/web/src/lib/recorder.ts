import { createStore as createIdbStore, del, entries, set as idbSet } from "idb-keyval";
import { create } from "zustand";
import type { CursorSample } from "@goodscreen/editor-core";
import { importFiles, importScreenTake } from "./import";
import { trackCursor, type CursorTracker } from "./cursor-track";

export type RecordSource = "screen" | "camera";

export interface RecordOptions {
  source: RecordSource;
  /** Record the webcam as a separate, synced file (screen source only). */
  camera: boolean;
  mic: boolean;
  /** Tab / system audio from the screen share, where the browser offers it. */
  systemAudio: boolean;
  /** Seconds of 3-2-1 before recording starts (0 = none). */
  countdown: number;
}

export interface RecoveredTake {
  id: string;
  source: RecordSource;
  startedAt: number;
  hasCamera: boolean;
  seconds: number;
}

type Status = "idle" | "countdown" | "recording" | "paused" | "saving";

interface RecorderState {
  status: Status;
  source: RecordSource | null;
  countdown: number;
  /** Recording time banked before the current run (pauses split runs). */
  banked: number;
  runStartedAt: number;
  screenStream: MediaStream | null;
  cameraStream: MediaStream | null;
  error: string | null;
  recoverable: RecoveredTake[];
  /** Floating always-on-top controls window is open. */
  floating: boolean;
  setFloating: (on: boolean) => void;
  start: (opts: RecordOptions) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  cancel: () => void;
  scanRecoverable: () => Promise<void>;
  recover: (id: string) => Promise<void>;
  discard: (id: string) => Promise<void>;
}

export const canRecordScreen = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
export const canRecordCamera = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** Elapsed recording seconds, excluding pauses. */
export const elapsedSeconds = (s: Pick<RecorderState, "status" | "banked" | "runStartedAt">) =>
  s.banked + (s.status === "recording" ? (Date.now() - s.runStartedAt) / 1000 : 0);

// Every chunk is written to IndexedDB as it arrives, so a crash or closed tab
// loses at most ~1 second. Created lazily: IndexedDB is absent during prerender.
let takesDb: ReturnType<typeof createIdbStore> | undefined;
const takes = () => (takesDb ??= createIdbStore("reels-takes", "chunks"));

type Role = "screen" | "camera";
interface Take {
  id: string;
  recorders: Partial<Record<Role, MediaRecorder>>;
  chunks: Record<Role, Blob[]>;
  seq: number;
  owned: MediaStream[];
  closeAudio: () => void;
  opts: RecordOptions;
  startedAt: number;
  /** Pointer positions found in the screen frames (screen source only). */
  cursor?: CursorTracker;
}
let take: Take | null = null;
let countdownTimer: ReturnType<typeof setTimeout> | undefined;

function pickMimeType() {
  const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

/** Screen-share audio and the microphone are separate tracks; MediaRecorder keeps one, so mix them. */
function mixAudio(streams: MediaStream[]) {
  const withAudio = streams.filter((s) => s.getAudioTracks().length);
  if (withAudio.length <= 1) return { tracks: withAudio[0]?.getAudioTracks() ?? [], close: () => {} };
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  withAudio.forEach((s) => ctx.createMediaStreamSource(s).connect(dest));
  return { tracks: dest.stream.getAudioTracks(), close: () => void ctx.close() };
}

const MIC: MediaTrackConstraints = { noiseSuppression: true, echoCancellation: true, autoGainControl: true };

function releaseStreams() {
  take?.cursor?.stop();
  take?.owned.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  take?.closeAudio();
}

function label(source: RecordSource, startedAt: number) {
  const time = new Date(startedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return source === "screen" ? `Screen recording ${time}` : `Camera recording ${time}`;
}

async function deleteTake(id: string) {
  const all = await entries<string, unknown>(takes()).catch(() => []);
  await Promise.all(all.filter(([k]) => String(k).startsWith(`${id}:`)).map(([k]) => del(k, takes())));
}

/** Turn saved chunks into the editor's assets and timeline clips. */
async function finish(id: string, source: RecordSource, startedAt: number, chunks: Record<Role, Blob[]>, mime: string, cursor?: CursorSample[]) {
  const type = mime || "video/webm";
  const ext = type.includes("mp4") ? "mp4" : "webm";
  const name = label(source, startedAt);
  const screenFile = new File(chunks.screen, `${name}.${ext}`, { type });
  if (source === "camera") {
    const { errors } = await importFiles([screenFile]);
    if (errors.length) throw new Error(errors[0]);
  } else {
    const cameraFile = chunks.camera.length ? new File(chunks.camera, `${name} (camera).${ext}`, { type }) : null;
    await importScreenTake(screenFile, cameraFile, cursor);
  }
  await deleteTake(id);
}

export const useRecorder = create<RecorderState>((set, get) => ({
  status: "idle",
  source: null,
  countdown: 0,
  banked: 0,
  runStartedAt: 0,
  screenStream: null,
  cameraStream: null,
  error: null,
  recoverable: [],
  floating: false,
  setFloating: (floating) => set({ floating }),

  start: async (opts) => {
    if (get().status !== "idle") return;
    set({ error: null });
    const owned: MediaStream[] = [];
    try {
      let primary: MediaStream;
      let camera: MediaStream | null = null;
      if (opts.source === "screen") {
        primary = await navigator.mediaDevices.getDisplayMedia({
          // The real cursor stays in the picture.
          video: { frameRate: { ideal: 30 }, cursor: "always" } as MediaTrackConstraints,
          audio: opts.systemAudio,
          // Chrome hints: offer system audio, keep this tab out of the picker list.
          ...({ systemAudio: opts.systemAudio ? "include" : "exclude", selfBrowserSurface: "exclude", surfaceSwitching: "include" } as object),
        });
        owned.push(primary);
        if (opts.mic) owned.push(await navigator.mediaDevices.getUserMedia({ audio: MIC }));
        if (opts.camera) {
          camera = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } });
          owned.push(camera);
        }
      } else {
        primary = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: opts.mic ? MIC : false,
        });
        owned.push(primary);
      }

      const audio = mixAudio(owned.filter((s) => s !== camera));
      const mimeType = pickMimeType();
      const id = crypto.randomUUID();
      take = { id, recorders: {}, chunks: { screen: [], camera: [] }, seq: 0, owned, closeAudio: audio.close, opts, startedAt: 0 };

      const makeRecorder = (role: Role, stream: MediaStream) => {
        const r = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        r.ondataavailable = (e) => {
          if (!e.data.size || !take) return;
          take.chunks[role].push(e.data);
          void idbSet(`${id}:${role}:${String(take.seq++).padStart(6, "0")}`, e.data, takes()).catch(() => {});
          // The pointer track is saved alongside every few seconds, for recovery too.
          if (role === "screen" && take.cursor && take.chunks.screen.length % 5 === 0)
            void idbSet(`${id}:cursor`, [...take.cursor.samples], takes()).catch(() => {});
        };
        take!.recorders[role] = r;
        return r;
      };
      const screenRec = makeRecorder("screen", new MediaStream([...primary.getVideoTracks(), ...audio.tracks]));
      if (camera) makeRecorder("camera", new MediaStream(camera.getVideoTracks()));

      // The browser's own "Stop sharing" button ends the video track.
      primary.getVideoTracks()[0]?.addEventListener("ended", () => get().stop());

      set({ screenStream: primary, cameraStream: camera, source: opts.source });

      const begin = () => {
        if (!take) return;
        const startedAt = Date.now();
        take.startedAt = startedAt;
        void idbSet(`${id}:meta`, { source: opts.source, startedAt, hasCamera: !!camera, mime: screenRec.mimeType }, takes()).catch(() => {});
        Object.values(take.recorders).forEach((r) => r!.start(1000));
        set({ status: "recording", countdown: 0, banked: 0, runStartedAt: startedAt });
        // Pointer times use the same clock as the video: recording time, pauses excluded.
        const screenTrack = opts.source === "screen" ? primary.getVideoTracks()[0] : undefined;
        if (screenTrack) take.cursor = trackCursor(screenTrack, () => (get().status === "recording" ? elapsedSeconds(get()) : null));
      };

      if (opts.countdown > 0) {
        set({ status: "countdown", countdown: opts.countdown });
        const tick = () => {
          const n = get().countdown - 1;
          if (n <= 0) begin();
          else {
            set({ countdown: n });
            countdownTimer = setTimeout(tick, 1000);
          }
        };
        countdownTimer = setTimeout(tick, 1000);
      } else begin();
    } catch (e) {
      owned.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      take = null;
      const denied = e instanceof DOMException && e.name === "NotAllowedError";
      set({
        status: "idle",
        source: null,
        screenStream: null,
        cameraStream: null,
        error: denied
          ? "Recording permission was denied. Allow screen, camera or microphone access in your browser settings, then try again."
          : `Couldn't start recording (${e instanceof Error ? e.message : "device unavailable"}). Try turning off the camera or system audio, then try again.`,
      });
    }
  },

  pause: () => {
    if (get().status !== "recording" || !take) return;
    Object.values(take.recorders).forEach((r) => r!.state === "recording" && r!.pause());
    set((s) => ({ status: "paused", banked: elapsedSeconds(s) }));
  },

  resume: () => {
    if (get().status !== "paused" || !take) return;
    Object.values(take.recorders).forEach((r) => r!.state === "paused" && r!.resume());
    set({ status: "recording", runStartedAt: Date.now() });
  },

  cancel: () => {
    clearTimeout(countdownTimer);
    const id = take?.id;
    Object.values(take?.recorders ?? {}).forEach((r) => {
      r!.ondataavailable = null;
      if (r!.state !== "inactive") r!.stop();
    });
    releaseStreams();
    take = null;
    if (id) void deleteTake(id);
    set({ status: "idle", source: null, countdown: 0, screenStream: null, cameraStream: null, floating: false });
  },

  stop: () => {
    const status = get().status;
    if (status === "countdown") return get().cancel();
    if ((status !== "recording" && status !== "paused") || !take) return;
    const current = take;
    const recorders = Object.values(current.recorders) as MediaRecorder[];
    const cursor = current.cursor?.stop();
    let pending = recorders.length;
    set({ status: "saving", screenStream: null, cameraStream: null, floating: false });
    recorders.forEach((r) => {
      r.onstop = async () => {
        if (--pending > 0) return;
        releaseStreams();
        take = null;
        try {
          await finish(current.id, current.opts.source, current.startedAt || Date.now(), current.chunks, current.recorders.screen?.mimeType ?? "", cursor);
          set({ status: "idle", source: null, error: null });
        } catch (e) {
          set({ status: "idle", source: null, error: `The recording was partly saved and can be recovered (${e instanceof Error ? e.message : "import failed"}).` });
          void get().scanRecoverable();
        }
      };
      r.stop();
    });
  },

  scanRecoverable: async () => {
    if (take) return;
    const all = await entries<string, unknown>(takes()).catch(() => []);
    const metas = all.filter(([k]) => String(k).endsWith(":meta")) as [string, { source: RecordSource; startedAt: number; hasCamera: boolean }][];
    const list = metas.map(([k, m]) => {
      const id = k.slice(0, -5);
      const count = all.filter(([key]) => String(key).startsWith(`${id}:screen:`)).length;
      return { id, source: m.source, startedAt: m.startedAt, hasCamera: m.hasCamera, seconds: count };
    });
    // Orphaned chunks without metadata (countdown cancelled mid-write) are dropped.
    set({ recoverable: list.filter((t) => t.seconds > 0) });
  },

  recover: async (id) => {
    const all = await entries<string, unknown>(takes());
    const meta = all.find(([k]) => k === `${id}:meta`)?.[1] as { source: RecordSource; startedAt: number; mime?: string } | undefined;
    const pick = (role: Role) =>
      all
        .filter(([k]) => String(k).startsWith(`${id}:${role}:`))
        .sort(([a], [b]) => String(a).localeCompare(String(b)))
        .map(([, v]) => v as Blob);
    try {
      const cursor = all.find(([k]) => k === `${id}:cursor`)?.[1] as CursorSample[] | undefined;
      await finish(id, meta?.source ?? "screen", meta?.startedAt ?? Date.now(), { screen: pick("screen"), camera: pick("camera") }, meta?.mime ?? "video/webm", cursor);
    } catch (e) {
      set({ error: `The recording couldn't be recovered (${e instanceof Error ? e.message : "the data is damaged"}).` });
    }
    await get().scanRecoverable();
  },

  discard: async (id) => {
    await deleteTake(id);
    await get().scanRecoverable();
  },
}));
