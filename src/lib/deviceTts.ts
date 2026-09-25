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

/** A file:// URI the native player can open (it cannot read Tauri's asset:// scheme). */
export function fileUri(path: string): string {
  return `file://${encodeURI(path)}`;
}
