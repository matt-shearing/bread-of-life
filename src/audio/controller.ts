import { useSyncExternalStore } from "react";

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
let el: HTMLAudioElement | null = null;

function emit() {
  listeners.forEach((l) => l());
}
function set(patch: Partial<AudioState>) {
  state = { ...state, ...patch };
  emit();
}

function audio(): HTMLAudioElement {
  if (el) return el;
  el = new Audio();
  el.preload = "metadata";
  el.addEventListener("play", () => {
    set({ playing: true });
    setMediaPlaybackState("playing");
  });
  el.addEventListener("pause", () => {
    set({ playing: false });
    setMediaPlaybackState("paused");
  });
  el.addEventListener("timeupdate", () => {
    set({ currentTime: el!.currentTime });
    syncPositionState();
  });
  el.addEventListener("durationchange", () => set({ duration: Number.isFinite(el!.duration) ? el!.duration : 0 }));
  el.addEventListener("waiting", () => set({ loading: true }));
  el.addEventListener("playing", () => set({ loading: false }));
  el.addEventListener("canplay", () => set({ loading: false }));
  el.addEventListener("ended", () => {
    const finished = state.queue[state.index];
    if (finished && onTrackComplete) onTrackComplete(finished, state.index); // e.g. mark the plan reading read
    next();
  });
  el.addEventListener("error", () => set({ loading: false, playing: false }));
  return el;
}

/* -------------------------------- media session ------------------------------- */

function mediaSession(): MediaSession | null {
  return typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null;
}
function setMediaPlaybackState(s: "playing" | "paused" | "none") {
  const ms = mediaSession();
  if (ms) ms.playbackState = s;
}
function syncPositionState() {
  const ms = mediaSession();
  if (!ms || !el || !Number.isFinite(el.duration) || el.duration <= 0) return;
  try {
    ms.setPositionState({ duration: el.duration, position: Math.min(el.currentTime, el.duration), playbackRate: el.playbackRate });
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
  const a = audio();
  a.src = t.src;
  set({ index, currentTime: 0, duration: 0, loading: true });
  setMediaMetadata(t);
  if (autoplay) a.play().catch(() => set({ playing: false, loading: false }));
}

/** Start a fresh queue at `startIndex` and play. `onComplete` fires each time a track
 *  finishes naturally (used by the plan reader to mark readings done). */
export function playQueue(tracks: Track[], opts?: { startIndex?: number; onComplete?: TrackCompleteHandler }) {
  if (!tracks.length) return;
  onTrackComplete = opts?.onComplete ?? null;
  set({ queue: tracks });
  loadIndex(Math.max(0, Math.min(opts?.startIndex ?? 0, tracks.length - 1)), true);
}

export function play() {
  audio().play().catch(() => set({ playing: false }));
}
export function pause() {
  audio().pause();
}
export function toggle() {
  if (state.playing) pause();
  else play();
}
export function next() {
  if (state.index < state.queue.length - 1) loadIndex(state.index + 1, true);
  else set({ playing: false }); // end of queue
}
export function prev() {
  // restart current if we're >3s in, else go to the previous track
  if (el && el.currentTime > 3) {
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
  const a = audio();
  a.currentTime = Math.max(0, Math.min(sec, a.duration || sec));
  set({ currentTime: a.currentTime });
}
export function seekBy(delta: number) {
  seekTo((el?.currentTime ?? 0) + delta);
}
export function stop() {
  if (el) {
    el.pause();
    el.removeAttribute("src");
    el.load();
  }
  setMediaPlaybackState("none");
  const ms = mediaSession();
  if (ms) ms.metadata = null;
  onTrackComplete = null;
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
