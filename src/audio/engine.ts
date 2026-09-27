/**
 * The playback ENGINE seam. The audio controller owns the queue, auto-advance, mark-read
 * and mini-player state; an engine plays and reports progress. Three engines:
 *
 * - `Html5Engine` plays one track at a time through an `Audio()` element: the browser, and
 *   macOS/Windows Tauri, whose webviews play media in-process. OS transport controls come
 *   from the web Media Session (in the controller).
 * - `NativeEngine` (Android) hands the whole queue to the native audio plugin: Media3
 *   ExoPlayer in a MediaLibraryService, which advances by itself in the background and owns
 *   the lock screen, the notification, earphone buttons and Android Auto. See
 *   `src/audio/nativeAudio.ts` and `docs/NATIVE-AUDIO.md`.
 * - `TauriDesktopEngine` (Linux desktop) plays one track at a time in Rust: WebKitGTK routes
 *   `<audio>` through GStreamer and aborts the whole web process on a host without
 *   `gst-plugins-good`. See `src-tauri/src/desktop_audio.rs` and `docs/DESKTOP.md`.
 *
 * `selectEngine()` picks one; nothing else in the app changes.
 */
import { isLinuxDesktop, isTauri, isTauriAndroid } from "@/lib/platform";
import { nativeAudio, type NativeQueueItem, type NativeSnapshot } from "./nativeAudio";

export type { NativeQueueItem } from "./nativeAudio";

export interface EngineTrack {
  src: string;
  title: string;
  subtitle: string;
  artworkUrl?: string;
  /** Speech-engine tracks only: the words to say (see speechEngine.ts). */
  speech?: import("@/lib/devotionalSpeech").SpeechSegment[];
  /** Native only: names the item for Android Auto's Recent / Continue listening, the car's
   *  queue and native completions ("ch/JHN/3", a plan track id, "dev/<id>"; see
   *  nativeMediaId in controller.ts). */
  mediaId?: string;
  /** Native only: which of a plan day's readings this chapter belongs to ("Next reading"). */
  group?: number;
}

/** A transport command from outside the app: the Linux desktop's media keys (MPRIS). */
export type RemoteCommand =
  | { action: "play" | "pause" | "toggle" | "next" | "previous" | "stop" }
  | { action: "seek"; position: number }
  | { action: "seekBy"; offset: number };

export interface EngineHandlers {
  onTime?: (seconds: number) => void;
  onDuration?: (seconds: number) => void;
  onEnded?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onLoading?: (loading: boolean) => void;
  /** Native queue only: the native player moved to a new playlist index (by itself or a skip). */
  onIndexChange?: (index: number) => void;
  /** Native queue only: every index in the current queue that has played to its natural end
   *  (never one that was skipped). Repeats the whole list each time; the controller dedupes. */
  onFinished?: (indexes: number[]) => void;
  /** Native only: something outside the app (Android Auto, a voice request, the system's
   *  resume card) loaded a new queue, or the app started while one was already playing. */
  onExternalQueue?: (items: NativeQueueItem[], index: number) => void;
  /** Native only: the speed changed outside the app (the car's speed button). */
  onRate?: (rate: number) => void;
  /** Native only: plan chapters or devotionals native heard to the end are waiting to be recorded. */
  onPendingCompletions?: (count: number) => void;
  /** A media key or desktop media widget asked for something (Linux desktop). */
  onRemote?: (command: RemoteCommand) => void;
}

export interface AudioEngine {
  /** True if OS transport controls come from the web Media Session (Html5) rather than
   *  natively from the engine itself (native plugin, Rust MPRIS). */
  readonly usesWebMediaSession: boolean;
  /** True if the engine plays a whole PLAYLIST natively (advances itself, even in the
   *  background). When true the controller hands over the whole queue via `loadQueue` and
   *  lets the engine drive next/prev/skip; when false it drives one track at a time and
   *  the queue methods below are absent. */
  readonly supportsNativeQueue: boolean;
  handlers: EngineHandlers;
  /** One-track engines: load this track (paused). */
  load(track: EngineTrack): void;
  /** Native-queue engines only: load a whole playlist and play from startIndex. */
  loadQueue?(tracks: EngineTrack[], startIndex: number): void;
  /** Native-queue engines only: advance/rewind within the native playlist. */
  queueNext?(): void;
  queuePrev?(): void;
  /** Native-queue engines only: jump to `index` of the loaded playlist and play. `tracks` is
   *  the whole queue again, used only if native no longer holds the queue the app thinks. */
  queueSkipTo?(index: number, tracks: EngineTrack[]): void;
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  /** True if `setRate` works on this engine. Optional so engines without it need no stub. */
  readonly supportsRate?: boolean;
  /** Playback speed (1 = normal). Keeps applying to later tracks until changed. */
  setRate?(rate: number): void;
  currentTime(): number;
  duration(): number;
  /** Stop and forget the track (and, on native, the whole queue). */
  release(): void;
}

