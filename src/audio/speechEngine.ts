import type { AudioEngine, EngineHandlers, EngineTrack } from "./engine";
import type { SpeechSegment } from "@/lib/devotionalSpeech";

/**
 * An engine that reads a track aloud with the browser's own `speechSynthesis`, segment
 * by segment, with the same pauses as the recordings. It is the desktop fallback for a
 * spoken devotional whose recording is not available. (Android's WebView has no usable
 * speechSynthesis; there the phone's voice is rendered to a file by the device-tts plugin
 * and played by the native engine instead.)
 *
 * speechSynthesis reports no duration or position, so both are ESTIMATED from the length
 * of the text; seeking jumps to the segment nearest the target. Pause cancels the current
 * utterance and resume restarts that segment, because `speechSynthesis.pause()` is
 * unreliable across browsers.
 */

/** Characters per second at rate 1 — about 160 words a minute. Only used for estimates. */
const CHARS_PER_SEC = 14;

export function speechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

/** The browser's voices, waiting briefly for them to load (Chrome loads them lazily). */
export function speechVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (!speechSynthesisSupported()) return Promise.resolve([]);
  const now = window.speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener?.("voiceschanged", done);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener?.("voiceschanged", done);
    setTimeout(done, timeoutMs);
  });
}

/** Prefer a local British English voice, then any British, then any English voice. */
export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  const gb = en.filter((v) => /^en[-_]gb$/i.test(v.lang));
  return gb.find((v) => v.localService) ?? gb[0] ?? en.find((v) => v.localService) ?? en[0] ?? null;
}

/** Estimated seconds a script takes to read at rate 1, pauses included. */
export function estimateSpeechSeconds(segs: SpeechSegment[]): number {
  return segs.reduce((sum, s) => sum + s.text.length / CHARS_PER_SEC + s.pause, 0);
}

export class WebSpeechEngine implements AudioEngine {
  readonly usesWebMediaSession = true;
  readonly supportsNativeQueue = false;
  readonly supportsRate = true;
  handlers: EngineHandlers = {};

  private segs: SpeechSegment[] = [];
  /** Estimated start time of each segment (seconds at rate 1), plus the total at the end. */
  private starts: number[] = [0];
  private i = 0;
  private playing = false;
  private rate = 1;
  /** Bumped whenever speech is cancelled, so stale utterance callbacks do nothing. */
  private token = 0;
  private segStartedAt = 0;
  private gap: ReturnType<typeof setTimeout> | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private voice: SpeechSynthesisVoice | null = null;

  // One track at a time; the controller drives the queue.
  loadQueue() {}
  queueNext() {}
  queuePrev() {}

  constructor() {
    void speechVoices().then((v) => (this.voice = pickVoice(v)));
  }

  private get total() {
    return this.starts[this.starts.length - 1] ?? 0;
  }

  load(track: EngineTrack) {
    this.silence();
    this.playing = false;
    this.segs = track.speech ?? [];
    this.starts = [0];
    for (const s of this.segs) this.starts.push(this.starts[this.starts.length - 1] + s.text.length / CHARS_PER_SEC + s.pause);
    this.i = 0;
    // After the controller has reset its own state for the new track (it does that
    // straight after load), as an <audio> element's events would.
    setTimeout(() => {
      this.handlers.onDuration?.(this.total);
      this.handlers.onTime?.(this.currentTime());
      this.handlers.onLoading?.(false);
    }, 0);
  }

  play() {
    if (this.playing || !this.segs.length) return;
    if (this.i >= this.segs.length) this.i = 0;
    this.playing = true;
    this.handlers.onPlay?.();
    this.startTick();
    this.speakCurrent();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.silence();
    this.stopTick();
    this.handlers.onTime?.(this.starts[this.i] ?? 0);
    this.handlers.onPause?.();
  }

  seekTo(seconds: number) {
    let k = 0;
    while (k < this.segs.length - 1 && this.starts[k + 1] <= seconds) k++;
    this.i = k;
    if (this.playing) {
      this.silence();
      this.speakCurrent();
    }
    this.handlers.onTime?.(this.starts[k] ?? 0);
  }

  setRate(rate: number) {
    this.rate = rate;
    if (this.playing) {
      this.silence();
      this.speakCurrent();
    }
  }

  currentTime() {
    const start = this.starts[this.i] ?? 0;
    if (!this.playing) return start;
    const elapsed = ((performance.now() - this.segStartedAt) / 1000) * this.rate;
    return Math.min(start + elapsed, this.starts[this.i + 1] ?? this.total);
  }

  duration() {
    return this.total;
  }

  release() {
    this.playing = false;
    this.silence();
    this.stopTick();
    this.segs = [];
    this.starts = [0];
    this.i = 0;
  }

  /* ---------------------------------------------------------------------------- */

  private speakCurrent() {
    const my = ++this.token;
    const seg = this.segs[this.i];
    if (!seg) return this.finish();
    const u = new SpeechSynthesisUtterance(seg.text);
    try {
      if (this.voice) u.voice = this.voice;
    } catch {
      /* a voice the engine no longer has — fall back to the language */
    }
    u.lang = this.voice?.lang ?? "en-GB";
    u.rate = this.rate;
    const next = () => {
      if (my !== this.token) return;
      this.gap = setTimeout(() => {
        if (my !== this.token) return;
        this.i++;
        if (this.i >= this.segs.length) this.finish();
        else this.speakCurrent();
      }, (seg.pause * 1000) / this.rate);
    };
    u.onend = next;
    u.onerror = (e) => {
      if (e.error === "interrupted" || e.error === "canceled") return;
      next(); // skip a segment the engine could not say rather than stall
    };
    this.segStartedAt = performance.now();
    window.speechSynthesis.speak(u);
  }

  private finish() {
    this.playing = false;
    this.stopTick();
    this.i = this.segs.length;
    this.handlers.onTime?.(this.total);
    this.handlers.onPause?.();
    this.handlers.onEnded?.();
  }

  private silence() {
    this.token++;
    if (this.gap) clearTimeout(this.gap);
    this.gap = null;
    if (speechSynthesisSupported()) window.speechSynthesis.cancel();
  }

  private startTick() {
    if (this.tick) return;
    this.tick = setInterval(() => this.handlers.onTime?.(this.currentTime()), 250);
  }

  private stopTick() {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }
}
