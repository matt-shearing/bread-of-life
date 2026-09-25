/**
 * The playback ENGINE seam. The audio controller owns the queue, auto-advance, mark-read
 * and mini-player state; the engine only knows how to play ONE track and report progress.
 *
 * - `Html5Engine` (this file) plays via an `Audio()` element — the default for the browser
 *   and for macOS/Windows Tauri. OS transport controls come from the web Media Session
 *   (in the controller).
 * - `TauriDesktopEngine` plays through Rust instead, on Linux Tauri: WebKitGTK routes
 *   `<audio>` through GStreamer and aborts the whole web process on a host without
 *   `gst-plugins-good`. See `src-tauri/src/desktop_audio.rs` and `docs/DESKTOP.md`.
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
  /** Speech-engine tracks only: the words to say (see speechEngine.ts). */
  speech?: import("@/lib/devotionalSpeech").SpeechSegment[];
  /** Native only: names the item for Android Auto's Recent / Continue listening and the
   *  car's queue ("ch/JHN/3", or a plan track id; see nativeMediaId in queue.ts). */
  mediaId?: string;
  /** Native only: which of a plan day's readings this chapter belongs to ("Next reading"). */
  group?: number;
}

/** A queue item as the native player reports it (see the plugin's `get_queue`). */
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

export interface EngineHandlers {
  onTime?: (seconds: number) => void;
  onDuration?: (seconds: number) => void;
  onEnded?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onLoading?: (loading: boolean) => void;
  /** Native queue only: the native player advanced to a new playlist index. */
  onIndexChange?: (index: number) => void;
  /** Native only: something outside the app (Android Auto, a voice request, the system's
   *  resume card) loaded a new queue, or the app started while one was already playing. */
  onExternalQueue?: (items: NativeQueueItem[], index: number) => void;
  /** Native only: the speed changed outside the app (the car's speed button). */
  onRate?: (rate: number) => void;
  /** Native only: plan chapters finished in the car are waiting to be recorded. */
  onPendingCompletions?: (count: number) => void;
}

export interface AudioEngine {
  /** True if OS transport controls come from the web Media Session (Html5) rather than
   *  natively from the engine itself (native plugin). */
  readonly usesWebMediaSession: boolean;
  /** True if the engine plays a whole PLAYLIST natively (advances itself, even in the
   *  background). When true the controller hands over the whole queue via loadQueue and
   *  lets the engine drive next/prev; when false it drives one track at a time. */
  readonly supportsNativeQueue: boolean;
  handlers: EngineHandlers;
  load(track: EngineTrack): void;
  /** Native-queue engines only: load a whole playlist and start at startIndex. */
  loadQueue(tracks: EngineTrack[], startIndex: number): void;
  play(): void;
  pause(): void;
  /** Native-queue engines only: advance/rewind within the native playlist. */
  queueNext(): void;
  queuePrev(): void;
  seekTo(seconds: number): void;
  /** True if `setRate` works on this engine. Optional so engines without it need no stub. */
  readonly supportsRate?: boolean;
  /** Playback speed (1 = normal). Keeps applying to later tracks until changed. */
  setRate?(rate: number): void;
  currentTime(): number;
  duration(): number;
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

  // Html5 plays one track at a time; the controller drives the queue, so these are no-ops.
  loadQueue() {}
  queueNext() {}
  queuePrev() {}

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
 * Native mobile engine — plays through `tauri-plugin-native-audio` (Media3 ExoPlayer +
 * a foreground MediaSessionService on Android), so audio keeps going when the app is
 * backgrounded/closed and the OS shows lock-screen controls. The plugin owns the OS
 * controls, so `usesWebMediaSession = false`. The plugin API is DYNAMICALLY imported so
 * it's a separate chunk that never loads on desktop/browser.
 */
class NativeEngine implements AudioEngine {
  readonly usesWebMediaSession = false;
  readonly supportsNativeQueue = true;
  readonly supportsRate = true;
  handlers: EngineHandlers = {};
  private api: typeof import("tauri-plugin-native-audio-api") | null = null;
  private invoke: typeof import("@tauri-apps/api/core").invoke | null = null;
  private ready: Promise<void>;
  private cur = 0;
  private dur = 0;
  private idx = 0;
  private wasPlaying = false;
  private ended = false;
  /** Native capture time (ms, monotonic) of the newest state applied. */
  private lastCapturedAt = -1;
  /**
   * Bumped by every `loadQueue`. While a `set_queue` is in flight, state events are
   * ignored: ticks native captured before the new playlist landed still carry the OLD
   * index, and taking them as "the player advanced" marked skipped chapters read (a jump
   * back) or flicked the mini-player to the old chapter (a jump forward). The command's
   * own reply, a snapshot taken after the switch, is applied when it resolves.
   */
  private queueGen = 0;
  private queueSwitching = false;
  /** Native's queue generation last seen, and whether we are fetching a queue to adopt. */
  private seenNativeGen = -1;
  private adopting = false;
  private rate = 1;