/** HTML5 `<audio>` engine — the default (browser, and macOS/Windows Tauri, whose webviews
 *  play media in-process). Created lazily so nothing is instantiated at import time. */
export class Html5Engine implements AudioEngine {
  readonly usesWebMediaSession = true;
  readonly supportsNativeQueue = false;
  readonly supportsRate = true;
  handlers: EngineHandlers = {};
  private el: HTMLAudioElement | null = null;
  private rate = 1;

  private audio(): HTMLAudioElement {
    if (this.el) return this.el;
    const el = new Audio();
    el.preload = "metadata";
    el.defaultPlaybackRate = this.rate;
    el.playbackRate = this.rate;
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
  setRate(rate: number) {
    this.rate = rate;
    if (!this.el) return;
    // A new `src` resets playbackRate to defaultPlaybackRate, so set both.
    this.el.defaultPlaybackRate = rate;
    this.el.playbackRate = rate;
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

/**
 * Android engine — the native audio plugin (Media3 ExoPlayer + a MediaLibraryService), so
 * audio keeps going when the app is backgrounded or closed and the OS shows lock-screen
 * controls. The plugin owns the OS controls, so `usesWebMediaSession = false`.
 *
 * Nothing native is built until the first playback: the constructor only listens for state
 * events and asks once whether something already plays (the car, or the service outliving
 * an earlier app session), neither of which creates the player or asks for the notification
 * permission. `initialize` (player, session, permission prompt) runs on the first play.
 */
class NativeEngine implements AudioEngine {
  readonly usesWebMediaSession = false;
  readonly supportsNativeQueue = true;
  readonly supportsRate = true;
  handlers: EngineHandlers = {};
  /** The state listener is registered. */
  private listening: Promise<boolean>;
  /** `initialize` has run (created on the first playback command). */
  private initialized: Promise<boolean> | null = null;
  private cur = 0;
  private dur = 0;
  private loading = false;
  private idx = 0;
  private wasPlaying = false;
  private ended = false;
  /** Native capture time (ms, monotonic) of the newest state applied. */
  private lastCapturedAt = -1;
  /** Native's queue generation last seen, and whether we are fetching a queue to adopt. */
  private seenNativeGen = -1;
  private adopting = false;
  /**
   * Events from queue generations older than this are ignored. `loadQueue` sets it past the
   * generation it replaces: ticks native captured before `set_queue` landed still carry the
   * old queue's index, and taking one as "the player advanced" marked skipped chapters read
   * or flicked the mini-player to the old chapter.
   */
  private minGen = 0;
  /** While a `skip_to` is in flight, the index it goes to. Events still showing another index
   *  were captured before the skip; the command's own reply (or the first event at the
   *  target) ends the wait, so nothing needs a timer. */
  private pendingIndex: number | null = null;
  /** The app has a queue loaded in native (false before the first play and after stop). */
  private hasQueue = false;
  /** Bumped by every loadQueue, so a superseded set_queue's reply is ignored. */
  private loadSeq = 0;
  private rate = 1;
  /** Length of native's `finished` list last passed on (it only grows within a queue). */
  private finishedSeen = -1;

  constructor() {
    this.listening = nativeAudio
      .onState((s) => this.onState(s))
      .then(() => true)
      .catch(() => false); // plugin unavailable: every call no-ops
    // The app may start while the car (or an earlier app session) is already playing:
    // take native's state once, so a queue started without us is adopted.
    this.resync();
    // The player keeps going while the WebView is frozen in the background, and it can be
    // paused or resumed from earphones, the lock screen or the notification without JS
    // hearing about it (native sends no timed events while the app is not visible). When
    // the app comes back, take native's word for everything.
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this.resync();
      });
    }
  }

  /** Build the native player on first use (see the class comment). */
  private ready(): Promise<boolean> {
    this.initialized ??= this.listening.then(async (ok) => {
      if (!ok) return false;
      try {
        await nativeAudio.initialize();
        return true;
      } catch {
        return false;
      }
    });
    return this.initialized;
  }

