/**
 * The XENEON Edge deck card's snapshot: what `deck.json` says, worked out from a
 * `deck-source.json` the desktop app writes (src/lib/deckBridge.ts).
 *
 * Two files, because the card must stay right while the app is closed. The source holds
 * everything that needs the app (scripture text, plan labels, the database), including
 * the next weeks' verses and devotions; this renderer turns it into the card's view for
 * a given moment, which needs nothing but the clock. The app renders it whenever it
 * writes the source and once a minute while it runs; `scripts/bol-deck.py` renders the
 * same view from the same source on a timer when the app is closed, so the date rolls
 * over at midnight, the devotion turns to Evening at 17:00 and memory verses come due
 * without the app.
 *
 * KEEP IN STEP with `render()` in scripts/bol-deck.py. scripts/test-deck-snapshot.mjs
 * runs both over the same sources at the same moments and fails if they differ.
 *
 * Pure (imports only ./day.ts and ./streak.ts), so the Node tests can load it directly.
 */
import { localDayKey } from "./day.ts";
import { readingStreak } from "./streak.ts";

export const DECK_SCHEMA_VERSION = 2;
export const DECK_SOURCE_VERSION = 1;
/** The card shows one verse; longer text is cut at a word and ends in "…". */
export const VERSE_MAX_CHARS = 280;

export interface DeckSource {
  source_version: typeof DECK_SOURCE_VERSION;
  /** When the app wrote this source. */
  written_at_ms: number;
  /** Verse of the day for each local date from the day written, several weeks ahead. */
  verses: { date: string; ref: string; text: string; translation: string }[];
  plan: {
    id: string;
    name: string;
    total_days: number;
    completed_count: number;
    /** The first day not yet complete, 0-based; null once the plan is finished. */
    next: { day: number; label: string } | null;
    /** The most recently completed days, newest first: the one finished today is among them. */
    recent: { day: number; label: string; completed_at_ms: number }[];
  } | null;
  /** Every local date with any Bible reading (the streak's days), oldest first. */
  reading_days: string[];
  /** Memory verses by when they are due, soonest first. */
  memory: { ref: string; due_at_ms: number }[];
  devotion: {
    id: string;
    name: string;
    /** One entry per local date, from the day written. */
    days: { date: string; readings: { label: string; ref: string; done: boolean }[] }[];
  } | null;
}

export interface Deck {
  schema_version: typeof DECK_SCHEMA_VERSION;
  /** When this view was rendered. */
  updated_at_ms: number;
  /** When the app last wrote the source it was rendered from. */
  data_as_of_ms: number;
  verse: { ref: string; text: string; translation: string; source: "verse of the day" } | null;
  reading: {
    plan: string | null;
    today: string | null;
    done: boolean;
    streak_days: number;
    /** 1-based day shown in `today`, and the plan's length; null without a plan. */
    day: number | null;
    total_days: number | null;
  };
  memory: { due: number; next_ref: string | null; next_due_at_ms: number | null };
  devotion: { name: string; label: string; ref: string; done: boolean } | null;
}

/** Cut `text` to at most `max` characters at a word boundary, ending in "…". */
export function clipVerse(text: string, max: number = VERSE_MAX_CHARS): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.—–-]+$/, "")}…`;
}

export function renderDeck(src: DeckSource, now: number = Date.now()): Deck {
  const today = localDayKey(now);

  const v = src.verses.find((x) => x.date === today);
  const verse: Deck["verse"] = v ? { ref: v.ref, text: v.text, translation: v.translation, source: "verse of the day" } : null;

  const streak = readingStreak(new Set(src.reading_days), now).days;
  let reading: Deck["reading"] = { plan: null, today: null, done: false, streak_days: streak, day: null, total_days: null };
  const p = src.plan;
  if (p) {
    // As the dashboard's Today card: a day finished today ticks the row (the latest such
    // day, if several); otherwise today's reading is the first day not yet complete.
    const doneToday = p.recent
      .filter((r) => localDayKey(r.completed_at_ms) === today)
      .sort((a, b) => b.day - a.day)[0];
    const base = { plan: p.name, streak_days: streak, total_days: p.total_days };
    if (doneToday) reading = { ...base, today: doneToday.label, done: true, day: doneToday.day + 1 };
    else if (p.next) reading = { ...base, today: p.next.label, done: false, day: p.next.day + 1 };
    else reading = { ...base, today: null, done: true, day: null };
  }

  let due = 0;
  let nextRef: string | null = null;
  let nextDueAt: number | null = null;
  for (const m of src.memory) {
    if (m.due_at_ms <= now) {
      due++;
      if (nextRef === null) nextRef = m.ref;
    } else if (nextDueAt === null || m.due_at_ms < nextDueAt) nextDueAt = m.due_at_ms;
  }

  let devotion: Deck["devotion"] = null;
  const d = src.devotion?.days.find((x) => x.date === today);
  if (src.devotion && d && d.readings.length) {
    // As currentReadingIndex (src/data/devotional.ts): Evening from 17:00.
    const index = d.readings.length > 1 && new Date(now).getHours() >= 17 ? 1 : 0;
    const r = d.readings[index];
    devotion = { name: src.devotion.name, label: r.label, ref: r.ref, done: r.done };
  }

  return {
    schema_version: DECK_SCHEMA_VERSION,
    updated_at_ms: now,
    data_as_of_ms: src.written_at_ms,
    verse,
    reading,
    memory: { due, next_ref: nextRef, next_due_at_ms: nextDueAt },
    devotion,
  };
}
