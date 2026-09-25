import { useSyncExternalStore } from "react";
import { selectEngine, type AudioEngine, type EngineTrack, type NativeQueueItem } from "./engine";

/**
 * A single, app-wide audio player for scripture narration. It lives OUTSIDE the React
 * tree (one `Audio()` element) so playback survives route changes and the mini-player,
 * and it drives the OS **Media Session** (lock-screen / notification transport controls,
 * like a podcast app). A queue lets a plan day play straight through all its readings.
 *
 * Kept as a plain singleton + `useSyncExternalStore` (not a second Zustand store, and not
 * persisted — playback position changes too often to write to localStorage).
 */

export interface Track {
  ho: string;
  chapter: number;
  src: string;
  title: string; // e.g. "John 1"
  subtitle: string; // e.g. "BSB · David"
  /** When this queue is a plan day, the reading's index in that day (for auto-marking read). */
  planReadingIndex?: number;
  /** Which plan day this queue belongs to. Lets the guided reader tell "my day's
   *  narration is playing" from "some other audio is playing" — the two need very
   *  different answers from the Listen button and from the follow-the-audio cursor. */
  planId?: string;
  planDay?: number;
  /** Plan day only: which of the day's readings (passages) this chapter belongs to —
   *  several chapters can make one reading ("Genesis 1–2"). Set by buildReadingQueue. */
  readingGroup?: number;
}

/** Fires when a track finishes NATURALLY (not on manual skip) — used to mark a plan
 *  reading done once its narration completes. */
type TrackCompleteHandler = (track: Track, index: number) => void;
let onTrackComplete: TrackCompleteHandler | null = null;

export interface AudioState {
  queue: Track[];
  index: number; // -1 = nothing loaded
  playing: boolean;
  currentTime: number;
  duration: number;
  loading: boolean;
  /** Playback speed (1 = normal). Only changeable when `canSetRate` is true. */
  rate: number;
}

const EMPTY: AudioState = { queue: [], index: -1, playing: false, currentTime: 0, duration: 0, loading: false, rate: 1 };

let state: AudioState = EMPTY;
const listeners = new Set<() => void>();

// The swappable playback engine (HTML5 today; native Media3 later). The queue,
// auto-advance, mark-read and Media Session all live here in the controller.
const engine: AudioEngine = selectEngine();

// HTML5: single-advance guard (a native engine drives its own advancement).
let advancing = false;
// Native queue: how far through the queue we've marked read (exclusive index).
let markedUpTo = 0;

/** Mark tracks [markedUpTo, upto) read — the native player has advanced past them. */
function markThrough(upto: number) {
  for (let k = markedUpTo; k < upto && k < state.queue.length; k++) {
    const t = state.queue[k];
    if (onTrackComplete) {
      try {
        onTrackComplete(t, k); // e.g. mark the plan reading read
      } catch {
        /* mark-read failure must never break playback */
      }
    }
  }
  if (upto > markedUpTo) markedUpTo = upto;
}

/** HTML5 only: mark the current track read + step to the next one. */
function advanceQueue() {
  if (advancing) return;
  advancing = true;
  const finished = state.queue[state.index];
  const idx = state.index;
  if (finished && onTrackComplete) {
    try {
      onTrackComplete(finished, idx);
    } catch {
      /* non-fatal */
    }
  }
  setTimeout(() => next(), 60); // out of the state-callback stack; loadIndex resets the guard
}

engine.handlers = {
  onPlay: () => {
    set({ playing: true });
    setMediaPlaybackState("playing");
  },
  onPause: () => {
    set({ playing: false });
    setMediaPlaybackState("paused");
  },
  onTime: (t) => {
    set({ currentTime: t });
    syncPositionState();
  },
  onDuration: (d) => set({ duration: d }),
  onLoading: (b) => set({ loading: b }),
  // NATIVE queue: ExoPlayer advanced to the next chapter itself (works in the background;
  // these events batch and apply when JS resumes if the app was backgrounded). Mark the
  // chapters we passed read and update the mini-player.
  onIndexChange: (index) => {
    markThrough(index);
    set({ index, currentTime: 0, duration: 0 });
    const t = state.queue[index];
    if (t) setMediaMetadata(t);
  },
  // Android Auto (or the system's resume card) loaded a queue the app did not: take it as
  // ours so the mini-player and Now Playing show it. Its plan chapters are recorded by
  // native (they reach the app through take_car_completions), so nothing marks here.
  onExternalQueue: (items, index) => {
    const queue = items.map(trackFromNative);
    onTrackComplete = null;
    advancing = false;
    markedUpTo = index;
    set({ queue, index: Math.max(0, Math.min(index, queue.length - 1)), currentTime: 0, duration: 0 });
    const t = queue[index];
    if (t) setMediaMetadata(t);
  },
  onRate: (rate) => set({ rate }),
  onPendingCompletions: (count) => onNativeCompletions?.(count),
  onEnded: () => {
    set({ playing: false });
    if (engine.supportsNativeQueue) {
      markThrough(state.queue.length); // whole playlist finished — mark the rest read
    } else {
      advanceQueue(); // HTML5: one track ended, step forward
    }
  },
};

