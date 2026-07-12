import { getChapterFor, loadIndex, translationById } from "@/data/bible";
import { getMisslerAudio } from "@/data/missler";
import { BOOKS, refLabel } from "@/lib/osis";
import type { Track } from "./controller";

function subtitleFor(translation: string, label: string): string {
  if (label.toLowerCase().startsWith("missler")) return "Missler Inspired";
  const name = translationById(translation)?.name ?? translation.toUpperCase();
  const narrator = label.charAt(0).toUpperCase() + label.slice(1);
  return `${name} · ${narrator}`;
}

/** A Track from an already-loaded audio set (narrator label → URL) — no fetch. */
export function trackFromAudio(
  ho: string,
  chapter: number,
  audio: Record<string, string>,
  label: string,
  translation: string,
): Track | null {
  const src = audio[label];
  if (!src) return null;
  return { ho, chapter, src, title: refLabel(ho, chapter), subtitle: subtitleFor(translation, label) };
}

/** Build a Track for one chapter by loading its narration audio. Null if none. */
export async function trackForChapter(
  translation: string,
  ho: string,
  chapter: number,
  narratorPref?: string,
): Promise<Track | null> {
  const ch = await getChapterFor(translation, ho, chapter);
  const audio: Record<string, string> = { ...(ch?.audio ?? {}), ...(await getMisslerAudio(ho, chapter)) };
  const labels = Object.keys(audio);
  if (!labels.length) return null;
  const label = narratorPref && labels.includes(narratorPref) ? narratorPref : labels[0];
  return trackFromAudio(ho, chapter, audio, label, translation);
}

/** Build a play queue from a plan day's readings (chapters with no audio are skipped).
 *  Each track keeps its `planReadingIndex` so completion can mark that reading read. */
export async function buildReadingQueue(
  translation: string,
  readings: { ho: string; chapter: number }[],
  narratorPref?: string,
): Promise<Track[]> {
  const tracks = await Promise.all(
    readings.map(async (r, i): Promise<Track | null> => {
      const t = await trackForChapter(translation, r.ho, r.chapter, narratorPref);
      return t ? { ...t, planReadingIndex: i } : null;
    }),
  );
  return tracks.filter((t): t is Track => t !== null);
}

/**
 * A continuous queue for the general Bible reader: the given chapter, then the rest of
 * its book, then every following book to the end of the canon. Audio URLs are TEMPLATED
 * from the current chapter's real URL (so it works for any translation/host that has
 * narration) — no per-chapter fetch, so a ~1000-chapter playlist is built instantly and
 * handed to the native player to roll through in the background.
 */
export async function buildContinuousQueue(
  fromHo: string,
  fromChapter: number,
  sampleUrl: string,
  narratorLabel: string,
  translation: string,
): Promise<Track[]> {
  const index = await loadIndex();
  const chapterCount = (ho: string) => index.find((b) => b.id === ho)?.chapters ?? 0;
  const subtitle = subtitleFor(translation, narratorLabel);
  const ordered = [...BOOKS].sort((a, b) => a.order - b.order);

  const tracks: Track[] = [];
  let started = false;
  for (const book of ordered) {
    if (book.ho === fromHo) started = true;
    if (!started) continue;
    const total = chapterCount(book.ho);
    const start = book.ho === fromHo ? fromChapter : 1;
    for (let c = start; c <= total; c++) {
      // "…/BSB/JHN/1/audio/david.mp3" → swap the "/<book>/<ch>/audio/" segment.
      const src = sampleUrl.replace(/\/[A-Za-z0-9]+\/\d+\/audio\//, `/${book.ho}/${c}/audio/`);
      tracks.push({ ho: book.ho, chapter: c, src, title: refLabel(book.ho, c), subtitle });
    }
  }
  return tracks;
}
