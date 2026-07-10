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
  const today = new Date().toISOString().slice(0, 10);
  return new Date(p.lastPrayedAt).toISOString().slice(0, 10) !== today;
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
}

export async function updatePrayer(id: string, patch: Partial<Prayer>) {
  await db.prayers.update(id, patch);
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
    repetitions = 0;
    intervalDays = 0;
    lapses += 1;
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
