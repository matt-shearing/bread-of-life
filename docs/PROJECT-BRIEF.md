# Bread of Life — Project Brief (v1, first-principles)

_2026-07-09. This is the new brief. It supersedes every prior plan. It is deliberately short: the
prior attempts failed from too much plan and too little shipped._

---

## 1. One sentence

**Bread of Life is a warm, self-contained, offline-first desktop "homebase" for busy Christians that
fuses Bible reading, pluggable commentary, journalling, and — above all — an answered-prayer log you
can look back on to see what God has done for you.**

## 2. Who it's for

Busy ordinary Christians (starting with Matt) who currently juggle a Bible app, a prayer list, a
devotional, and a journal, and want them in one calm place that works offline and just _works_.
Not scholars, not a market segment, not a startup.

## 3. Principles (the anti-patterns are load-bearing)

1. **Ship the emotional core first.** The answered-prayer log and a beautiful reader beat any amount
   of scaffolding. If a feature doesn't serve "read the Word / talk to God / remember what He did,"
   it waits.
2. **One stack, decided.** Tauri + React + Tailwind + Dexie. No pivots, no second backend, no auth
   churn. (See `TECH-LANDSCAPE-2026.md` §6.)
3. **One state system, one data source.** Zustand for UI, Dexie for data. Never five.
4. **Real data end-to-end before polish.** No mock verses. (Done: real BSB is bundled.)
5. **Offline-first, local-first, no accounts.** Sync is a later, optional decision.
6. **Warm, not busy.** Amber, serif scripture, generous whitespace, calm. A place you _want_ to open.
7. **No meta-framework.** A lean `CLAUDE.md` and nothing else. The tooling is not the project.
8. **Pluggable everything.** Translations and commentaries are sources behind an interface, so Matt's
   own commentary corpus drops in beside Matthew Henry.

## 4. The homebase modules

| Module | v1 (this build) | Later |
|---|---|---|
| **Bible** | BSB reader; book/chapter nav; headings; per-verse hover actions (highlight ×5 colors, note, copy, → journal, → prayer); reading position remembered | more translations, parallel view, Strong's/word-study, cross-refs, audio (links already in data), reading plans |
| **Prayer** ⭐ | add/edit prayers; categories; "prayed N times"; **mark answered with date + how God answered**; dedicated **Answered** review; stats | reminders, prayer wall (opt-in), recurring |
| **Journal** | rich-ish entries (title/body/tags); link verses; **quick-capture from Bible & prayer** | Tiptap editor, backlinks, search |
| **Commentary** | right-rail that **tracks the current chapter**; public-domain sources via HelloAO (Matthew Henry etc.), cached offline; source picker | Matt's own `commentary-parser` corpus as a source; split-pane; PDF |
| **Dashboard** | warm landing: Verse of the Day, Continue Reading, reading streak, open prayers, recent journal | customizable widgets, Today's Plan / reading-plan progress |
| **Devotional** | — | ingest "The Word for Today" etc.; deep-linked references + back |
| **AI study companion** | — | local RAG (`sqlite-vec`) over scripture + commentary + notes; capture assistant |

⭐ = the differentiating heart.

## 5. Architecture

```
┌──────────────────────────── Tauri 2 (Rust shell) ────────────────────────────┐
│  React 18 + Vite + TS + Tailwind + shadcn/ui                                  │
│                                                                               │
│  UI state ── Zustand (theme, current ref, open panels, selection)             │
│                                                                               │
│  Data ── src/db (repository seam)                                             │
│     ├─ scripture:  static per-book JSON  (public/bible/bsb/*.json)  [offline] │
│     ├─ user data:  Dexie / IndexedDB  (highlights, notes, prayers,            │
│     │              journal, reading progress, settings)            [offline]  │
│     └─ commentary: HelloAO fetch-on-demand → Dexie cache           [online→cached]
│                                                                               │
│  Canonical verse id everywhere:  OSIS ("John.3.16") + BBCCCVVV int            │
└───────────────────────────────────────────────────────────────────────────────┘
```

- The **repository seam** (`src/db/*`) means moving user data from Dexie → SQLite (`@tauri-apps/plugin-sql`)
  later is an internal change; UI is untouched.
- The frontend runs in a **plain browser** (`pnpm dev`) for fast iteration and in **Tauri** (`pnpm tauri:dev`)
  for the real desktop app — same code.

## 6. Data model (v1, Dexie tables — verse-keyed)

- `highlights` — `{ id, osis, bbcccvvv, color, createdAt }`
- `notes` — `{ id, osis, bbcccvvv, body, createdAt, updatedAt }`
- `prayers` — `{ id, title, body, category, status: 'active'|'answered'|'archived', prayedCount, lastPrayedAt, createdAt, answeredAt?, answerNote?, linkedOsis?[] }`
- `journalEntries` — `{ id, title, body, tags[], linkedOsis[], source?, createdAt, updatedAt }`
- `readingProgress` — `{ osis (chapter key), lastVerse, at }` + a derived streak
- `settings` — `{ key, value }` (theme, default translation, commentary source, font size)
- `commentaryCache` — `{ key (source+osisChapter), html, fetchedAt }`

## 7. Design language (from the salvaged `UI-guide.md`)

- **Primary amber `#f59e0b`** (50–900 ramp), indigo secondary, semantic + neutral scales.
- **Inter** for UI; **Merriweather serif @ ~18px** for scripture _only_.
- **Three-pane workspace**: 256px left nav | center content | collapsible right study/context rail.
- Per-verse hover actions; amber-50 highlight surface; cards with soft shadow, 12px radius.
- Light + dark via CSS variables; ≥4.5:1 contrast; keyboard-navigable; 150/300ms easing.

## 8. Scope line for THIS build (v1 "one-shot")

**In:** app shell + theming; Bible reader on real BSB with per-verse actions, highlights & notes;
Prayer module with answered-prayer review; Journal with cross-capture; Dashboard; Commentary right-rail.
Runs in browser and packages under Tauri; typechecks and builds clean.

**Out (documented, not built):** AI, devotionals, reading plans, Strong's/cross-refs, more
translations, sync/accounts, Matt's audio-corpus ingestion (that's `commentary-parser`'s job — this
app _consumes_ its output later).

## 9. Roadmap after v1

1. **SQLite swap** for user data (`@tauri-apps/plugin-sql`) + full-text search over notes/journal.
2. **Strong's + cross-references** (STEPBible CC-BY + OpenBible TSK) as static datasets → word study, cross-ref popups.
3. **Matt's own commentary** as a `CommentarySource` fed from the `commentary-parser` canonical DB.
4. **Reading plans** + Today's-Plan dashboard rail; devotional ingestion with deep-links.
5. **AI study companion**: local `sqlite-vec` RAG over the whole corpus; capture assistant.
6. **Optional sync** (only if multi-device becomes real): libsql/Turso or a OneQode-hosted endpoint.

## 10. Definition of done for v1

- Open the app → warm dashboard with a real verse.
- Read John 3 in BSB, hover verse 16, highlight it amber, add a note → both persist across reload.
- Add a prayer, mark it answered with a note → it moves to the Answered view and the dashboard count updates.
- Create a journal entry from a highlighted verse.
- Open the commentary rail on a chapter → see Matthew Henry, cached for offline.
- `pnpm build` and `cargo check` (Tauri) both pass.
