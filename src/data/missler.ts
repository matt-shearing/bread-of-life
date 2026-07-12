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
// Android/media is the practical drop zone: adb, Syncthing and file managers
// can write it (Android/data is hidden+blocked since 13), and the app reads
// its own media dir permission-free. Keep the old files path as a fallback.
// With "All files access" granted (see hasAllFilesAccess) a library in Downloads
// is readable in place too, so probe it first; the media/data dirs remain the
// permission-free fallbacks.
const ANDROID_AUTO_PATHS = [
  "/storage/emulated/0/Download/missler-library",
  "/storage/emulated/0/Android/media/com.breadoflife.app/missler-library",
  "/storage/emulated/0/Android/media/com.breadoflife.app/files/missler-library",
  "/storage/emulated/0/Android/data/com.breadoflife.app/files/missler-library",
];
const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
let autoPath: string | undefined; // probe result cache

/** The permission-free Android/media drop folder — writable by file managers,
 *  MTP and Syncthing without any storage permission. This is the zero-permission
 *  place users drop a library on Android (index 1; index 0 is Downloads, which
 *  needs all-files access). */
export const ANDROID_DROP_PATH = ANDROID_AUTO_PATHS[1];

/** Whether the app can read files outside its own sandbox (Android "All files
 *  access" / MANAGE_EXTERNAL_STORAGE), needed to read a library from Downloads or
 *  any shared-storage folder in place. Backed by the Kotlin `all-files` plugin
 *  (plugins/all-files) — NOT ndk_context, which panics/crashes under Tauri. Always
 *  true off Tauri and on desktop, where local file access is unrestricted. */
export async function hasAllFilesAccess(): Promise<boolean> {
  if (!isTauri || !isAndroid) return true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const res = await invoke<{ granted: boolean }>("plugin:all-files|is_manager");
    return !!res?.granted;
  } catch {
    return true; // never block the UI on a bridge failure
  }
}

/** Open the system "All files access" toggle for this app so the user can grant
 *  it. No-op off Android; the caller re-checks hasAllFilesAccess() on return. */
export async function requestAllFilesAccess(): Promise<void> {
  if (!isTauri || !isAndroid) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("plugin:all-files|request_manage");
  } catch {
    /* best-effort; the UI re-checks on focus */
  }
}

/** Open the native Android folder picker and return the chosen folder's ABSOLUTE
 *  path (the app reads it directly, given all-files access). Returns null if the
 *  user cancels, the pick can't be mapped to a real path, or off Android. Backed by
 *  the Kotlin all-files plugin (a SAF tree URI isn't usable for the path-based
 *  reader, so the plugin maps it to a filesystem path). */
export async function pickLibraryFolder(): Promise<string | null> {
  if (!isTauri || !isAndroid) return null;
  // NB: errors propagate so the caller can surface them — a silent catch here made
  // a failing picker look like a dead button.
  const { invoke } = await import("@tauri-apps/api/core");
  const res = await invoke<{ path: string | null }>("plugin:all-files|pick_folder");
  return res?.path ?? null;
}

/** Best-effort: make the Android/media drop folder exist so the user always has a
 *  file-manager-/MTP-/Syncthing-writable place to put the library — no adb, no
 *  all-files-access needed. Android/media dirs are writable by the app
 *  permission-free (unlike the hidden Android/data dir). No-op off Android/Tauri;
 *  never throws (called at startup). */
export async function ensureAndroidDropFolder(): Promise<void> {
  if (!isTauri || !isAndroid) return;
  try {
    const { mkdir } = await import("@tauri-apps/plugin-fs");
    await mkdir(ANDROID_DROP_PATH, { recursive: true });
  } catch (e) {
    console.warn("missler: could not create Android drop folder", e);
  }
}

export async function getMisslerLibraryPath(): Promise<string> {
  const set = (await getSetting<string>(LIBRARY_PATH_KEY, "")).trim();
  if (set || !isTauri) return set;
  if (autoPath === undefined) {
    autoPath = "";
    const [{ readTextFile }, { appDataDir, join }] = await Promise.all([
      import("@tauri-apps/plugin-fs"),
      import("@tauri-apps/api/path"),
    ]);
    // `appDataDir()/missler-library` is the app's OWN storage — always readable
    // and writable with no permissions, and the target of the network import.
    // Probe it first on every platform, then the Android drop folders below.
    const candidates = [await join(await appDataDir(), "missler-library"), ...(isAndroid ? ANDROID_AUTO_PATHS : [])];
    for (const cand of candidates) {
      try {
        await readTextFile(await join(cand, "missler-library.json"));
        autoPath = cand;
        break;
      } catch {
        /* try next candidate */
      }
    }
  }
  return autoPath;
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
  autoPath = undefined;
  commentaryCache.clear();
}

