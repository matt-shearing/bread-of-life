/**
 * Missler (Line by Line) — a personal, LOCAL-ONLY commentary + audio library.
 *
 * The library is built by `~/dev/missler-commentary` from Matt's own copies of
 * Chuck Missler's teaching. It is copyrighted, so NOTHING here is ever bundled in
 * the app or synced — the app reads it at runtime from a folder the user points at
 * in Settings (`misslerLibraryPath`). An empty path means the feature is off.
 *
 * Two runtimes:
 *  - **Desktop (Tauri)** — JSON is read with `@tauri-apps/plugin-fs` and audio is
 *    streamed through the asset protocol (`convertFileSrc`, scoped in tauri.conf).
 *  - **Browser dev (`pnpm dev`)** — a gitignored `public/missler-library` symlink
 *    serves the same folder, so we just `fetch` under BASE_URL (the path setting is
 *    irrelevant there — the browser can't read arbitrary disk paths).
 *
 * Everything is cached in module-level Maps — the data is local and instant, and
 * Dexie caching would only risk showing stale text after the builder rebuilds.
 */
import { getSetting, setSetting } from "@/db/repos";
import { toOsis } from "@/lib/osis";
import type { CommentaryBlock, CommentaryChapter } from "./commentary";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/* ------------------------------ library shapes ------------------------------ */

interface LibraryBook {
  osis: string;
  name: string;
  chapterCount: number;
  commentaryChapters: number[];
  audioChapters: number[];
}
interface Library {
  version: number;
  books: Record<string, LibraryBook>; // keyed by ho ("JHN")
}

interface RawBlock {
  verse: number;
  endVerse: number | null;
  paragraphs: string[];
  xrefs: string[];
}
interface RawChapter {
  intro: string | null;
  blocks: RawBlock[];
}
type CommentaryFile = Record<string, RawChapter>; // keyed by OSIS chapter ("John.1")

interface AudioSession {
  path: string;
  title: string;
  startSec: number;
  durationSec: number;
}
type AudioIndex = Record<string, AudioSession[]>; // keyed by OSIS chapter ("John.1")

/* -------------------------------- settings --------------------------------- */

const LIBRARY_PATH_KEY = "misslerLibraryPath";

/** On Android the library is dropped into the app's own external-files folder
 *  (readable without extra permissions): push it once with adb/Syncthing and
 *  the app finds it — no path entry needed. */
const ANDROID_AUTO_PATH =
  "/storage/emulated/0/Android/data/com.breadoflife.app/files/missler-library";
const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
let autoPathOk: boolean | null = null; // probe result cache

export async function getMisslerLibraryPath(): Promise<string> {
  const set = (await getSetting<string>(LIBRARY_PATH_KEY, "")).trim();
  if (set || !isTauri || !isAndroid) return set;
  if (autoPathOk === null) {
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      await readTextFile(`${ANDROID_AUTO_PATH}/missler-library.json`);
      autoPathOk = true;
    } catch {
      autoPathOk = false;
    }
  }
  return autoPathOk ? ANDROID_AUTO_PATH : "";
}

/** Persist the library path and drop the in-memory caches so the next read is fresh. */
export async function setMisslerLibraryPath(path: string): Promise<void> {
  await setSetting(LIBRARY_PATH_KEY, path.trim());
  clearMisslerCache();
}

/* ------------------------------- file reading ------------------------------ */

/** Read one JSON file from the library, relative to its root. Returns null on any
 *  failure (no path set, file missing, offline symlink absent, parse error). */
