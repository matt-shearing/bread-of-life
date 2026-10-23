/**
 * The desktop app's half of the XENEON Edge deck card (src/lib/deckSnapshot.ts explains
 * the two files). While the app runs on the Linux desktop it rebuilds `deck-source.json`
 * whenever the plan, memory verses, devotions or reading log change, or the active plan or
 * devotional is switched, and once a minute for the clock; then it renders `deck.json`
 * from it. Both go through `write_deck_snapshot` (src-tauri/src/deck_snapshot.rs).
 *
 * What leaves the app: the verse of the day (BSB, public domain), the plan's name and
 * day labels, reading dates, memory-verse references with their due times, and the
 * devotional's references. No journal, prayer or note text, no keys, nothing licensed.
 */
import { liveQuery, type Subscription } from "dexie";
import { db } from "@/db";
import { readingDaysFromDb } from "@/db/readingLog";
import { getAnyPlan } from "@/data/plans";
import { verseOfTheDay } from "@/data/bible";
import { devotionalById, getDevotionDay, mmdd } from "@/data/devotional";
import { groupDayReadings } from "@/audio/readingGroups";
import { devotionDoneId } from "@/lib/devotionDone";
import { localDayKey } from "@/lib/day";
import { refLabel } from "@/lib/osis";
import { isLinuxDesktop, isTauri } from "@/lib/platform";
import { useUI } from "@/store/ui";
import { clipVerse, DECK_SOURCE_VERSION, renderDeck, type DeckSource } from "./deckSnapshot";

/** Only the Linux desktop app has a deck to feed. */
export const deckSupported = isTauri && isLinuxDesktop;

/** How far ahead the source carries the verse of the day and the devotional. */
const VERSE_DAYS = 31;
const DEVOTION_DAYS = 8;
/** Reading days kept for the streak (a streak longer than this is shown as this). */
const READING_DAYS = 1000;
const TICK_MS = 60_000;
/** Rewrite an unchanged source this often, so `data_as_of_ms` shows the app is alive. */
const SOURCE_REFRESH_MS = 5 * 60_000;

/** Local noon `offset` days from `now` (noon keeps day steps clear of DST changes). */
function noonAfter(now: number, offset: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset, 12).getTime();
}

const dayLabel = (readings: Parameters<typeof groupDayReadings>[0]) =>
  groupDayReadings(readings)
    .map((g) => g.label)
    .join(" · ");

export async function buildDeckSource(
  activePlanId: string | null,
  devotionalId: string,
  now: number = Date.now(),
): Promise<DeckSource> {
  const verses: DeckSource["verses"] = [];
  for (let i = 0; i < VERSE_DAYS; i++) {
    const at = noonAfter(now, i);
    const v = await verseOfTheDay(at);
    if (v.text) verses.push({ date: localDayKey(at), ref: refLabel(v.ho, v.chapter, v.verse), text: clipVerse(v.text), translation: "BSB" });
  }

  let plan: DeckSource["plan"] = null;
  if (activePlanId) {
    const [def, prog] = await Promise.all([getAnyPlan(activePlanId), db.plans.get(activePlanId)]);
    if (def && def.days.length) {
      const done = new Set(prog?.completedDays ?? []);
      let next = 0;
      while (next < def.days.length && done.has(next)) next++;
      const recent = Object.entries(prog?.completedAt ?? {})
        .map(([day, at]) => ({ day: Number(day), at: Number(at) }))
        .filter((r) => done.has(r.day) && def.days[r.day] && Number.isFinite(r.at))
        .sort((a, b) => b.at - a.at || b.day - a.day)
        .slice(0, 4)
        .map((r) => ({ day: r.day, label: dayLabel(def.days[r.day]), completed_at_ms: r.at }));
      plan = {
        id: def.id,
        name: def.name,
        total_days: def.days.length,
        completed_count: [...done].filter((d) => d >= 0 && d < def.days.length).length,
        next: next < def.days.length ? { day: next, label: dayLabel(def.days[next]) } : null,
        recent,
      };
    }
  }

  const reading_days = [...(await readingDaysFromDb())].sort().slice(-READING_DAYS);

  const memory = (await db.memory.orderBy("dueAt").toArray()).map((m) => ({ ref: m.reference, due_at_ms: m.dueAt }));

  let devotion: DeckSource["devotion"] = null;
  const dev = devotionalById(devotionalId);
  const days: NonNullable<DeckSource["devotion"]>["days"] = [];
  for (let i = 0; i < DEVOTION_DAYS; i++) {
    const at = noonAfter(now, i);
    const key = mmdd(new Date(at));
    const day = await getDevotionDay(dev, key).catch(() => null);
    if (!day?.readings.length) continue;
    const ids = day.readings.map((_, idx) => devotionDoneId(dev.id, key, idx, at));
    const doneRows = await db.devotions.bulkGet(ids);
    days.push({
      date: localDayKey(at),
      readings: day.readings.map((r, idx) => ({ label: r.label, ref: r.ref, done: !!doneRows[idx] })),
    });
  }
  if (days.length) devotion = { id: dev.id, name: dev.name, days };

  return { source_version: DECK_SOURCE_VERSION, written_at_ms: now, verses, plan, reading_days, memory, devotion };
}

