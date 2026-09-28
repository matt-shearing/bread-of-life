import { db, type ReadingLogEntry, type ReadingSource } from "./index";
import { toOsis } from "@/lib/osis";
import { localDayKey } from "@/lib/day";
import type { Reading } from "@/data/plans";

/**
 * The reading log (ReadingLogEntry in ./index.ts): every chapter read, one row per chapter
 * per local day. Written wherever a chapter counts as read — the reader opening it
 * (`recordProgress`), a plan reading ticked or a plan day marked done (`setChapterDone`,
 * `setDayDone`), and narration heard to the end, including the completions Android
 * collects natively (src/audio/car.ts). The streak and the History page read it.
 */

export const readingLogId = (dayKey: string, osis: string) => `${dayKey}:${osis}`;

/**
 * Record that a chapter was read at `at` (default now). The first record of a chapter on
 * a day wins: reading it again that day changes nothing, so it causes no sync traffic.
 */
export async function logChapterRead(ho: string, chapter: number, source: ReadingSource, at: number = Date.now()): Promise<void> {
  if (!ho || !(chapter > 0)) return;
  const osis = toOsis(ho, chapter);
  const dayKey = localDayKey(at);
  const id = readingLogId(dayKey, osis);
  await db.transaction("rw", db.readingLog, async () => {
    if (await db.readingLog.get(id)) return;
    await db.readingLog.add({ id, dayKey, osis, ho, chapter, source, at });
  });
}

/**
 * A plan day's readings. Custom plans come straight from Dexie; built-in plans are built
 * from the Bible index (fetched). Imported on demand so this module (and repos.ts, which
 * uses it) loads without the scripture loaders, as the Node tests need.
 */
async function planDay(planId: string, day: number): Promise<Reading[] | undefined> {
  const custom = await db.customPlans.get(planId);
  if (custom) return custom.days[day];
  try {
    const { getPlan } = await import("@/data/plans");
    return (await getPlan(planId))?.days[day];
  } catch {
    return undefined;
  }
}

/**
 * Log some (or all, when `indices` is omitted) of a plan day's readings. Never throws:
 * a plan that can't be resolved just isn't logged, and the plan tick itself stands.
 */
export async function logPlanReadings(
  planId: string,
  day: number,
  indices: number[] | undefined,
  source: ReadingSource,
  at: number = Date.now(),
): Promise<void> {
  try {
    const readings = await planDay(planId, day);
    if (!readings) return;
    const pick = indices ?? readings.map((_, i) => i);
    for (const i of pick) {
      const r = readings[i];
      if (r) await logChapterRead(r.ho, r.chapter, source, at);
    }
  } catch (e) {
    console.warn("reading log: plan reading not recorded", e);
  }
}

/* ------------------------------ backfill (once) -------------------------------- */

/** Device-local (not in the synced settings list): each device backfills its own rows once. */
export const BACKFILL_KEY = "readingLog.backfilled";

/**
 * Seed the log from what existed before it, so a streak doesn't collapse on upgrade:
 * each `progress` row gives its chapter on the day it was last read, and each completed
 * plan day gives its chapters on the day it was completed (`completedAt`, or failing
 * that `dayAt`, the day's last change). A half-finished day's ticked readings are placed
 * on its `dayAt`: at least one of them was ticked that day. Runs once per device; the
 * rows sync like any other and their ids match what the other devices derive.
 */
export async function backfillReadingLog(): Promise<number> {
  if (await db.settings.get(BACKFILL_KEY)) return 0;
  const rows = new Map<string, ReadingLogEntry>();
  const add = (ho: string, chapter: number, source: ReadingSource, at: number) => {
    if (!ho || !(chapter > 0) || !(at > 0)) return;
    const osis = toOsis(ho, chapter);
    const dayKey = localDayKey(at);
    const id = readingLogId(dayKey, osis);
    const prev = rows.get(id);
    if (!prev || at < prev.at) rows.set(id, { id, dayKey, osis, ho, chapter, source, at });
  };

  for (const p of await db.progress.toArray()) add(p.ho, p.chapter, "reader", p.at);

  for (const plan of await db.plans.toArray()) {
    const days = new Set<number>([
      ...(plan.completedDays ?? []),
      ...Object.keys(plan.chapterProgress ?? {}).map(Number),
    ]);
    for (const day of days) {
      const done = plan.completedDays?.includes(day);
      const at = (done ? plan.completedAt?.[day] : undefined) ?? plan.dayAt?.[day];
      if (!at) continue;
      const readings = await planDay(plan.planId, day);
      if (!readings) continue;
      const indices = done ? readings.map((_, i) => i) : (plan.chapterProgress?.[day] ?? []);
      for (const i of indices) if (readings[i]) add(readings[i].ho, readings[i].chapter, "plan", at);
    }
  }

  let added = 0;
  await db.transaction("rw", db.readingLog, db.settings, async () => {
    const list = [...rows.values()];
    const existing = await db.readingLog.bulkGet(list.map((r) => r.id));
    const fresh = list.filter((_, i) => !existing[i]);
    if (fresh.length) await db.readingLog.bulkAdd(fresh);
    added = fresh.length;
    await db.settings.put({ key: BACKFILL_KEY, value: Date.now() });
  });
  return added;
}

let backfilling: Promise<number> | null = null;
/** Run the backfill at most once per app start; failures are logged and retried next start. */
export function ensureReadingLogBackfill(): Promise<number> {
  backfilling ??= backfillReadingLog().catch((e) => {
    console.warn("reading log: backfill failed", e);
    backfilling = null;
    return 0;
  });
  return backfilling;
}

/* ------------------------------------ reads ------------------------------------ */

/**
 * Every local day with any reading: the log's days, plus the day of each `progress` row.
 * The progress days matter until the backfill has run, and for readings pulled from a
 * device on an older version (which records only `progress`).
 */
export async function readingDaysFromDb(): Promise<Set<string>> {
  const [keys, progress] = await Promise.all([db.readingLog.orderBy("dayKey").uniqueKeys(), db.progress.toArray()]);
  const out = new Set(keys.map(String));
  for (const p of progress) out.add(localDayKey(p.at));
  return out;
}