async function readJson<T>(rel: string): Promise<T | null> {
  try {
    if (isTauri) {
      const libPath = await getMisslerLibraryPath();
      if (!libPath) return null;
      const [{ readTextFile }, { join }] = await Promise.all([
        import("@tauri-apps/plugin-fs"),
        import("@tauri-apps/api/path"),
      ]);
      return JSON.parse(await readTextFile(await join(libPath, rel))) as T;
    }
    const res = await fetch(encodeURI(`${import.meta.env.BASE_URL}missler-library/${rel}`));
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Absolute URL for an audio file. In Tauri this is an `asset:` URL; in the browser
 *  it's the symlinked public path. `startSec` becomes a media-fragment start hint. */
async function assetUrl(rel: string, startSec: number): Promise<string> {
  const frag = startSec > 0 ? `#t=${Math.round(startSec)}` : "";
  if (isTauri) {
    const libPath = await getMisslerLibraryPath();
    const [{ convertFileSrc }, { join }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/api/path"),
    ]);
    return convertFileSrc(await join(libPath, rel)) + frag;
  }
  return encodeURI(`${import.meta.env.BASE_URL}missler-library/${rel}`) + frag;
}

/* --------------------------------- caching --------------------------------- */

let libraryCache: Promise<Library | null> | null = null;
let audioIndexCache: Promise<AudioIndex | null> | null = null;
const commentaryCache = new Map<string, Promise<CommentaryFile | null>>();

function loadLibrary(): Promise<Library | null> {
  if (!libraryCache) libraryCache = readJson<Library>("missler-library.json");
  return libraryCache;
}
function loadAudioIndex(): Promise<AudioIndex | null> {
  if (!audioIndexCache) audioIndexCache = readJson<AudioIndex>("audio-index.json");
  return audioIndexCache;
}
function loadBookCommentary(ho: string): Promise<CommentaryFile | null> {
  let p = commentaryCache.get(ho);
  if (!p) {
    p = readJson<CommentaryFile>(`commentary/${ho}.json`);
    commentaryCache.set(ho, p);
  }
  return p;
}

/** Forget everything read so far — used when the library path changes. */
export function clearMisslerCache(): void {
  libraryCache = null;
  audioIndexCache = null;
  autoPathOk = null;
  commentaryCache.clear();
}

/* ----------------------------------- API ----------------------------------- */

export interface MisslerStatus {
  available: boolean;
  books: number;
  audioChapters: number;
  error?: string;
}

/** Library health for the Settings screen. A missing folder is only an *error*
 *  once a path has been set (in the browser there's no path, just the symlink). */
export async function getMisslerStatus(): Promise<MisslerStatus> {
  try {
    const lib = await loadLibrary();
    if (!lib) {
      if (isTauri && !(await getMisslerLibraryPath())) {
        return { available: false, books: 0, audioChapters: 0 };
      }
      return {
        available: false,
        books: 0,
        audioChapters: 0,
        error: "Couldn't read the library. Point the path at the folder that contains missler-library.json.",
      };
    }
    const books = Object.values(lib.books);
    const audioChapters = books.reduce((n, b) => n + b.audioChapters.length, 0);
    return { available: books.length > 0, books: books.length, audioChapters };
  } catch (e) {
    return { available: false, books: 0, audioChapters: 0, error: String(e) };
  }
}

export async function misslerAvailable(): Promise<boolean> {
  return (await getMisslerStatus()).available;
}

/** Missler commentary for a chapter, mapped into the shared CommentaryChapter shape.
 *  Returns null when the library, book, or chapter isn't present (so the panel falls
 *  through to its "empty" state, exactly like a public-domain source with no text). */
export async function getMisslerCommentary(ho: string, chapter: number): Promise<CommentaryChapter | null> {
  const lib = await loadLibrary();
  if (!lib) return null;
  const book = lib.books[ho];
  if (!book || !book.commentaryChapters.includes(chapter)) return null;
  const file = await loadBookCommentary(ho);
  const raw = file?.[toOsis(ho, chapter)];
  if (!raw) return null;
  const blocks: CommentaryBlock[] = raw.blocks.map((b) => ({
    verse: b.verse,
    endVerse: b.endVerse ?? undefined,
    paragraphs: b.paragraphs,
    xrefs: b.xrefs.length ? b.xrefs : undefined,
  }));
  return { intro: raw.intro ?? undefined, blocks };
}

/** Missler audio for a chapter as label → URL, ready to merge into AudioPlayer.
 *  A single session is labelled "Missler"; multiple become "Missler 1/2" etc. */
export async function getMisslerAudio(ho: string, chapter: number): Promise<Record<string, string>> {
  const index = await loadAudioIndex();
  const sessions = index?.[toOsis(ho, chapter)];
  if (!sessions?.length) return {};
  const out: Record<string, string> = {};
  const total = sessions.length;
  for (let i = 0; i < total; i++) {
    const s = sessions[i];
    const label = total > 1 ? `Missler ${i + 1}/${total}` : "Missler";
    out[label] = await assetUrl(s.path, s.startSec);
  }
  return out;
}
