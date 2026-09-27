/**
 * The licensed-translation layer: copyrighted texts read at run time from the
 * publisher's API with the user's own key. Nothing here is bundled, what is cached
 * is capped by each provider's terms (./cache.ts), and every text carries the
 * notice its licence asks for. docs/LICENSED-TRANSLATIONS.md has the terms.
 *
 * Adding a provider: a module with a pure fetch-and-parse function (see ./esv.ts),
 * a case in `fetchFor` and POLICY below, a key in `BibleKeys` (src/store/ui.ts), and
 * a card in src/components/settings/BibleKeysSettings.tsx.
 */
import type { Chapter, Translation } from "../bible";
import { db } from "@/db";
import { isTauri } from "@/lib/platform";
import { bookByHo } from "@/lib/osis";
import { useUI, type ApiBibleChoice, type BibleKeys } from "@/store/ui";
import { readCapped, writeCapped, type CacheStore, type CapPolicy } from "./cache";
import { ESV_NOTICE, ESV_POLICY, fetchEsvChapter } from "./esv";
import { APIBIBLE_POLICY, fetchApiBibleChapter } from "./apibible";
import { NLT_NOTICE, NLT_POLICY, fetchNltChapter } from "./nlt";
import { knownApiBible } from "./catalog";
import { reportFums } from "./fums";
import { LicensedError, type FetchLike, type LicensedFailure, type LicensedSourceId } from "./types";

export type { LicensedFailure, LicensedSourceId };

export const ESV_TRANSLATION: Translation = {
  id: "ESV",
  name: "English Standard Version",
  short: "ESV",
  source: "esv",
  notice: ESV_NOTICE,
  noticeUrl: "https://www.esv.org",
  maxBookShareOnPage: 0.5,
};

export const NLT_TRANSLATION: Translation = {
  id: "NLT",
  name: "New Living Translation",
  short: "NLT",
  source: "nlt",
  notice: NLT_NOTICE,
  noticeUrl: "https://www.tyndale.com",
  copyNotice: NLT_NOTICE,
};

export const APIBIBLE_PREFIX = "apibible:";
export const API_BIBLE_CREDIT = "Text provided by API.Bible";
export const API_BIBLE_URL = "https://api.bible";

export const isLicensedId = (id: string) => id === "ESV" || id === "NLT" || id.startsWith(APIBIBLE_PREFIX);

export function apiBibleTranslation(c: ApiBibleChoice): Translation {
  const known = knownApiBible(c.id);
  const notice = known?.notice ?? c.copyright;
  return {
    id: `${APIBIBLE_PREFIX}${c.id}`,
    name: c.name,
    short: c.abbreviation,
    source: "apibible",
    remoteId: c.id,
    notice: notice ?? `${c.name}. Used by permission of the copyright holder.`,
    noticeUrl: known?.noticeUrl,
    // Lockman: "For web pages or apps the full copyright notice must be used."
    copyNotice: known?.notice,
    credit: { label: API_BIBLE_CREDIT, url: API_BIBLE_URL },
    preferChapterCopyright: !known?.notice,
  };
}

/** Licensed translations this device can read now: those with a saved key. */
export function licensedTranslations(state: { bibleKeys: BibleKeys; apiBibleBibles: ApiBibleChoice[] } = useUI.getState()): Translation[] {
  const { bibleKeys, apiBibleBibles } = state;
  const out: Translation[] = [];
  if (bibleKeys.esv) out.push(ESV_TRANSLATION);
  if (bibleKeys.nlt) out.push(NLT_TRANSLATION);
  if (bibleKeys.apiBible) out.push(...apiBibleBibles.map(apiBibleTranslation));
  return out;
}

/** A licensed translation by id, even without a key (so the reader can name it). */
export function licensedTranslationById(id: string): Translation | undefined {
  if (id === "ESV") return ESV_TRANSLATION;
  if (id === "NLT") return NLT_TRANSLATION;
  if (!id.startsWith(APIBIBLE_PREFIX)) return undefined;
  const bibleId = id.slice(APIBIBLE_PREFIX.length);
  const c = useUI.getState().apiBibleBibles.find((b) => b.id === bibleId);
  if (c) return apiBibleTranslation(c);
  const known = knownApiBible(bibleId);
  return known ? apiBibleTranslation(known) : undefined;
}

/** plugin-http in the app (no CORS), window.fetch in a browser. All three APIs send CORS headers. */
export async function providerFetch(): Promise<FetchLike> {
  if (isTauri) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch as unknown as FetchLike;
  }
  return window.fetch.bind(window) as unknown as FetchLike;
}

/** The Dexie `bibleCache` table as a CacheStore. */
export const dexieCacheStore: CacheStore = {
  get: (key) => db.bibleCache.get(key),
  put: async (row) => {
    await db.bibleCache.put(row);
  },
  listPrefix: (prefix) => db.bibleCache.where("key").startsWith(prefix).toArray(),
  delete: (keys) => db.bibleCache.bulkDelete(keys),
};