/* ------------------------------ network import ----------------------------- */

/** One-click library import. Raw external-path reads FAIL on Android (scoped
 *  storage won't attribute files written by adb/other apps), so instead of
 *  pointing at a folder we DOWNLOAD the library over HTTP into the app's own
 *  `appDataDir()/missler-library/` — always readable and writable, no grants.
 *  The user serves the built folder from their PC and pastes the LAN URL. */
export interface ImportResult {
  files: number;
  bytes: number;
}

/** Fetch used by the importer. Must be plugin-http, not window.fetch: the LAN
 *  server is plain-HTTP (cleartext) and cross-origin, both of which the webview
 *  blocks but the Rust HTTP client allows. */
type HttpFetch = (input: string, init?: { method?: string }) => Promise<Response>;

/** Server-reported byte size (Content-Length via HEAD), or null if unknown. */
async function remoteSize(httpFetch: HttpFetch, url: string): Promise<number | null> {
  try {
    const res = await httpFetch(url, { method: "HEAD" });
    if (!res.ok) return null;
    const len = res.headers.get("content-length");
    return len ? Number(len) : null;
  } catch {
    return null;
  }
}

/**
 * Download the whole library from `baseUrl` into `appDataDir()/missler-library/`.
 * `onProgress(done, total, currentFile)` fires before each file. Resumable: a
 * file already on disk whose size matches the server's is skipped. Clears the
 * in-memory caches on success so the imported library is picked up immediately.
 */
export async function importLibrary(
  baseUrl: string,
  onProgress: (done: number, total: number, currentFile: string) => void,
  opts?: { audio?: boolean },
): Promise<ImportResult> {
  if (!isTauri) throw new Error("Network import is only available in the desktop and Android app.");
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("Enter the URL your library is being served from.");

  const [{ fetch: rawFetch }, { appDataDir, join }, { writeFile, mkdir, exists, stat }] = await Promise.all([
    import("@tauri-apps/plugin-http"),
    import("@tauri-apps/api/path"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const httpFetch: HttpFetch = rawFetch;
  const root = await join(await appDataDir(), "missler-library");

  // 1) The index is the source of truth for the work list — fetch it FIRST so a
  //    wrong URL or an un-served folder fails immediately with a clear message.
  let index: Library;
  try {
    const res = await httpFetch(`${base}/missler-library.json`);
    if (!res.ok) throw new Error(`server responded ${res.status}`);
    index = JSON.parse(await res.text()) as Library;
  } catch (e) {
    throw new Error(
      `Couldn't read missler-library.json from ${base} — check the URL and that the folder is being served. (${String(e)})`,
    );
  }
  if (!index || typeof index.books !== "object") {
    throw new Error("That URL served a file, but it isn't a valid missler-library.json.");
  }

  // 2) Build the work list: index + audio-index + per-book commentary + audio.
  const work: string[] = ["missler-library.json", "audio-index.json"];
  for (const ho of Object.keys(index.books)) work.push(`commentary/${ho}.json`);
  if (opts?.audio !== false) {
    try {
      const res = await httpFetch(`${base}/audio-index.json`);
      if (res.ok) {
        const audio = JSON.parse(await res.text()) as AudioIndex;
        const paths = new Set<string>();
        for (const sessions of Object.values(audio)) for (const s of sessions) paths.add(s.path);
        for (const p of paths) work.push(p);
      }
    } catch {
      /* no audio index → commentary-only import */
    }
  }

  // 3) Download sequentially, writing under appDataDir. Skip files already on
  //    disk whose size matches the server's (resume after an interrupted run).
  const total = work.length;
  let done = 0;
  let bytes = 0;
  for (const rel of work) {
    onProgress(done, total, rel);
    const segs = rel.split("/");
    const dest = await join(root, ...segs);
    const url = `${base}/${segs.map(encodeURIComponent).join("/")}`;

    const local = (await exists(dest)) ? (await stat(dest)).size : null;
    if (local != null && local === (await remoteSize(httpFetch, url))) {
      done++;
      continue;
    }

    const res = await httpFetch(url);
    if (!res.ok) throw new Error(`Download failed for ${rel} (${res.status}).`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (segs.length > 1) await mkdir(await join(root, ...segs.slice(0, -1)), { recursive: true });
    else await mkdir(root, { recursive: true });
    await writeFile(dest, buf);
    bytes += buf.byteLength;
    done++;
  }
  onProgress(done, total, "");
  clearMisslerCache();
  return { files: done, bytes };
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