  /** Replace what JS believes with the native player's current snapshot. */
  resync() {
    void this.listening.then(async (ok) => {
      if (!ok) return;
      try {
        this.onState(await nativeAudio.getState(), true);
      } catch {
        /* keep the last known state */
      }
    });
  }

  private onState(s: NativeSnapshot, authoritative = false) {
    // Events queued while the WebView was frozen can arrive after a fresher snapshot;
    // anything captured earlier than what we already applied is stale.
    if (typeof s.capturedAtMs === "number") {
      if (s.capturedAtMs < this.lastCapturedAt) return;
      this.lastCapturedAt = s.capturedAtMs;
    }
    if (typeof s.pendingCompletions === "number" && s.pendingCompletions > 0) {
      this.handlers.onPendingCompletions?.(s.pendingCompletions);
    }
    if (typeof s.rate === "number" && s.rate > 0 && Math.abs(s.rate - this.rate) > 0.001) {
      this.rate = s.rate;
      this.handlers.onRate?.(s.rate);
    }
    const gen = typeof s.queueGeneration === "number" ? s.queueGeneration : null;
    if (gen !== null && gen < this.minGen) return; // from a queue the app has replaced
    // A queue the app did not load: the car started one, or the app has just started and
    // native was already playing. Its indexes mean nothing against our queue, so adopt it
    // before anything is taken as "the player advanced" (which marks chapters read).
    if (gen !== null && gen !== this.seenNativeGen) {
      const firstLook = this.seenNativeGen < 0;
      this.seenNativeGen = gen;
      const external = s.queueOrigin === "external" || s.queueOrigin === "car";
      if (external || (firstLook && !this.hasQueue && gen > 0)) {
        this.adopting = true;
        this.hasQueue = true;
        void this.adoptNativeQueue(gen);
      }
    }
    // Nothing of ours is loaded (before the first play, or after stop): native's state
    // belongs to no queue the app shows.
    if (!this.hasQueue) return;
    if (this.pendingIndex !== null) {
      if (s.index !== this.pendingIndex) return; // captured before the skip landed
      this.pendingIndex = null;
    }
    if (this.adopting) {
      // Keep time and play state live; the index is applied with the adopted queue.
      if (typeof s.index === "number") this.idx = s.index;
      this.ended = s.status === "ended";
    }
    // Only what changed goes on: most ticks move the time and nothing else.
    if (s.currentTime !== this.cur) {
      this.cur = s.currentTime;
      this.handlers.onTime?.(s.currentTime);
    }
    if (s.duration && s.duration !== this.dur) {
      this.dur = s.duration;
      this.handlers.onDuration?.(s.duration);
    }
    const loading = s.buffering || s.status === "loading";
    if (loading !== this.loading || authoritative) {
      this.loading = loading;
      this.handlers.onLoading?.(loading);
    }
    if (authoritative || s.isPlaying !== this.wasPlaying) {
      this.wasPlaying = s.isPlaying;
      (s.isPlaying ? this.handlers.onPlay : this.handlers.onPause)?.();
    }
    if (this.adopting) return;
    // Chapters heard to their end, before the index moves on, so they are marked in order.
    if (Array.isArray(s.finished) && s.finished.length !== this.finishedSeen) {
      this.finishedSeen = s.finished.length;
      this.handlers.onFinished?.(s.finished);
    }
    // The native player moved to another playlist item (background-safe).
    const index = s.index;
    if (typeof index === "number" && index !== this.idx) {
      this.idx = index;
      this.handlers.onIndexChange?.(index);
    }
    if (s.status === "ended" && !this.ended) {
      this.ended = true;
      this.handlers.onEnded?.();
    } else if (s.status !== "ended") {
      this.ended = false;
    }
  }

  /** Fetch the native queue and hand it to the controller as its own. */
  private async adoptNativeQueue(gen: number) {
    try {
      const q = await nativeAudio.getQueue();
      if (gen !== this.seenNativeGen || gen < this.minGen) return; // superseded
      this.idx = q.index;
      this.finishedSeen = -1;
      if (q.items.length) this.handlers.onExternalQueue?.(q.items, q.index);
      else this.hasQueue = false;
    } catch {
      /* keep what we had */
    } finally {
      if (gen === this.seenNativeGen) this.adopting = false;
    }
  }

