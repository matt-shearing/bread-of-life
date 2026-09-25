/**
 * Where a chapter's narration lives. Every chapter of the bundled Bible follows this one
 * pattern (the per-chapter `audio` URLs in public/bible/bsb are exactly these), and the
 * Android Auto side builds the same URLs natively in BibleCatalog.kt, so the car can play
 * any chapter without the app running.
 *
 * Keep the two in step: scripts/test-audio-url.mjs (here) and AudioUrlAgreementTest.kt
 * (Kotlin) both check against src/audio/audio-url-cases.json. No imports, so Node can run
 * the test straight from this file.
 */
export const AUDIO_BASE = "https://audio.bible.helloao.org/api";
export const DEFAULT_AUDIO_TRANSLATION = "BSB";
/** The first narrator in every chapter's audio set, and so the one the app plays by default. */
export const DEFAULT_NARRATOR = "david";

export function chapterAudioUrl(
  ho: string,
  chapter: number,
  narrator: string = DEFAULT_NARRATOR,
  translation: string = DEFAULT_AUDIO_TRANSLATION,
): string {
  return `${AUDIO_BASE}/${translation}/${ho}/${chapter}/audio/${narrator}.mp3`;
}

/** Book, chapter and narrator of a narration URL, or null for anything else (Missler, devotionals). */
export function parseChapterAudioUrl(src: string): { ho: string; chapter: number; narrator: string } | null {
  const m = /\/api\/[A-Za-z0-9_]+\/([0-9A-Z]{3})\/(\d+)\/audio\/([A-Za-z0-9_-]+)\.mp3$/.exec(src.split(/[?#]/)[0]);
  return m ? { ho: m[1], chapter: Number(m[2]), narrator: m[3] } : null;
}
