/**
 * The Android native audio plugin (src-tauri/plugins/native-audio), typed. Every command
 * the app sends it goes through here; nothing else builds a `plugin:native-audio|…` string.
 * `@tauri-apps/api/core` is imported on first use, so nothing loads in a browser.
 *
 * Commands are snake_case here and in the plugin's build.rs; Tauri calls the Kotlin method
 * of the camelCase name (`set_queue` → `NativeAudioPlugin.setQueue`).
 */

export type NativeStatus = "idle" | "loading" | "playing" | "ended" | "error";

/** The plugin's state event, and what most commands resolve with. */
export interface NativeSnapshot {
  status: NativeStatus;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  buffering: boolean;
  rate: number;
  error?: string;
  /** Position in the native playlist. */
  index?: number;
  /** When native took this snapshot (monotonic ms). Orders events against `getState`. */
  capturedAtMs?: number;
  /** Bumped by every queue change; with `queueOrigin`, tells the app of a queue it did not load. */
  queueGeneration?: number;
  /** "external": Android Auto, a voice request, the resume card, an earphone resume after
   *  the app's stop. v0.4.0 called that "car"; both are accepted. */
  queueOrigin?: "app" | "external" | "car";
  /** Plan chapters and devotionals native recorded as heard, waiting for the app. */
  pendingCompletions?: number;
  /** Indexes of the current queue that played to their natural end; skips never add to it.
   *  Reset with each queue generation. */
  finished?: number[];
}

/** A queue item as the app sends it. */
export interface NativeQueueArg {
  src: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  /** "ch/JHN/3", "plan/<plan>/<day>/<reading>/<book>/<chapter>" or "dev/<id>". */
  mediaId?: string;
  /** Plan day only: which of the day's readings this chapter belongs to. */
  group?: number;
}

/** A queue item as the native player reports it (`get_queue`). */
export interface NativeQueueItem {
  mediaId: string;
  src: string;
  title: string;
  subtitle: string;
  ho?: string;
  chapter?: number;
  planId?: string;
  planDay?: number;
  planReadingIndex?: number;
  readingGroup?: number;
}

/** A plan chapter or devotional native heard to the end, waiting to be recorded by the app. */
export interface NativeCompletion {
  seq: number;
  /** Absent on entries written before devotionals were recorded: those are plan chapters. */
  kind?: "plan" | "devotional";
  planId?: string;
  planDay?: number;
  planReadingIndex?: number;
  /** The car's devotional id, "spurgeon-morning-evening:09-25:m". */
  devotionalId?: string;
  completedAt: number;
}

type Core = typeof import("@tauri-apps/api/core");
let core: Promise<Core> | null = null;
function loadCore(): Promise<Core> {
  core ??= import("@tauri-apps/api/core");
  return core;
}

async function call<T = void>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await loadCore();
  return invoke<T>(`plugin:native-audio|${command}`, args);
}

export const nativeAudio = {
  /** Build the player and the media session, and ask for the notification permission. */
  initialize: () => call<NativeSnapshot>("initialize"),
  /** The current state. Does not build the player. */
  getState: () => call<NativeSnapshot>("get_state"),
  setQueue: (items: NativeQueueArg[], startIndex: number) => call<NativeSnapshot>("set_queue", { items, startIndex }),
  /** Jump within the loaded queue. Rejects ("stale queue") when `queueGeneration` is not
   *  the loaded one; hand the whole queue over again with setQueue then. */
  skipTo: (index: number, positionSec: number, queueGeneration?: number) =>
    call<NativeSnapshot>("skip_to", { index, positionSec, queueGeneration }),
  play: () => call<NativeSnapshot>("play"),
  pause: () => call<NativeSnapshot>("pause"),
  /** Unload the queue and let the playback service stop (the mini-player's ✕). */
  stop: () => call<NativeSnapshot>("stop"),
  next: () => call<NativeSnapshot>("next"),
  previous: () => call<NativeSnapshot>("previous"),
  seekTo: (position: number) => call<NativeSnapshot>("seek_to", { position }),
  setRate: (rate: number) => call<NativeSnapshot>("set_rate", { rate }),
  getQueue: () => call<{ items: NativeQueueItem[]; index: number; queueGeneration: number }>("get_queue"),
  setCarSnapshot: (json: string) => call("set_car_snapshot", { json }),
  takeCompletions: () => call<{ items: NativeCompletion[] }>("take_completions"),
  ackCompletions: (upTo: number) => call("ack_completions", { upTo }),
  getDebugLog: () => call<{ lines: string[] }>("get_debug_log"),
  /** Every state change native reports (see NativeAudioRuntime.emitState). */
  onState: async (handler: (s: NativeSnapshot) => void) => {
    const { addPluginListener } = await loadCore();
    return addPluginListener<NativeSnapshot>("native-audio", "native_audio_state", handler);
  },
};