export const POLICY: Record<LicensedSourceId, CapPolicy> = {
  esv: ESV_POLICY,
  apibible: APIBIBLE_POLICY,
  nlt: NLT_POLICY,
};

/** Rows of one translation share a prefix, so each text's cap counts only its own verses. */
export const cachePrefix = (t: Translation) => `lic:${t.id}:`;

const verseCount = (ch: Chapter) => ch.items.filter((i) => i.t === "v").length;

const keyFor = (source: LicensedSourceId, keys: BibleKeys) =>
  source === "esv" ? keys.esv : source === "nlt" ? keys.nlt : keys.apiBible;

/** Books with a single chapter (the ESV asks for these by name alone). */
const SINGLE_CHAPTER = new Set(["OBA", "PHM", "2JN", "3JN", "JUD"]);

function fetchFor(t: Translation, f: FetchLike, key: string, ho: string, chapter: number) {
  const name = bookByHo(ho)?.name ?? ho;
  switch (t.source) {
    case "esv":
      return fetchEsvChapter(f, key, { name, chapters: SINGLE_CHAPTER.has(ho) ? 1 : undefined }, chapter);
    case "nlt":
      return fetchNltChapter(f, key, name, chapter);
    default:
      return fetchApiBibleChapter(f, key, t.remoteId ?? "", ho, chapter);
  }
}

export interface LicensedDeps {
  fetch?: FetchLike;
  store?: CacheStore;
  now?: number;
  keys?: BibleKeys;
  /** Verses in the whole book, for the half-a-book cap. */
  bookVerses?: number;
}

export interface LicensedChapter {
  chapter: Chapter | null;
  failure?: LicensedFailure;
  /** API.Bible: report this through FUMS when the chapter is shown (`reportShown`). */
  fumsToken?: string;
}

/** One chapter of a licensed translation, from the capped cache or the provider. */
export async function getLicensedChapter(
  t: Translation,
  ho: string,
  chapter: number,
  deps: LicensedDeps = {},
): Promise<LicensedChapter> {
  const source = t.source as LicensedSourceId;
  const key = keyFor(source, deps.keys ?? useUI.getState().bibleKeys);
  if (!key) return { chapter: null, failure: "no-key" };

  const store = deps.store ?? dexieCacheStore;
  const policy = POLICY[source];
  const cacheKey = `${cachePrefix(t)}${ho}.${chapter}`;
  try {
    const hit = await readCapped(store, cacheKey, policy, deps.now);
    if (hit) {
      const r = JSON.parse(hit) as { chapter: Chapter; fumsToken?: string };
      return { chapter: r.chapter, fumsToken: r.fumsToken };
    }
  } catch {
    // An unreadable cache is only a slower read.
  }

  try {
    const f = deps.fetch ?? (await providerFetch());
    const result = await fetchFor(t, f, key, ho, chapter);
    try {
      await writeCapped(
        store,
        cachePrefix(t),
        { key: cacheKey, json: JSON.stringify(result), verses: verseCount(result.chapter) },
        policy,
        deps.now,
        deps.bookVerses,
      );
    } catch {
      // Not cached; it will be fetched again next time.
    }
    return { chapter: result.chapter, fumsToken: result.fumsToken };
  } catch (e) {
    return { chapter: null, failure: e instanceof LicensedError ? e.failure : "offline" };
  }
}

/**
 * Tell API.Bible's FUMS that a chapter was shown. In the app this is a plain GET
 * through plugin-http; in a browser it is fire-and-forget (`no-cors`), as
 * API.Bible's own tracker does, because the pixel sends no CORS headers.
 */
export async function reportShown(token: string | undefined, fetchFn?: FetchLike): Promise<void> {
  if (!token) return;
  try {
    if (fetchFn) return await reportFums(fetchFn, [token]);
    if (isTauri) return await reportFums(await providerFetch(), [token]);
    await reportFums(
      ((url: string) =>
        window.fetch(url, { mode: "no-cors" }).then(() => ({
          ok: true,
          status: 200,
          json: async () => null,
          text: async () => "",
        }))) as FetchLike,
      [token],
    );
  } catch {
    // Reporting must never break reading; a failed report is simply lost, as with API.Bible's tracker offline.
  }
}

/** Forget every cached chapter of one translation (on removing a key or a text). */
export async function clearLicensedCache(t: Translation, store: CacheStore = dexieCacheStore) {
  const rows = await store.listPrefix(cachePrefix(t));
  if (rows.length) await store.delete(rows.map((r) => r.key));
}

/** Forget every licensed chapter on this device. */
export async function clearAllLicensedCache(store: CacheStore = dexieCacheStore) {
  const rows = await store.listPrefix("lic:");
  if (rows.length) await store.delete(rows.map((r) => r.key));
}