  constructor() {
    this.ready = (async () => {
      const [api, core] = await Promise.all([
        import("tauri-plugin-native-audio-api"),
        import("@tauri-apps/api/core"),
      ]);
      await api.initialize();
      await api.addStateListener((s) => this.onState(s));
      this.invoke = core.invoke;
      this.api = api;
    })().catch(() => {
      /* plugin unavailable — leave api null; calls no-op */
    });
    // The app may start while the car (or an earlier app session) is already playing:
    // take native's state once, so a queue started without us is adopted.
    this.resync();
    // The player keeps going while the WebView is frozen in the background, and it can be
    // paused or resumed from earphones, the lock screen or the notification without JS
    // hearing about it in time. When the app comes back, take native's word for everything.
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this.resync();
      });
    }
  }

  /** Replace what JS believes with the native player's current snapshot. */
  resync() {
    void this.ready.then(async () => {
      if (!this.api) return;
      try {
        this.onState(await this.api.getState(), true);
      } catch {
        /* keep the last known state */
      }
    });
  }

  private onState(s: NativeSnapshot, authoritative = false) {
    if (this.queueSwitching) return;
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
    // A queue the app did not load: the car started one, or the app has just started and
    // native was already playing. Its indexes mean nothing against our queue, so adopt it
    // before anything is taken as "the player advanced" (which marks chapters read).
    if (typeof s.queueGeneration === "number" && s.queueGeneration !== this.seenNativeGen) {
      const firstLook = this.seenNativeGen < 0;
      this.seenNativeGen = s.queueGeneration;
      if (s.queueOrigin === "car" || (firstLook && this.queueGen === 0 && s.queueGeneration > 0)) {
        this.adopting = true;
        void this.adoptNativeQueue(s.queueGeneration);
      }
    }
    if (this.adopting) {
      // Keep time and play state live; the index is applied with the adopted queue.
      if (typeof s.index === "number") this.idx = s.index;
      this.ended = s.status === "ended";
    }
    this.cur = s.currentTime;
    if (s.duration) this.dur = s.duration;
    this.handlers.onTime?.(s.currentTime);
    if (s.duration) this.handlers.onDuration?.(s.duration);
    this.handlers.onLoading?.(s.buffering || s.status === "loading");
    if (authoritative || s.isPlaying !== this.wasPlaying) {
      this.wasPlaying = s.isPlaying;
      (s.isPlaying ? this.handlers.onPlay : this.handlers.onPause)?.();
    }
    // The native player advanced to a new playlist item on its own (background-safe).
    const index = s.index;
    if (this.adopting) return;
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
    await this.ready;
    try {
      const q = await this.invoke?.<{ items: NativeQueueItem[]; index: number; queueGeneration: number }>(
        "plugin:native-audio|get_queue",
      );
      if (!q || gen !== this.seenNativeGen || this.queueSwitching) return; // superseded
      this.idx = q.index;
      if (q.items.length) this.handlers.onExternalQueue?.(q.items, q.index);
    } catch {
      /* keep what we had */
    } finally {
      if (gen === this.seenNativeGen) this.adopting = false;
    }
  }

  loadQueue(tracks: EngineTrack[], startIndex: number) {
    this.cur = 0;
    this.dur = 0;
    this.ended = false;
    this.idx = startIndex;
    const gen = ++this.queueGen;
    this.queueSwitching = true;
    const settle = (snapshot?: unknown) => {
      if (gen !== this.queueGen) return; // a newer jump owns the player now
      this.queueSwitching = false;
      const s = snapshot as NativeSnapshot | null | undefined;
      if (s && typeof s === "object" && typeof s.currentTime === "number") this.onState(s);
    };
    // Never go deaf for good if the command hangs: after a few seconds, listen again.
    setTimeout(() => settle(), 5000);
    void this.ready.then(async () => {
      if (!this.invoke) return settle();
      try {
        const snapshot = await this.invoke<NativeSnapshot>("plugin:native-audio|set_queue", {
          items: tracks.map((t) => {
            const { src } = splitOffset(t.src);
            return { src, title: t.title, artist: t.subtitle, artworkUrl: t.artworkUrl, mediaId: t.mediaId, group: t.group };
          }),
          startIndex,
        });
        if (snapshot && typeof snapshot.queueGeneration === "number") this.seenNativeGen = snapshot.queueGeneration;
        settle(snapshot);
        if (gen !== this.queueGen) return; // superseded: that jump plays its own queue
        await this.api?.play();
        // Missler chapters can start mid-file (#t= hint) — ExoPlayer ignores the
        // fragment, so seek the start track ourselves.
        const off = splitOffset(tracks[startIndex]?.src ?? "").startSec;
        if (off > 0) await this.api?.seekTo(off);
      } catch {
        if (gen !== this.queueGen) return;
        settle();
        this.handlers.onPause?.();
      }
    });
  }
  queueNext() {
    void this.ready.then(() => this.invoke?.("plugin:native-audio|next").catch(() => {}));
  }
  queuePrev() {
    void this.ready.then(() => this.invoke?.("plugin:native-audio|previous").catch(() => {}));
  }

  // Every plugin call is awaited + caught, so a native error surfaces as "paused"
  // instead of an unhandled rejection / crash (esp. during track transitions).
  private run(fn: (api: NonNullable<NativeEngine["api"]>) => Promise<unknown>) {
    void this.ready.then(async () => {
      if (!this.api) return;
      try {
        await fn(this.api);
      } catch {
        this.handlers.onPause?.();
      }
    });
  }
  load(t: EngineTrack) {
    this.cur = 0;
    this.dur = 0;
    this.ended = false;
    const { src, startSec } = splitOffset(t.src);
    this.run(async (api) => {
      await api.setSource({ src, title: t.title, artist: t.subtitle, artworkUrl: t.artworkUrl });
      if (startSec > 0) await api.seekTo(startSec);
    });
  }
  play() {
    this.run((api) => api.play());
  }
  pause() {
    this.run((api) => api.pause());
  }
  seekTo(seconds: number) {
    this.cur = seconds;
    this.run((api) => api.seekTo(seconds));
  }
  setRate(rate: number) {
    // ExoPlayer's speed belongs to the player, not the item, so it carries across the queue.
    this.rate = rate;
    this.run((api) => api.setRate(rate));
  }
  currentTime() {
    return this.cur;
  }
  duration() {
    return this.dur;
  }
  release() {
    this.run((api) => api.pause());
  }
}