  private resetTrack(index: number) {
    this.cur = 0;
    this.dur = 0;
    this.ended = false;
    this.idx = index;
  }

  loadQueue(tracks: EngineTrack[], startIndex: number) {
    this.resetTrack(startIndex);
    this.finishedSeen = -1;
    this.pendingIndex = null;
    this.hasQueue = true;
    this.adopting = false;
    // Whatever native reports from the queue loaded so far is stale from here on.
    if (this.seenNativeGen >= 0) this.minGen = Math.max(this.minGen, this.seenNativeGen + 1);
    const seq = ++this.loadSeq;
    void this.ready().then(async (ok) => {
      if (!ok) return this.handlers.onPause?.();
      try {
        const snapshot = await nativeAudio.setQueue(
          tracks.map((t) => ({
            src: splitOffset(t.src).src,
            title: t.title,
            artist: t.subtitle,
            artworkUrl: t.artworkUrl,
            mediaId: t.mediaId,
            group: t.group,
          })),
          startIndex,
        );
        if (seq !== this.loadSeq) return; // a newer queue owns the player now
        if (typeof snapshot?.queueGeneration === "number") {
          // Exactly the generation this queue got: anything older is stale.
          this.minGen = Math.max(this.minGen, snapshot.queueGeneration);
          this.seenNativeGen = snapshot.queueGeneration;
        }
        if (snapshot && typeof snapshot.currentTime === "number") this.onState(snapshot);
        // Missler chapters can start mid-file (a #t= hint); ExoPlayer ignores the
        // fragment, so the start track is played through skip_to with its offset.
        const off = splitOffset(tracks[startIndex]?.src ?? "").startSec;
        if (off > 0) await nativeAudio.skipTo(startIndex, off, this.seenNativeGen);
        else await nativeAudio.play();
      } catch {
        if (seq !== this.loadSeq) return;
        this.handlers.onPause?.();
      }
    });
  }

  queueSkipTo(index: number, tracks: EngineTrack[]) {
    if (!this.hasQueue || this.adopting) return this.loadQueue(tracks, index);
    this.resetTrack(index);
    this.pendingIndex = index;
    const startSec = splitOffset(tracks[index]?.src ?? "").startSec;
    const gen = this.seenNativeGen >= 0 ? this.seenNativeGen : undefined;
    void this.ready().then(async (ok) => {
      if (!ok) return;
      try {
        const snapshot = await nativeAudio.skipTo(index, startSec, gen);
        if (this.pendingIndex === index) this.pendingIndex = null;
        this.onState(snapshot);
      } catch {
        // Native no longer holds the queue the app shows (or the command failed): hand
        // the whole queue over again, starting at the chosen track.
        if (this.pendingIndex !== index) return; // a newer skip owns the player now
        this.pendingIndex = null;
        this.loadQueue(tracks, index);
      }
    });
  }

  // Every plugin call is awaited + caught, so a native error surfaces as "paused"
  // instead of an unhandled rejection / crash (esp. during track transitions).
  private run(fn: () => Promise<unknown>) {
    void this.ready().then(async (ok) => {
      if (!ok) return;
      try {
        await fn();
      } catch {
        this.handlers.onPause?.();
      }
    });
  }
  queueNext() {
    this.run(() => nativeAudio.next());
  }
  queuePrev() {
    this.run(() => nativeAudio.previous());
  }
  /** Native holds the queue; a single-track load has no meaning here. */
  load() {}
  play() {
    this.run(() => nativeAudio.play());
  }
  pause() {
    this.run(() => nativeAudio.pause());
  }
  seekTo(seconds: number) {
    this.cur = seconds;
    this.run(() => nativeAudio.seekTo(seconds));
  }
  setRate(rate: number) {
    // ExoPlayer's speed belongs to the player, not the item, so it carries across the queue.
    this.rate = rate;
    this.run(() => nativeAudio.setRate(rate));
  }
  currentTime() {
    return this.cur;
  }
  duration() {
    return this.dur;
  }
  /** The mini-player's ✕: unload the queue natively, not just pause it. */
  release() {
    const had = this.hasQueue;
    this.hasQueue = false;
    this.pendingIndex = null;
    this.adopting = false;
    this.resetTrack(0);
    this.wasPlaying = false;
    this.finishedSeen = -1;
    // Whatever the old queue still reports is stale; stop moves native's generation on.
    if (this.seenNativeGen >= 0) this.minGen = Math.max(this.minGen, this.seenNativeGen + 1);
    this.loadSeq++;
    if (!had) return;
    // Also for a queue adopted from the car before the app ever played (no initialize).
    void this.listening.then((ok) => (ok ? nativeAudio.stop() : undefined)).catch(() => {});
  }
}

