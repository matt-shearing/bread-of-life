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

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
