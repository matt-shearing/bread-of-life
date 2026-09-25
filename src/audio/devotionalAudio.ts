import { useEffect, useState, useSyncExternalStore } from "react";
import { devotionalById, getDevotionDay, type DevotionReading } from "@/data/devotional";
import { setDevotionDone } from "@/db/repos";
import { buildSpeechScript, type DevotionSlot, type SpeechSegment } from "@/lib/devotionalSpeech";
import { deviceTtsSupported, fileUri, renderDeviceSpeech } from "@/lib/deviceTts";
import { playQueue, type Track } from "./controller";
import { estimateSpeechSeconds, pickVoice, speechSynthesisSupported, speechVoices } from "./speechEngine";

/**
 * Spoken Spurgeon devotionals (plan section 5, option C).
 *
 * The main path is a pre-recorded reading (Kokoro, voice bm_george) served as a static
 * MP3; `manifest.json` next to the files says which readings exist and how long each is
 * (format: docs/DEVOTIONAL-AUDIO.md). When a recording is not available — offline, or
 * missing from the manifest, or the manifest cannot be reached — the phone's own voice
 * reads the same words (src/lib/devotionalSpeech.ts): rendered to a file on Android, read
 * by speechSynthesis in a desktop browser.
 *
 * Either way the reading plays through the one audio controller, so it gets the
 * mini-player, Now Playing, lock-screen controls and (later) Android Auto, and finishing
 * it marks the devotional complete.
 */

/** Where the recordings live. Override for local testing with VITE_DEVOTIONAL_AUDIO_BASE. */
export const DEVOTIONAL_AUDIO_BASE: string = (
  (import.meta.env.VITE_DEVOTIONAL_AUDIO_BASE as string | undefined) ||
  "https://sync.breadoflife.dev/audio/spurgeon/v1/bm_george"
).replace(/\/+$/, "");

/** Only this devotional has recordings and a speech script. */
export const SPOKEN_DEVOTIONAL_ID = "spurgeon-morning-evening";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function slotOf(reading: DevotionReading): DevotionSlot | null {
  if (reading.label === "Morning") return "morning";
  if (reading.label === "Evening") return "evening";
  return null;
}

/** "Morning — 25 September · Spurgeon" */
export function devotionalTrackTitle(slot: DevotionSlot, day: string): string {
  const [m, d] = day.split("-").map(Number);
  return `${slot === "morning" ? "Morning" : "Evening"} — ${d} ${MONTHS[m - 1]} · Spurgeon`;
}

/* --------------------------------- manifest --------------------------------- */

/** reading id ("morning/09-25") → { path, durationSec } */
export type ManifestIndex = Record<string, { path: string; durationSec: number }>;

const CACHE_KEY = "bol:devotional-audio-manifest";
/** Re-check the manifest this often; a stale copy is still used when offline. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface CachedManifest {
  base: string;
  fetchedAt: number;
  items: ManifestIndex;
}

function readCache(): CachedManifest | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const c = raw ? (JSON.parse(raw) as CachedManifest) : null;
    return c && c.base === DEVOTIONAL_AUDIO_BASE && c.items ? c : null;
  } catch {
    return null;
  }
}

function writeCache(items: ManifestIndex) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ base: DEVOTIONAL_AUDIO_BASE, fetchedAt: Date.now(), items }));
  } catch {
    /* storage full or blocked — the in-memory copy still works */
  }
}

let manifestPromise: Promise<ManifestIndex | null> | null = null;
let manifestAt = 0;