type Invoke = typeof import("@tauri-apps/api/core").invoke;
let invoke: Invoke | null = null;
let lastSourceKey = "";
let lastSourceAt = 0;
let source: DeckSource | null = null;
let running: Promise<void> | null = null;
let again = false;

/** Rebuild the source and write both files (the source only when it changed, or every few minutes). */
async function refresh(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      invoke ??= (await import("@tauri-apps/api/core")).invoke;
      const { activePlanId, devotionalId } = useUI.getState();
      const now = Date.now();
      const next = await buildDeckSource(activePlanId, devotionalId, now);
      const key = JSON.stringify({ ...next, written_at_ms: 0 });
      const writeSource = key !== lastSourceKey || now - lastSourceAt >= SOURCE_REFRESH_MS;
      if (writeSource) source = next;
      const deck = renderDeck(source ?? next, now);
      await invoke("write_deck_snapshot", {
        source: writeSource ? JSON.stringify(next) : "",
        deck: JSON.stringify(deck),
      });
      if (writeSource) {
        lastSourceKey = key;
        lastSourceAt = now;
      }
    } catch (e) {
      console.warn("deck: snapshot not written", e);
    }
  })().finally(() => {
    running = null;
    if (again) {
      again = false;
      void refresh();
    }
  });
  return running;
}

let timer: ReturnType<typeof setTimeout> | null = null;
function schedule(delay = 500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void refresh(), delay);
}

let watch: Subscription | null = null;
let tick: ReturnType<typeof setInterval> | null = null;
let unsubscribeStore: (() => void) | null = null;

/** Start feeding the deck card. Idempotent; does nothing off the Linux desktop app. */
export function startDeckBridge(): void {
  if (!deckSupported || watch) return;
  // Any write to these tables (a sync pull included) may change the card.
  watch = liveQuery(() =>
    Promise.all([
      db.plans.toArray(),
      db.customPlans.count(),
      db.memory.orderBy("dueAt").keys(),
      db.devotions.count(),
      db.readingLog.count(),
      db.progress.count(),
    ]),
  ).subscribe({
    next: () => schedule(),
    error: (e) => console.error("deck: watch failed", e),
  });
  unsubscribeStore = useUI.subscribe((s, prev) => {
    if (s.activePlanId !== prev.activePlanId || s.devotionalId !== prev.devotionalId) schedule();
  });
  tick = setInterval(() => void refresh(), TICK_MS);
  schedule(0);
}

export function stopDeckBridge(): void {
  watch?.unsubscribe();
  watch = null;
  unsubscribeStore?.();
  unsubscribeStore = null;
  if (tick) clearInterval(tick);
  tick = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