/** What `desktop_audio_state` reports (see `src-tauri/src/desktop_audio.rs`). */
interface DesktopAudioState {
  position: number;
  duration: number;
  playing: boolean;
  loading: boolean;
  ended: boolean;
  error: string | null;
  /** Bumped by every load — lets us tell a fresh "ended" from a stale poll. */
  generation: number;
}

type Invoke = typeof import("@tauri-apps/api/core").invoke;

/** How often the Linux engine polls Rust while something plays or loads. */
const DESKTOP_POLL_MS = 250;
/** After a command, keep polling at least this long before concluding playback is idle. */
const DESKTOP_POLL_GRACE_MS = 1500;

/**
 * Linux desktop engine — playback happens in Rust (rodio → cpal → ALSA), never in the
 * webview. WebKitGTK plays an `<audio>` element through GStreamer, and a host without
 * `gst-plugins-good` has no HTTP source, no MP3 parser and no audio sink; rather than
 * failing the element, WebKit aborts its own web process, so pressing Listen turns the
 * window white. Playing in Rust drops the app's dependency on the host's GStreamer.
 *
 * Rust holds one track at a time, so `supportsNativeQueue = false` and the controller
 * keeps driving the queue exactly as it does for HTML5. There is no state event to
 * subscribe to, so this polls `desktop_audio_state` every 250 ms while a track plays or
 * loads (the rate an `<audio>` element fires `timeupdate` at), and not at all while it is
 * paused or stopped.
 *
 * `desktop_audio_load` returns at once and fetches in the background, and Rust drops a
 * fetch a newer load has replaced, so pressing Next five times does not download four
 * chapters first. A play sent while the track loads is remembered by Rust and applied
 * when it is ready.
 *
 * OS media keys and the desktop's media widget come from Rust too (MPRIS on Linux), since
 * WebKitGTK only publishes a Media Session for an `<audio>` element that plays: Rust sends
 * `desktop-media-control` events, which become `onRemote`. So `usesWebMediaSession` is false.
 */
class TauriDesktopEngine implements AudioEngine {
  readonly usesWebMediaSession = false;
  readonly supportsNativeQueue = false;
  handlers: EngineHandlers = {};

  private invoke: Invoke | null = null;
  private ready: Promise<void>;
  /** Commands keep their order. Each returns at once (a load fetches in the background). */
  private chain: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private pollUntil = 0;
  private cur = 0;
  private dur = 0;
  private wasPlaying = false;
  private wasLoading = false;
  private endedGeneration = -1;
  private errorGeneration = -1;
  private remote: Promise<unknown> | null = null;

  constructor(invoke?: Invoke) {
    this.ready = invoke
      ? Promise.resolve().then(() => void (this.invoke = invoke))
      : import("@tauri-apps/api/core")
          .then(({ invoke }) => {
            this.invoke = invoke;
          })
          .catch(() => {
            /* not in Tauri after all — every call no-ops */
          });
  }

  private run(fn: (invoke: Invoke) => Promise<unknown>) {
    this.chain = this.chain.then(async () => {
      await this.ready;
      if (!this.invoke) return;
      try {
        await fn(this.invoke);
      } catch {
        // A failed command surfaces as "paused", like an <audio> error event.
        this.handlers.onLoading?.(false);
        this.handlers.onPause?.();
      }
    });
  }

