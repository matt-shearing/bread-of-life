import type { SpeechSegment } from "./devotionalSpeech";

/**
 * The phone's own voice, rendered to a WAV in the app cache by the Android `device-tts`
 * plugin (src-tauri/plugins/device-tts). Android only: its WebView has no usable
 * speechSynthesis, and a file lets the reading play through the native audio queue with
 * the lock screen, notification and car controls like any other track.
 */

export interface DeviceSpeech {
  /** Absolute path in the app cache. */
  path: string;
  durationSec: number;
  voice: string | null;
  cached: boolean;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

export const deviceTtsSupported = isTauri && isAndroid;

/** Render (or reuse) `segments` as one WAV. `onProgress` gets 0…1 while it renders. */
export async function renderDeviceSpeech(
  key: string,
  segments: SpeechSegment[],
  onProgress?: (fraction: number) => void,
): Promise<DeviceSpeech> {
  const { invoke, addPluginListener } = await import("@tauri-apps/api/core");
  const listener = await addPluginListener<{ key: string; done: number; total: number }>(
    "device-tts",
    "progress",
    (p) => {
      if (p.key === key && p.total > 0) onProgress?.(p.done / p.total);
    },
  ).catch(() => null);
  try {
    return await invoke<DeviceSpeech>("plugin:device-tts|synthesize", {
      key,
      segments: segments.map((s) => ({ text: s.text, pause: s.pause })),
      lang: "en-GB",
      rate: 1.0,
    });
  } finally {
    void listener?.unregister().catch(() => {});
  }
}

let availableCheck: Promise<boolean> | null = null;
let checkedAt = 0;
/** Re-ask after a "no" this often: the listener may have gone off to install an engine. */
const RECHECK_NO_MS = 30_000;

/**
 * Does this phone have a text-to-speech engine that starts? Some ship none (GrapheneOS, for
 * one), and then the phone's voice must not be offered. A "yes" is kept for the session.
 * When the check itself cannot run (an older build without the command), assume yes, as
 * before; rendering reports a missing voice on its own.
 */
export function deviceTtsAvailable(): Promise<boolean> {
  if (!deviceTtsSupported) return Promise.resolve(false);
  if (availableCheck && Date.now() - checkedAt < RECHECK_NO_MS) return availableCheck;
  checkedAt = Date.now();
  const check = (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const r = await invoke<{ available: boolean }>("plugin:device-tts|is_available");
      return r?.available !== false;
    } catch {
      return true;
    }
  })();
  availableCheck = check;
  void check.then((ok) => {
    if (ok) checkedAt = Number.POSITIVE_INFINITY; // a yes never needs asking again
  });
  return check;
}

/** A file:// URI the native player can open (it cannot read Tauri's asset:// scheme). */
export function fileUri(path: string): string {
  return `file://${encodeURI(path)}`;
}