/** The plugin's state event, plus the fields our vendored plugin adds to it. */
type NativeSnapshot = import("tauri-plugin-native-audio-api").NativeAudioState & {
  /** Position in the native playlist. */
  index?: number;
  /** When native took this snapshot (monotonic ms). Orders events against `getState`. */
  capturedAtMs?: number;
  /** Bumped by every queue change; with `queueOrigin`, tells the app of a car-started queue. */
  queueGeneration?: number;
  queueOrigin?: "app" | "car";
  /** Plan chapters finished in the car, waiting for the app (take_car_completions). */
  pendingCompletions?: number;
};

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

/**
 * Linux desktop engine — playback happens in Rust (rodio → cpal → ALSA), never in the
 * webview. WebKitGTK plays an `<audio>` element through GStreamer, and a host without
 * `gst-plugins-good` has no HTTP source, no MP3 parser and no audio sink; rather than
 * failing the element, WebKit aborts its own web process, so pressing Listen turns the
 * window white. Playing in Rust drops the app's dependency on the host's GStreamer.
 *
 * Rust holds one track at a time, so `supportsNativeQueue = false` and the controller
 * keeps driving the queue exactly as it does for HTML5. There is no state event to
 * subscribe to, so this polls `desktop_audio_state` every 250 ms — the rate an `<audio>`
 * element fires `timeupdate` at — and turns the diffs into `EngineHandlers` calls.
 *
 * `usesWebMediaSession` stays true. What aborts is WebKit's *media pipeline*; the Media
 * Session API is plain JavaScript and goes nowhere near GStreamer, so leaving it on keeps
 * whatever OS transport controls the host offers and keeps the controller on one code
 * path with HTML5. It is already behind feature checks and try/catch there.
 */