/** The manifest, compacted to what the app needs. Null when it has never been reachable. */
export function loadDevotionalManifest(): Promise<ManifestIndex | null> {
  const fresh = Date.now() - manifestAt < MAX_AGE_MS;
  if (manifestPromise && fresh) return manifestPromise;
  manifestAt = Date.now();
  manifestPromise = (async () => {
    const cached = readCache();
    if (cached && Date.now() - cached.fetchedAt < MAX_AGE_MS) return cached.items;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return cached?.items ?? null;
    try {
      const res = await fetch(`${DEVOTIONAL_AUDIO_BASE}/manifest.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      const json = (await res.json()) as { items?: Record<string, { path?: string; durationSec?: number }> };
      const items: ManifestIndex = {};
      for (const [id, it] of Object.entries(json.items ?? {})) {
        if (it?.path) items[id] = { path: it.path, durationSec: Number(it.durationSec) || 0 };
      }
      writeCache(items);
      return items;
    } catch {
      // Unreachable (not deployed yet, offline, blocked): fall back to the last copy, and
      // try again sooner than MAX_AGE_MS.
      manifestAt = Date.now() - MAX_AGE_MS + 60_000;
      return cached?.items ?? null;
    }
  })();
  return manifestPromise;
}

/* ------------------------------- availability ------------------------------- */

export type ListenMode =
  | { kind: "loading" }
  | { kind: "recording"; url: string; durationSec: number }
  | { kind: "device"; estimateSec: number }
  | { kind: "unavailable"; reason: string };

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

let webVoice: Promise<boolean> | null = null;
/** Can this platform read aloud without a recording? */
function deviceVoiceAvailable(): Promise<boolean> {
  if (deviceTtsSupported) return Promise.resolve(true);
  if (!speechSynthesisSupported()) return Promise.resolve(false);
  // WebKitGTK can expose speechSynthesis with no voices behind it.
  webVoice ??= speechVoices().then((v) => pickVoice(v) != null);
  return webVoice;
}

/** How a reading would play right now: the recording, the device's voice, or not at all. */
export async function listenModeFor(day: string, slot: DevotionSlot, entryText: string, ref: string | null, online: boolean): Promise<ListenMode> {
  const manifest = await loadDevotionalManifest();
  const item = manifest?.[`${slot}/${day}`];
  if (item && online) {
    return { kind: "recording", url: `${DEVOTIONAL_AUDIO_BASE}/${item.path}`, durationSec: item.durationSec };
  }
  if (await deviceVoiceAvailable()) {
    return { kind: "device", estimateSec: estimateSpeechSeconds(buildSpeechScript(day, slot, { ref, text: entryText })) };
  }
  return {
    kind: "unavailable",
    reason: online
      ? "No recording for this day yet, and this device has no voice to read it."
      : "Needs internet: this device has no voice to read it offline.",
  };
}

export function useListenMode(day: string, reading: DevotionReading | undefined): ListenMode {
  const online = useOnline();
  const [mode, setMode] = useState<ListenMode>({ kind: "loading" });
  const slot = reading ? slotOf(reading) : null;
  useEffect(() => {
    if (!reading || !slot) {
      setMode({ kind: "unavailable", reason: "" });
      return;
    }
    let alive = true;
    setMode({ kind: "loading" });
    listenModeFor(day, slot, reading.text, reading.ref || null, online).then((m) => alive && setMode(m));
    return () => {
      alive = false;
    };
  }, [day, slot, reading, online]);
  return mode;
}

/* ----------------------------- preparing (Android) ----------------------------- */

export interface PrepareState {
  /** The reading being rendered with the phone's voice ("morning/09-25"), or null. */
  id: string | null;
  progress: number;
  error: { id: string; message: string } | null;
}

let prep: PrepareState = { id: null, progress: 0, error: null };
const prepListeners = new Set<() => void>();
function setPrep(p: Partial<PrepareState>) {
  prep = { ...prep, ...p };
  prepListeners.forEach((l) => l());
}

export function usePrepareState(): PrepareState {
  return useSyncExternalStore(
    (cb) => {
      prepListeners.add(cb);
      return () => prepListeners.delete(cb);
    },
    () => prep,
    () => prep,
  );
}

/* ----------------------------------- play ----------------------------------- */

/** A short, stable hash for the TTS cache key, so an edited text renders afresh. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

export interface PlayDevotionalArgs {
  devotionalId: string;
  day: string;
  index: number;
  reading: DevotionReading;
  /** Force a mode (tests); normally decided from the manifest and connectivity. */
  mode?: ListenMode;
}

/** Play one devotional reading and mark it complete when it finishes. */
export async function playDevotional({ devotionalId, day, index, reading, mode }: PlayDevotionalArgs): Promise<void> {
  const slot = slotOf(reading);
  if (!slot) return;
  const id = `${slot}/${day}`;
  const m = mode ?? (await listenModeFor(day, slot, reading.text, reading.ref || null, navigator.onLine));
  if (m.kind === "unavailable" || m.kind === "loading") return;

  const base: Omit<Track, "src" | "subtitle"> = {
    ho: "",
    chapter: 0,
    title: devotionalTrackTitle(slot, day),
    devotional: {
      devotionalId,
      day,
      slot,
      index,
      ref: reading.ref,
      voice: m.kind === "recording" ? "recording" : "device",
    },
  };
  const subtitle = (voice: string) => [reading.ref, voice].filter(Boolean).join(" · ");
  const onComplete = () => void setDevotionDone(`${devotionalId}:${day}:${index}`, true);

  if (m.kind === "recording") {
    playQueue([{ ...base, src: m.url, subtitle: subtitle("C. H. Spurgeon") }], { onComplete });
    return;
  }

  const segments: SpeechSegment[] = buildSpeechScript(day, slot, { ref: reading.ref || null, text: reading.text });
  if (deviceTtsSupported) {
    setPrep({ id, progress: 0, error: null });
    try {
      const key = `${slot}-${day}-${hash(JSON.stringify(segments))}`;
      const out = await renderDeviceSpeech(key, segments, (f) => setPrep({ progress: f }));
      playQueue([{ ...base, src: fileUri(out.path), subtitle: subtitle("Phone's voice") }], { onComplete });
      setPrep({ id: null, progress: 1 });
    } catch (e) {
      setPrep({ id: null, progress: 0, error: { id, message: e instanceof Error ? e.message : String(e) } });
    }
    return;
  }
  playQueue([{ ...base, src: `speech:${id}`, speech: segments, subtitle: subtitle("Device voice") }], { onComplete });
}

/** Play another reading of a spoken devotional by day and index (Now Playing's "later today"). */
export async function playDevotionalReading(devotionalId: string, day: string, index: number): Promise<void> {
  const d = await getDevotionDay(devotionalById(devotionalId), day);
  const reading = d?.readings[index];
  if (reading) await playDevotional({ devotionalId, day, index, reading });
}

/** "2:21" or "about 3 min" for the Listen button. */
export function formatListenDuration(mode: ListenMode): string {
  if (mode.kind === "recording" && mode.durationSec > 0) {
    const s = Math.round(mode.durationSec);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  if (mode.kind === "device") return `about ${Math.max(1, Math.round(mode.estimateSec / 60))} min`;
  return "";
}
