import Dexie, { type EntityTable } from "dexie";

/**
 * The single source of truth for MUTABLE user data. Immutable scripture lives in
 * static JSON (see src/data/bible.ts). Everything here is verse-keyed by OSIS +
 * BBCCCVVV so it round-trips to any Bible software and to Matt's own commentary
 * corpus. This repository seam is what lets us swap Dexie → SQLite later without
 * touching the UI (see docs/PROJECT-BRIEF.md §5).
 */

export type HighlightColor = "amber" | "rose" | "sky" | "green" | "violet";

export interface Highlight {
  id: string; // `${osis}` (one highlight per verse; last color wins)
  osis: string;
  bbcccvvv: number;
  color: HighlightColor;
  createdAt: number;
}

export interface Note {
  id: string; // osis
  osis: string;
  bbcccvvv: number;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export type PrayerStatus = "active" | "answered" | "archived";
export type PrayerCategory = "personal" | "family" | "community" | "thanksgiving" | "world";

export interface Prayer {
  id: string;
  title: string;
  body: string;
  category: PrayerCategory;
  status: PrayerStatus;
  prayedCount: number;
  lastPrayedAt: number | null;
  createdAt: number;
  answeredAt: number | null;
  answerNote: string | null;
  linkedOsis: string[];
  remind?: boolean; // surface daily until prayed for
}

export interface JournalEntry {
  id: string;
  title: string;
  body: string;
  tags: string[];
  linkedOsis: string[];
  source: string | null; // e.g. "bible", "prayer", "manual"
  createdAt: number;
  updatedAt: number;
}

export interface ReadingProgress {
  chapterOsis: string; // "John.3"
  ho: string;
  chapter: number;
  lastVerse: number;
  at: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

export interface CommentaryCache {
  key: string; // `${source}:${chapterOsis}`
  html: string;
  fetchedAt: number;
}

export interface BibleCache {
  key: string; // `${translation}:${chapterOsis}` — non-bundled translations only
  json: string; // serialised Chapter
  fetchedAt: number;
}

export interface PlanProgress {
  planId: string;
  startedAt: number;
  completedDays: number[]; // day indices marked done
}

export interface DevotionDone {
  id: string; // `${MM-DD}:${'m'|'e'}`
  completedAt: number;
}

export interface CustomPlan {
  id: string;
  name: string;
  description: string;
  days: { ho: string; chapter: number }[][];
  createdAt: number;
}

/**
 * A verse the user is memorising, scheduled by a small SM-2 spaced-repetition
 * engine (see gradeReview in src/db/repos.ts). One card per verse, keyed by OSIS.
 * We keep a `text` snapshot so the review deck never has to re-open scripture and
 * so a card survives even if the verse is later re-highlighted/cleared.
 */
export interface MemoryCard {
  id: string; // osis — one card per verse
  osis: string;
  bbcccvvv: number;
  ho: string;
  chapter: number;
  verse: number;
  reference: string; // e.g. "John 3:16"
  text: string; // snapshot of the verse text
  translation: string; // where the snapshot came from (e.g. "BSB")
  source: "reader" | "starter";
  // SM-2 scheduling state
  easeFactor: number; // EF, starts at 2.5, floored at 1.3
  intervalDays: number; // current interval in days (0 = brand new / relearning)
  repetitions: number; // consecutive successful reviews
  lapses: number; // times graded "Again" after being learned
  dueAt: number; // ms timestamp when the card is next due
  lastReviewedAt: number | null;
  createdAt: number;
}

/** Sync bookkeeping (see src/db/sync.ts). */
export interface OutboxEntry {
  key: string; // `${table}:${id}` — dedups repeated edits to one pending change
  table: string;
  id: string;
  op: "upsert" | "delete";
  at: number;
}
export interface SyncStateRow {
  key: string; // single row "main"
  value: unknown;
}

export const db = new Dexie("bread-of-life") as Dexie & {
  highlights: EntityTable<Highlight, "id">;
  notes: EntityTable<Note, "id">;
  prayers: EntityTable<Prayer, "id">;
  journal: EntityTable<JournalEntry, "id">;
  progress: EntityTable<ReadingProgress, "chapterOsis">;
  settings: EntityTable<Setting, "key">;
  commentary: EntityTable<CommentaryCache, "key">;
  bibleCache: EntityTable<BibleCache, "key">;
  plans: EntityTable<PlanProgress, "planId">;
  devotions: EntityTable<DevotionDone, "id">;
  customPlans: EntityTable<CustomPlan, "id">;
  memory: EntityTable<MemoryCard, "id">;
  outbox: EntityTable<OutboxEntry, "key">;
  syncState: EntityTable<SyncStateRow, "key">;
};

db.version(1).stores({
  highlights: "id, osis, bbcccvvv, color, createdAt",
  notes: "id, osis, bbcccvvv, updatedAt",
  prayers: "id, status, category, createdAt, answeredAt",
  journal: "id, createdAt, updatedAt, *tags, *linkedOsis",
  progress: "chapterOsis, at",
  settings: "key",
  commentary: "key, fetchedAt",
});

db.version(2).stores({
  bibleCache: "key, fetchedAt",
});

db.version(3).stores({
  plans: "planId",
});

db.version(4).stores({
  devotions: "id, completedAt",
});

db.version(5).stores({
  customPlans: "id, createdAt",
});

// Cross-device sync: an outbox of pending local changes + a sync-state row.
// Synced records also carry a runtime `updatedAt` (ms) stamped by the hooks in
// src/db/sync.ts — no schema change needed for that (non-indexed field).
db.version(6).stores({
  outbox: "key, at",
  syncState: "key",
});

// Memory verses + SM-2 spaced repetition. `dueAt` is indexed so the review deck
// can cheaply query cards due now. (Version 7 — the integrator will renumber this
// if it collides with another in-flight migration.)
db.version(7).stores({
  memory: "id, osis, bbcccvvv, dueAt, createdAt",
});

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
