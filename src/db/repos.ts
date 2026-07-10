import {
  db,
  uid,
  type HighlightColor,
  type JournalEntry,
  type MemoryCard,
  type Prayer,
  type PrayerCategory,
} from "./index";
import { refLabel, toBbcccvvv, toOsis } from "@/lib/osis";
import { localDayKey } from "@/lib/day";

/* ---------------------------------- highlights --------------------------------- */

export async function setHighlight(ho: string, chapter: number, verse: number, color: HighlightColor) {
  const osis = toOsis(ho, chapter, verse);
  await db.highlights.put({
    id: osis,
    osis,
    bbcccvvv: toBbcccvvv(ho, chapter, verse),
    color,
    createdAt: Date.now(),
  });
}

export async function clearHighlight(ho: string, chapter: number, verse: number) {
  await db.highlights.delete(toOsis(ho, chapter, verse));
}

/* ------------------------------------ notes ------------------------------------ */

export async function saveNote(ho: string, chapter: number, verse: number, body: string) {
  const osis = toOsis(ho, chapter, verse);
  const now = Date.now();
  if (!body.trim()) {
    await db.notes.delete(osis);
    return;
  }
  const existing = await db.notes.get(osis);
  await db.notes.put({
    id: osis,
    osis,
    bbcccvvv: toBbcccvvv(ho, chapter, verse),
    body: body.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/* ----------------------------------- prayers ----------------------------------- */

export async function addPrayer(input: {
  title: string;
  body?: string;
  category?: PrayerCategory;
  linkedOsis?: string[];
  remind?: boolean;
}): Promise<string> {
  const id = uid();
  await db.prayers.add({
    id,
    title: input.title.trim(),
    body: (input.body ?? "").trim(),
    category: input.category ?? "personal",
    status: "active",
    prayedCount: 0,
    lastPrayedAt: null,
    createdAt: Date.now(),
    answeredAt: null,
    answerNote: null,
    linkedOsis: input.linkedOsis ?? [],
    remind: input.remind ?? false,
  });
  return id;
}

export async function toggleRemind(id: string, remind: boolean) {
  await db.prayers.update(id, { remind });
}

/** Active + reminder-on prayers that haven't been prayed for today. */
export function isDueToday(p: { status: string; remind?: boolean; lastPrayedAt: number | null }): boolean {
  if (p.status !== "active" || !p.remind) return false;
  if (!p.lastPrayedAt) return true;
  return localDayKey(p.lastPrayedAt) !== localDayKey();
}

export async function prayedFor(id: string) {
  const p = await db.prayers.get(id);
  if (!p) return;
  await db.prayers.update(id, { prayedCount: p.prayedCount + 1, lastPrayedAt: Date.now() });
}

export async function markAnswered(id: string, answerNote: string) {
  await db.prayers.update(id, {
    status: "answered",
    answeredAt: Date.now(),
    answerNote: answerNote.trim() || null,
  });
}

export async function reopenPrayer(id: string) {
  await db.prayers.update(id, { status: "active", answeredAt: null, answerNote: null });
}

export async function archivePrayer(id: string) {
  await db.prayers.update(id, { status: "archived" });
}

export async function deletePrayer(id: string) {
  await db.prayers.delete(id);
  // drop dangling back-references from any journal entries that pointed here
  const linked = await db.journal.where("linkedPrayerIds").equals(id).toArray();
  for (const j of linked) {
    await updateJournalEntry(j.id, {
      linkedPrayerIds: (j.linkedPrayerIds ?? []).filter((p) => p !== id),
    });
  }
}

export async function updatePrayer(id: string, patch: Partial<Prayer>) {
  await db.prayers.update(id, patch);
}

/* ---------------------------- custom prayer categories ------------------------- */

/** The five built-in categories users can't remove. */
export const BUILTIN_PRAYER_CATEGORIES = ["personal", "family", "community", "thanksgiving", "world"] as const;
const CUSTOM_PRAYER_CATEGORIES_KEY = "prayers.customCategories";

/** User-defined prayer categories, kept in the settings table so they sync across devices. */
export async function getCustomPrayerCategories(): Promise<string[]> {
  const raw = await getSetting<string[]>(CUSTOM_PRAYER_CATEGORIES_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

const builtins = new Set<string>(BUILTIN_PRAYER_CATEGORIES);

/** Add a custom category (deduped against built-ins and existing, case-insensitive). Returns the new list. */
export async function addCustomPrayerCategory(name: string): Promise<string[]> {
  const trimmed = name.trim();
  if (!trimmed) return getCustomPrayerCategories();
  const existing = await getCustomPrayerCategories();
  const lower = trimmed.toLowerCase();
  if (builtins.has(lower) || existing.some((c) => c.toLowerCase() === lower)) return existing;
  const next = [...existing, trimmed];
  await setSetting(CUSTOM_PRAYER_CATEGORIES_KEY, next);
  return next;
}

/** Remove a custom category (does not touch prayers already tagged with it). Returns the new list. */
export async function removeCustomPrayerCategory(name: string): Promise<string[]> {
  const existing = await getCustomPrayerCategories();
  const next = existing.filter((c) => c.toLowerCase() !== name.trim().toLowerCase());
  await setSetting(CUSTOM_PRAYER_CATEGORIES_KEY, next);
  return next;
}

/* ----------------------------------- journal ----------------------------------- */

export async function addJournalEntry(input: {
  title: string;
  body?: string;
  tags?: string[];
  linkedOsis?: string[];
  source?: string;
}): Promise<string> {
  const id = uid();
  const now = Date.now();
  await db.journal.add({
    id,
    title: input.title.trim() || "Untitled entry",
    body: (input.body ?? "").trim(),
    tags: input.tags ?? [],
    linkedOsis: input.linkedOsis ?? [],
    source: input.source ?? "manual",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function updateJournalEntry(id: string, patch: Partial<JournalEntry>) {
  await db.journal.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteJournalEntry(id: string) {
  await db.journal.delete(id);
  // drop dangling back-references from any prayers that pointed here
  const linked = await db.prayers.where("linkedJournalIds").equals(id).toArray();
  for (const p of linked) {
    await db.prayers.update(p.id, {
      linkedJournalIds: (p.linkedJournalIds ?? []).filter((j) => j !== id),
    });
  }
}

/* --------------------------- journal ↔ prayer links ---------------------------- */

/** Cross-reference a journal entry and a prayer, keeping both sides in sync. */
export async function linkJournalPrayer(journalId: string, prayerId: string) {
  const j = await db.journal.get(journalId);
  const p = await db.prayers.get(prayerId);
  if (!j || !p) return;
  const jIds = new Set(j.linkedPrayerIds ?? []);
  const pIds = new Set(p.linkedJournalIds ?? []);
  jIds.add(prayerId);
  pIds.add(journalId);
  await updateJournalEntry(journalId, { linkedPrayerIds: [...jIds] });
  await db.prayers.update(prayerId, { linkedJournalIds: [...pIds] });
}

export async function unlinkJournalPrayer(journalId: string, prayerId: string) {
  const j = await db.journal.get(journalId);
  const p = await db.prayers.get(prayerId);
  if (j) {
    await updateJournalEntry(journalId, {
      linkedPrayerIds: (j.linkedPrayerIds ?? []).filter((id) => id !== prayerId),
    });
  }
  if (p) {
    await db.prayers.update(prayerId, {
      linkedJournalIds: (p.linkedJournalIds ?? []).filter((id) => id !== journalId),
    });
  }
}

/* ---------------------------------- progress ----------------------------------- */

export async function recordProgress(ho: string, chapter: number, lastVerse = 1) {
  await db.progress.put({
    chapterOsis: toOsis(ho, chapter),
    ho,
    chapter,
    lastVerse,
    at: Date.now(),
  });
}

/* ------------------------------- reading plans -------------------------------- */

export async function startPlan(planId: string) {
  const existing = await db.plans.get(planId);
  if (!existing) await db.plans.add({ planId, startedAt: Date.now(), completedDays: [] });
}

export async function setDayDone(planId: string, day: number, done: boolean) {
  const p = await db.plans.get(planId);
  if (!p) {
    if (done) await db.plans.add({ planId, startedAt: Date.now(), completedDays: [day] });
    return;
  }
  const set = new Set(p.completedDays);
  if (done) set.add(day);
  else set.delete(day);
  await db.plans.update(planId, { completedDays: [...set].sort((a, b) => a - b) });
}

/**
 * Tick (or un-tick) a single chapter within a plan day for the guided reader.
 * Persists per-chapter progress so a half-finished day is remembered, and rolls
 * the whole day into `completedDays` once every reading in it is done. Pass
 * `totalChapters` (the day's Reading[] length) so we know when the day is full.
 */
export async function setChapterDone(
  planId: string,
  day: number,
  chapterIndex: number,
  done: boolean,
  totalChapters: number,
) {
  const existing = await db.plans.get(planId);
  const base =
    existing ?? { planId, startedAt: Date.now(), completedDays: [] as number[], chapterProgress: {} };

  const chapterProgress: Record<number, number[]> = { ...(base.chapterProgress ?? {}) };
  const chapters = new Set(chapterProgress[day] ?? []);
  if (done) chapters.add(chapterIndex);
  else chapters.delete(chapterIndex);
  chapterProgress[day] = [...chapters].sort((a, b) => a - b);

  const days = new Set(base.completedDays);
  if (chapters.size >= totalChapters && totalChapters > 0) days.add(day);
  else if (!done) days.delete(day); // only *un-ticking* re-opens the day — ticking a
  // single chapter must never clear a day that was marked done elsewhere (e.g. the
  // dashboard "Mark done"), which writes completedDays without chapterProgress.

  const next = {
    planId,
    startedAt: base.startedAt,
    completedDays: [...days].sort((a, b) => a - b),
    chapterProgress,
  };
  if (existing) await db.plans.update(planId, next);
  else await db.plans.add(next);
}

export async function resetPlan(planId: string) {
  await db.plans.delete(planId);
}

export async function addCustomPlan(
  name: string,
  description: string,
  days: { ho: string; chapter: number }[][],
): Promise<string> {
  const id = `custom-${uid()}`;
  await db.customPlans.add({ id, name: name.trim() || "My plan", description, days, createdAt: Date.now() });
  return id;
}

export async function deleteCustomPlan(id: string) {
  await db.customPlans.delete(id);
  await db.plans.delete(id); // its progress
}

/* ------------------------------- devotional ------------------------------- */

export async function setDevotionDone(id: string, done: boolean) {
  if (done) await db.devotions.put({ id, completedAt: Date.now() });
  else await db.devotions.delete(id);
}

/* ------------------------------- memory verses -------------------------------- */

const DAY_MS = 86_400_000;
const START_EASE = 2.5;
const MIN_EASE = 1.3;

/** The four review buttons. We map them to an SM-2 "quality" (q) score below. */
export type Grade = "again" | "hard" | "good" | "easy";
const QUALITY: Record<Grade, number> = { again: 2, hard: 3, good: 4, easy: 5 };

/**
 * Add a verse to the memory pool (idempotent per verse — re-adding just refreshes
 * the text snapshot, never resets the schedule). New cards are due immediately so
 * they appear in today's deck.
 */
export async function addMemoryVerse(input: {
  ho: string;
  chapter: number;
  verse: number;
  text: string;
  translation?: string;
  source?: MemoryCard["source"];
}): Promise<string> {
  const { ho, chapter, verse } = input;
  const osis = toOsis(ho, chapter, verse);
  const existing = await db.memory.get(osis);
  if (existing) {
    await db.memory.update(osis, { text: input.text.trim(), translation: input.translation ?? existing.translation });
    return osis;
  }
  const now = Date.now();
  await db.memory.put({
    id: osis,
    osis,
    bbcccvvv: toBbcccvvv(ho, chapter, verse),
    ho,
    chapter,
    verse,
    reference: refLabel(ho, chapter, verse),
    text: input.text.trim(),
    translation: input.translation ?? "BSB",
    source: input.source ?? "reader",
    easeFactor: START_EASE,
    intervalDays: 0,
    repetitions: 0,
    lapses: 0,
    dueAt: now, // due right away
    lastReviewedAt: null,
    createdAt: now,
  });
  return osis;
}

export async function removeMemoryVerse(id: string) {
  await db.memory.delete(id);
}

export function isMemorised(card: Pick<MemoryCard, "repetitions" | "intervalDays">): boolean {
  return card.repetitions >= 2 && card.intervalDays >= 21;
}

/**
 * SM-2 (SuperMemo 2) update. Buttons → quality q:
 *   again=2 (fail) · hard=3 · good=4 · easy=5.
 * On a pass (q ≥ 3): interval grows 1 → 6 → round(interval × EF); repetitions++.
 * On a fail  (q < 3): repetitions reset to 0, card relearns from a 1-day interval,
 *   lapses++. Ease factor is nudged by the classic SM-2 formula and floored at 1.3.
 * Returns the updated card.
 */
export async function gradeReview(id: string, grade: Grade): Promise<MemoryCard | undefined> {
  const card = await db.memory.get(id);
  if (!card) return undefined;
  const q = QUALITY[grade];
  const now = Date.now();

  // Ease factor update (identical for pass/fail in SM-2).
  let ef = card.easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ef < MIN_EASE) ef = MIN_EASE;

  let repetitions = card.repetitions;
  let intervalDays = card.intervalDays;
  let lapses = card.lapses;

  if (q < 3) {
    // Failed — relearn. Keep it due again today so it comes back this session.
    // A lapse only counts if the card had actually been learned (a brand-new card
    // that's never been recalled isn't "lapsing").
    if (card.repetitions > 0) lapses += 1;
    repetitions = 0;
    intervalDays = 0;
  } else {
    repetitions += 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.round(card.intervalDays * ef);
    // "Hard" earns a shorter step than "Good"/"Easy" without stalling progress.
    if (grade === "hard" && repetitions > 2) intervalDays = Math.max(1, Math.round(intervalDays * 0.7));
    if (grade === "easy") intervalDays = Math.round(intervalDays * 1.3);
  }

  const dueAt = intervalDays === 0 ? now : now + intervalDays * DAY_MS;
  const patch = { easeFactor: ef, intervalDays, repetitions, lapses, dueAt, lastReviewedAt: now };
  await db.memory.update(id, patch);
  return { ...card, ...patch };
}

/* ---------------------------------- settings ----------------------------------- */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}