class TauriDesktopEngine implements AudioEngine {
  readonly usesWebMediaSession = true;
  readonly supportsNativeQueue = false;
  handlers: EngineHandlers = {};

  private invoke: Invoke | null = null;
  private ready: Promise<void>;
  /** Commands run strictly in order: `load` may go to the network, and a `play` that
   *  overtook it would land on the track we just replaced. */
  private chain: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private cur = 0;
  private dur = 0;
  private wasPlaying = false;
  private wasLoading = false;
  private endedGeneration = -1;
  private errorGeneration = -1;

  // One track at a time; the controller drives the queue, so these are no-ops.
  loadQueue() {}
  queueNext() {}
  queuePrev() {}

  constructor() {
    this.ready = import("@tauri-apps/api/core")
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

  private startPolling() {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.poll(), 250);
  }

  /** Deliberately NOT on `chain` — a long download must not starve progress updates. */
  private async poll() {
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

    this.cur = s.position;
    this.handlers.onTime?.(s.position);
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
    this.startPolling();
    this.run((invoke) => invoke("desktop_audio_load", { url: src, startSec }));
  }
  play() {
    this.run((invoke) => invoke("desktop_audio_play"));
  }
  pause() {
    this.run((invoke) => invoke("desktop_audio_pause"));
  }
  seekTo(seconds: number) {
    const position = Math.max(0, this.dur > 0 ? Math.min(seconds, this.dur) : seconds);
    this.cur = position;
    this.run((invoke) => invoke("desktop_audio_seek", { position }));
  }
  currentTime() {
    return this.cur;
  }
  duration() {
    return this.dur;
  }
  release() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.cur = 0;
    this.dur = 0;
    this.wasPlaying = false;
    this.wasLoading = false;
    this.run((invoke) => invoke("desktop_audio_stop"));
  }
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isMobile = typeof navigator !== "undefined" && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
/** Linux desktop, i.e. a WebKitGTK webview. Android reports "Linux" too, hence !isMobile. */
const isLinux = typeof navigator !== "undefined" && /linux/i.test(navigator.userAgent) && !isMobile;

/** Split a trailing "#t=<seconds>" media-fragment start hint off a URI. The native
 *  ExoPlayer and the Rust desktop player both take the URI literally (unlike the HTML5
 *  <audio> element, which honors the fragment), so the offset is applied as a seek. */
function splitOffset(src: string): { src: string; startSec: number } {
  const m = /#t=(\d+(?:\.\d+)?)$/.exec(src);
  return m ? { src: src.slice(0, m.index), startSec: parseFloat(m[1]) } : { src, startSec: 0 };
}

/**
 * Pick the playback engine:
 * - mobile Tauri → `NativeEngine` (background playback, OS-owned transport controls);
 * - Linux Tauri → `TauriDesktopEngine`, because WebKitGTK's `<audio>` can kill the webview;
 * - everything else (browser, macOS/Windows Tauri) → `Html5Engine`. WKWebView and WebView2
 *   play media in-process, with nothing to work around.
 */
export function selectEngine(): AudioEngine {
  if (isTauri && isMobile) return new NativeEngine();
  if (isTauri && isLinux) return new TauriDesktopEngine();
  return new Html5Engine();
}
