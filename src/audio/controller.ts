import { useSyncExternalStore } from "react";
import { selectEngine, type AudioEngine } from "./engine";

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
}

const EMPTY: AudioState = { queue: [], index: -1, playing: false, currentTime: 0, duration: 0, loading: false };

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
  onEnded: () => {
    set({ playing: false });
    if (engine.supportsNativeQueue) {
      markThrough(state.queue.length); // whole playlist finished — mark the rest read
    } else {
      advanceQueue(); // HTML5: one track ended, step forward
    }
  },
};

function emit() {
  listeners.forEach((l) => l());
}
function set(patch: Partial<AudioState>) {
  state = { ...state, ...patch };
  emit();
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
    ms.setPositionState({ duration: dur, position: Math.min(engine.currentTime(), dur), playbackRate: 1 });
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
    engine.loadQueue(tracks.map((t) => ({ src: t.src, title: t.title, subtitle: t.subtitle })), start);
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
  else set({ playing: false }); // end of queue
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
  if (index >= 0 && index < state.queue.length) loadIndex(index, true);
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
  set({ ...EMPTY });
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
