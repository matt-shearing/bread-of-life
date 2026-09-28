/**
 * A capped, least-recently-used cache for licensed scripture.
 *
 * Public-domain translations are cached for good once fetched. Licensed ones are
 * not ours to keep: each provider's terms limit how much text an app may hold
 * (Crossway, for one, caps it by verse count). So every licensed chapter is stored
 * with its verse count and the time it was last read, and after each write the
 * provider's rows are trimmed, oldest-read first, until they fit the cap again.
 *
 * The storage is passed in, so the tests can run this against a Map and the app
 * against the Dexie `bibleCache` table (see `dexieCacheStore` in ./index.ts).
 */

export interface CacheRow {
  key: string;
  json: string;
  fetchedAt: number;
  /** Verses in the row, counted against the provider's cap. */
  verses?: number;
  /** Last time the row was read; the eviction order. */
  usedAt?: number;
}

export interface CacheStore {
  get(key: string): Promise<CacheRow | undefined>;
  put(row: CacheRow): Promise<void>;
  /** Every row whose key starts with `prefix`. */
  listPrefix(prefix: string): Promise<CacheRow[]>;
  delete(keys: string[]): Promise<void>;
}

export interface CapPolicy {
  /** Most verses of one translation held at once. 0 means never store. */
  maxVerses: number;
  /** Largest share of any one book held at once (0.5 = half), when the book's size is known. */
  maxBookShare?: number;
  /** Rows older than this are treated as missing and refetched. */
  maxAgeMs?: number;
}

const DAY = 24 * 60 * 60 * 1000;
export const DAYS = (n: number) => n * DAY;

/** The book a cache key belongs to: keys end in `…:<BOOK>.<chapter>`. */
export function bookOfKey(key: string): string | undefined {
  return /:([1-3A-Z]{3})\.\d+$/.exec(key)?.[1];
}

const lastUse = (r: CacheRow) => r.usedAt ?? r.fetchedAt;

/**
 * The keys to delete so that the rows fit within `maxVerses`, least recently used
 * first. `keep` (the row just written) goes last, and is dropped only if it alone
 * is over the cap.
 */
export function evictionFor(rows: CacheRow[], maxVerses: number, keep?: string): string[] {
  let total = rows.reduce((n, r) => n + (r.verses ?? 0), 0);
  if (total <= maxVerses) return [];
  const order = [...rows].sort((a, b) => {
    if (a.key === keep) return 1;
    if (b.key === keep) return -1;
    return lastUse(a) - lastUse(b);
  });
  const out: string[] = [];
  for (const r of order) {
    if (total <= maxVerses) break;
    out.push(r.key);
    total -= r.verses ?? 0;
  }
  return out;
}

/** A cached row's payload, or undefined when missing or stale. Marks the row used. */
export async function readCapped(
  store: CacheStore,
  key: string,
  policy: CapPolicy,
  now: number = Date.now(),
): Promise<string | undefined> {
  const row = await store.get(key);
  if (!row) return undefined;
  if (policy.maxVerses <= 0 || (policy.maxAgeMs !== undefined && now - row.fetchedAt > policy.maxAgeMs)) {
    await store.delete([key]);
    return undefined;
  }
  await store.put({ ...row, usedAt: now });
  return row.json;
}

/**
 * Store a row, then trim the translation's rows (`prefix`) back under the caps:
 * first the row's own book (at most `maxBookShare` of `bookVerses`), then the
 * translation as a whole. A row that could never fit is not stored at all.
 */
export async function writeCapped(
  store: CacheStore,
  prefix: string,
  row: { key: string; json: string; verses: number },
  policy: CapPolicy,
  now: number = Date.now(),
  bookVerses?: number,
): Promise<boolean> {
  const bookCap =
    policy.maxBookShare !== undefined && bookVerses ? Math.floor(bookVerses * policy.maxBookShare) : Infinity;
  if (policy.maxVerses <= 0 || row.verses > policy.maxVerses || row.verses > bookCap) return false;
  await store.put({ ...row, fetchedAt: now, usedAt: now });
  const rows = await store.listPrefix(prefix);
  const book = bookOfKey(row.key);
  const drop = new Set<string>();
  if (bookCap !== Infinity && book) {
    for (const k of evictionFor(rows.filter((r) => bookOfKey(r.key) === book), bookCap, row.key)) drop.add(k);
  }
  for (const k of evictionFor(rows.filter((r) => !drop.has(r.key)), policy.maxVerses, row.key)) drop.add(k);
  if (drop.size) await store.delete([...drop]);
  return true;
}

/** An in-memory CacheStore (tests, and a fallback when IndexedDB is unavailable). */
export function memoryCacheStore(map: Map<string, CacheRow> = new Map()): CacheStore & { map: Map<string, CacheRow> } {
  return {
    map,
    async get(key) {
      return map.get(key);
    },
    async put(row) {
      map.set(row.key, row);
    },
    async listPrefix(prefix) {
      return [...map.values()].filter((r) => r.key.startsWith(prefix));
    },
    async delete(keys) {
      for (const k of keys) map.delete(k);
    },
  };
}