  /** Media keys (MPRIS), subscribed on the first load. */
  private listenForMediaKeys() {
    this.remote ??= import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ action: string; position?: number; offset?: number }>("desktop-media-control", (e) => {
          const { action, position, offset } = e.payload;
          if (action === "seek" && typeof position === "number") this.handlers.onRemote?.({ action, position });
          else if (action === "seekBy" && typeof offset === "number") this.handlers.onRemote?.({ action, offset });
          else if (["play", "pause", "toggle", "next", "previous", "stop"].includes(action)) {
            this.handlers.onRemote?.({ action } as RemoteCommand);
          }
        }),
      )
      .catch(() => null);
  }

  /** Poll while something plays or loads, and for a short while after any command. */
  private keepPolling() {
    this.pollUntil = Date.now() + DESKTOP_POLL_GRACE_MS;
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.poll(), DESKTOP_POLL_MS);
  }

  private stopPolling() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Deliberately NOT on `chain`, so progress keeps coming whatever the commands do. */
  async poll() {
    if (this.polling) return; // a slow reply must not let two polls answer out of order
    await this.ready;
    if (!this.invoke) return;
    let s: DesktopAudioState;
    this.polling = true;
    try {
      s = await this.invoke<DesktopAudioState>("desktop_audio_state");
    } catch {
      return;
    } finally {
      this.polling = false;
    }

    if (s.position !== this.cur) {
      this.cur = s.position;
      this.handlers.onTime?.(s.position);
    }
    if (s.duration > 0 && s.duration !== this.dur) {
      this.dur = s.duration;
      this.handlers.onDuration?.(s.duration);
    }
    if (s.loading !== this.wasLoading) {
      this.wasLoading = s.loading;
      this.handlers.onLoading?.(s.loading);
    }
    if (s.playing !== this.wasPlaying) {
      this.wasPlaying = s.playing;
      (s.playing ? this.handlers.onPlay : this.handlers.onPause)?.();
    }
    if (s.error && s.generation !== this.errorGeneration) {
      this.errorGeneration = s.generation;
      this.handlers.onLoading?.(false);
      this.handlers.onPause?.();
    }
    if (s.ended && s.generation !== this.endedGeneration) {
      this.endedGeneration = s.generation;
      this.handlers.onEnded?.();
    }
    // Paused, finished or failed: nothing will change until the next command.
    if (!s.playing && !s.loading && Date.now() > this.pollUntil) this.stopPolling();
  }

  load(track: EngineTrack) {
    // Rust takes the URL literally, so the "#t=" start hint travels as a seek target —
    // the same split the native mobile engine does.
    const { src, startSec } = splitOffset(track.src);
    this.cur = startSec;
    this.dur = 0;
    this.wasPlaying = false;
    this.wasLoading = true;
    this.handlers.onLoading?.(true);
    this.listenForMediaKeys();
    this.keepPolling();
    this.run((invoke) =>
      invoke("desktop_audio_load", { url: src, startSec, title: track.title, artist: track.subtitle }),
    );
  }
  play() {
    this.keepPolling();
    this.run((invoke) => invoke("desktop_audio_play"));
  }
  pause() {
    this.keepPolling();
    this.run((invoke) => invoke("desktop_audio_pause"));
  }
  seekTo(seconds: number) {
    const position = Math.max(0, this.dur > 0 ? Math.min(seconds, this.dur) : seconds);
    this.cur = position;
    this.keepPolling();
    this.run((invoke) => invoke("desktop_audio_seek", { position }));
  }
  currentTime() {
    return this.cur;
  }
  duration() {
    return this.dur;
  }
  release() {
    this.stopPolling();
    this.cur = 0;
    this.dur = 0;
    this.wasPlaying = false;
    this.wasLoading = false;
    this.run((invoke) => invoke("desktop_audio_stop"));
  }
}

/** For scripts/test-audio-queue.mjs: the Linux engine over a stub `invoke`. */
export function createDesktopEngineForTest(invoke: Invoke): AudioEngine & { poll(): Promise<void> } {
  return new TauriDesktopEngine(invoke);
}

/** Split a trailing "#t=<seconds>" media-fragment start hint off a URI. The native
 *  ExoPlayer and the Rust desktop player both take the URI literally (unlike the HTML5
 *  <audio> element, which honors the fragment), so the offset is applied as a seek. */
function splitOffset(src: string): { src: string; startSec: number } {
  const m = /#t=(\d+(?:\.\d+)?)$/.exec(src);
  return m ? { src: src.slice(0, m.index), startSec: parseFloat(m[1]) } : { src, startSec: 0 };
}

/**
 * Pick the playback engine:
 * - the Android app → `NativeEngine` (background playback, OS-owned transport controls);
 * - Linux Tauri → `TauriDesktopEngine`, because WebKitGTK's `<audio>` can kill the webview;
 * - everything else (browser, macOS/Windows Tauri) → `Html5Engine`. WKWebView and WebView2
 *   play media in-process, with nothing to work around.
 */
export function selectEngine(): AudioEngine {
  if (isTauriAndroid) return new NativeEngine();
  if (isTauri && isLinuxDesktop) return new TauriDesktopEngine();
  return new Html5Engine();
}
