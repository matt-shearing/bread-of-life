/**
 * The playback ENGINE seam. The audio controller owns the queue, auto-advance, mark-read
 * and mini-player state; the engine only knows how to play ONE track and report progress.
 *
 * - `Html5Engine` (this file) plays via an `Audio()` element — used on desktop/browser and
 *   as the default. OS transport controls come from the web Media Session (in the controller).
 * - A future `NativeEngine` (Android/iOS) will implement this SAME interface on top of a
 *   native Media3 ExoPlayer + foreground MediaSessionService (e.g. tauri-plugin-native-audio),
 *   so true background playback + lock-screen controls come from the OS. It sets
 *   `usesWebMediaSession = false` so the controller skips the web Media Session there.
 *
 * Swapping engines is a drop-in: `selectEngine()` picks one; nothing else in the app changes.
 */

export interface EngineTrack {
  src: string;
  title: string;
  subtitle: string;
  artworkUrl?: string;
}

export interface EngineHandlers {
  onTime?: (seconds: number) => void;
  onDuration?: (seconds: number) => void;
  onEnded?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onLoading?: (loading: boolean) => void;
}

export interface AudioEngine {
  /** True if OS transport controls come from the web Media Session (Html5) rather than
   *  natively from the engine itself (native plugin). */
  readonly usesWebMediaSession: boolean;
  handlers: EngineHandlers;
  load(track: EngineTrack): void;
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  currentTime(): number;
  duration(): number;
  release(): void;
}

/** HTML5 `<audio>` engine — the default (desktop, browser, and mobile until the native
 *  engine is wired). Created lazily so nothing is instantiated at import time. */
export class Html5Engine implements AudioEngine {
  readonly usesWebMediaSession = true;
  handlers: EngineHandlers = {};
  private el: HTMLAudioElement | null = null;

  private audio(): HTMLAudioElement {
    if (this.el) return this.el;
    const el = new Audio();
    el.preload = "metadata";
    el.addEventListener("play", () => this.handlers.onPlay?.());
    el.addEventListener("pause", () => this.handlers.onPause?.());
    el.addEventListener("timeupdate", () => this.handlers.onTime?.(el.currentTime));
    el.addEventListener("durationchange", () => this.handlers.onDuration?.(Number.isFinite(el.duration) ? el.duration : 0));
    el.addEventListener("waiting", () => this.handlers.onLoading?.(true));
    el.addEventListener("playing", () => this.handlers.onLoading?.(false));
    el.addEventListener("canplay", () => this.handlers.onLoading?.(false));
    el.addEventListener("ended", () => this.handlers.onEnded?.());
    el.addEventListener("error", () => {
      this.handlers.onLoading?.(false);
      this.handlers.onPause?.();
    });
    this.el = el;
    return el;
  }

  load(track: EngineTrack) {
    this.audio().src = track.src;
  }
  play() {
    this.audio()
      .play()
      .catch(() => this.handlers.onPause?.());
  }
  pause() {
    this.audio().pause();
  }
  seekTo(seconds: number) {
    const a = this.audio();
    a.currentTime = Math.max(0, Math.min(seconds, a.duration || seconds));
  }
  currentTime() {
    return this.el?.currentTime ?? 0;
  }
  duration() {
    return this.el && Number.isFinite(this.el.duration) ? this.el.duration : 0;
  }
  release() {
    if (this.el) {
      this.el.pause();
      this.el.removeAttribute("src");
      this.el.load();
    }
  }
}

/** Pick the playback engine for this platform. For now always HTML5; the native engine
 *  slots in here once tauri-plugin-native-audio (or our own Media3 service) is wired. */
export function selectEngine(): AudioEngine {
  return new Html5Engine();
}
