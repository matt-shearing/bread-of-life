import {
  db,
  uid,
  type HighlightColor,
  type JournalEntry,
  type Prayer,
  type PrayerCategory,
} from "./index";
import { toBbcccvvv, toOsis } from "@/lib/osis";

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

/* ---------------------------------- settings ----------------------------------- */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}