/** Plan chapters finished in Android Auto are waiting to be recorded (see src/audio/car.ts). */
let onNativeCompletions: ((count: number) => void) | null = null;
export function setNativeCompletionsHandler(fn: ((count: number) => void) | null) {
  onNativeCompletions = fn;
}

function emit() {
  listeners.forEach((l) => l());
}
function set(patch: Partial<AudioState>) {
  state = { ...state, ...patch };
  emit();
}

function trackFromNative(item: NativeQueueItem): Track {
  return {
    ho: item.ho ?? "",
    chapter: item.chapter ?? 0,
    src: item.src,
    title: item.title,
    subtitle: item.subtitle,
    planId: item.planId,
    planDay: item.planDay,
    planReadingIndex: item.planReadingIndex,
    readingGroup: item.readingGroup,
  };
}

/**
 * The name the native player (and Android Auto's Recent and Continue listening) knows a
 * track by: a plan day's chapter as "plan/<plan>/<day>/<reading>/<book>/<chapter>", any
 * other Bible chapter as "ch/<book>/<chapter>". Mirrors MediaIds in CarData.kt. Other audio
 * (Missler, devotionals) has none.
 */
export function nativeMediaId(t: Track): string | undefined {
  const m = /\/([0-9A-Z]{3})\/(\d+)\/audio\/[A-Za-z0-9_-]+\.mp3$/.exec(t.src.split(/[?#]/)[0]);
  const isChapter = !!m && m[1] === t.ho && Number(m[2]) === t.chapter;
  if (!isChapter) return undefined;
  if (t.planId != null && t.planDay != null && t.planReadingIndex != null) {
    return `plan/${encodeURIComponent(t.planId)}/${t.planDay}/${t.planReadingIndex}/${t.ho}/${t.chapter}`;
  }
  return `ch/${t.ho}/${t.chapter}`;
}

function toEngineTrack(t: Track): EngineTrack {
  return { src: t.src, title: t.title, subtitle: t.subtitle, mediaId: nativeMediaId(t), group: t.readingGroup };
}

/* -------------------------------- media session ------------------------------- */

function mediaSession(): MediaSession | null {
  // A native engine provides its own OS controls (foreground MediaSessionService), so
  // skip the web Media Session there to avoid two controllers fighting.
  if (!engine.usesWebMediaSession) return null;
  return typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null;
}
function setMediaPlaybackState(s: "playing" | "paused" | "none") {
  const ms = mediaSession();
  if (ms) ms.playbackState = s;
}
function syncPositionState() {
  const ms = mediaSession();
  const dur = engine.duration();
  if (!ms || !Number.isFinite(dur) || dur <= 0) return;
  try {
    ms.setPositionState({ duration: dur, position: Math.min(engine.currentTime(), dur), playbackRate: state.rate });
  } catch {
    /* Safari/older WebViews may throw on bad values — non-fatal */
  }
}
function setMediaMetadata(t: Track) {
  const ms = mediaSession();
  if (!ms) return;
  try {
    if ("MediaMetadata" in window) {
      ms.metadata = new MediaMetadata({ title: t.title, artist: t.subtitle, album: "Bread of Life" });
    }
    ms.setActionHandler("play", () => play());
    ms.setActionHandler("pause", () => pause());
    ms.setActionHandler("previoustrack", () => prev());
    ms.setActionHandler("nexttrack", () => next());
    ms.setActionHandler("seekto", (d) => {
      if (typeof d.seekTime === "number") seekTo(d.seekTime);
    });
    ms.setActionHandler("seekbackward", (d) => seekBy(-(d.seekOffset ?? 10)));
    ms.setActionHandler("seekforward", (d) => seekBy(d.seekOffset ?? 10));
  } catch {
    /* some handlers unsupported on some platforms — non-fatal */
  }
}

/* --------------------------------- controls ---------------------------------- */

function loadIndex(index: number, autoplay: boolean) {
  const t = state.queue[index];
  if (!t) return;
  advancing = false; // new track — allow the next advance
  engine.load({ src: t.src, title: t.title, subtitle: t.subtitle });
  set({ index, currentTime: 0, duration: 0, loading: true });
  setMediaMetadata(t);
  if (autoplay) engine.play();
}

/** Start a fresh queue at `startIndex` and play. `onComplete` fires each time a track
 *  finishes (used by the plan reader to mark readings done). On a native-queue engine the
 *  whole playlist is handed to the OS player so it advances itself, even in the background;
 *  on HTML5 the controller steps through track by track. */
export function playQueue(tracks: Track[], opts?: { startIndex?: number; onComplete?: TrackCompleteHandler }) {
  if (!tracks.length) return;
  onTrackComplete = opts?.onComplete ?? null;
  const start = Math.max(0, Math.min(opts?.startIndex ?? 0, tracks.length - 1));
  set({ queue: tracks });
  if (engine.supportsNativeQueue) {
    markedUpTo = start; // don't mark anything before where we start
    set({ index: start, currentTime: 0, duration: 0, loading: true });
    setMediaMetadata(tracks[start]);
    engine.loadQueue(tracks.map(toEngineTrack), start);
  } else {
    loadIndex(start, true);
  }
}

export function play() {
  engine.play();
}
export function pause() {
  engine.pause();
}
export function toggle() {
  if (state.playing) pause();
  else play();
}
export function next() {
  if (engine.supportsNativeQueue) {
    engine.queueNext(); // native player advances; onIndexChange updates us
    return;
  }
  if (state.index < state.queue.length - 1) loadIndex(state.index + 1, true);
  else {
    // End of queue. Clear the advance guard here too — only loadIndex used to do it,
    // so a queue that ran to its end left `advancing` stuck true and the NEXT track
    // to finish was never marked read or advanced past.
    advancing = false;
    set({ playing: false });
  }
}
export function prev() {
  if (engine.supportsNativeQueue) {
    engine.queuePrev();
    return;
  }
  // restart current if we're >3s in, else go to the previous track
  if (engine.currentTime() > 3) {
    seekTo(0);
  } else if (state.index > 0) {
    loadIndex(state.index - 1, true);
  } else {
    seekTo(0);
  }
}
export function jumpTo(index: number) {
  if (index < 0 || index >= state.queue.length) return;
  if (engine.supportsNativeQueue) {
    // The native player holds the whole playlist; `load` would replace it with one
    // track. Re-hand it the same playlist starting at `index` instead, and only mark
    // chapters read from here on (skipping ahead is not listening).
    markedUpTo = index;
    set({ index, currentTime: 0, duration: 0, loading: true });
    setMediaMetadata(state.queue[index]);
    engine.loadQueue(state.queue.map(toEngineTrack), index);
    return;
  }
  loadIndex(index, true);
}

/** Whether the active engine can change playback speed (the Linux desktop one can't). */
export const canSetRate = !!engine.supportsRate;

export function setRate(rate: number) {
  if (!canSetRate || !Number.isFinite(rate) || rate <= 0) return;
  engine.setRate?.(rate);
  set({ rate });
}
export function seekTo(sec: number) {
  engine.seekTo(sec);
  set({ currentTime: engine.currentTime() });
}
export function seekBy(delta: number) {
  seekTo(engine.currentTime() + delta);
}
export function stop() {
  engine.release();
  setMediaPlaybackState("none");
  const ms = mediaSession();
  if (ms) ms.metadata = null;
  onTrackComplete = null;
  advancing = false;
  markedUpTo = 0;
  set({ ...EMPTY, rate: state.rate }); // the chosen speed outlives the queue
}

/* ---------------------------------- react ------------------------------------ */

export function useAudio(): AudioState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => EMPTY,
  );
}

/** Is the given chapter the one currently loaded in the player? */
export function isCurrentChapter(ho: string, chapter: number): boolean {
  const t = state.queue[state.index];
  return !!t && t.ho === ho && t.chapter === chapter;
}
