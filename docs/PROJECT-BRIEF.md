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
| **Bible** | Reader with **5 translations** (BSB bundled offline; WEB/KJV/ASV/YLT fetched + cached via HelloAO); book/chapter nav; headings; per-verse floating toolbar on click/right-click (highlight ×5 colors, note, copy, → journal, → prayer); **reading-layout toggle** (verse-per-line / flowing); **chapter audio** (BSB narration, 3 narrators); reading position remembered. **Full-text search** across BSB. | parallel view, red-letter (`wordsOfJesus`), better OT Strong's source (OSHB/Berean tables) |
| **Prayer** ⭐ | add/edit prayers; categories; "prayed N times"; **mark answered with date + how God answered**; dedicated **Answered** review; stats; **daily reminders** (bell → dashboard "Pray today" + optional OS notification) | prayer wall (opt-in), recurring/scheduled times |
| **Journal** | rich-ish entries (title/body/tags); link verses; **quick-capture from Bible & prayer** | Tiptap editor, backlinks, search |
| **Study rail** | Tabbed right rail: **Commentary** (public-domain via HelloAO, tracks chapter, cached), **Cross-references** (OpenBible TSK, 342k, CC-BY — click a verse), **Strong's word-study** (BSB word tags + Greek/Hebrew lexicon; NT reliable, OT flagged approximate) | Matt's own `commentary-parser` corpus; split-pane; PDF; morphology |
| **AI companion** | Grounded study chat that includes the current passage as context; **multi-provider** — Claude (Anthropic), OpenAI, Ollama (local open models), or any OpenAI-compatible endpoint; key stored locally; desktop calls route through the Tauri HTTP plugin (no CORS) | streaming responses; local `sqlite-vec` RAG over the whole corpus; per-verse "ask" action |
| **Translations** | 5 public-domain (BSB/WEB/KJV/ASV/YLT). NASB 2020 + Amplified shown but **licence-gated** (Lockman copyright — not in any open repo; needs a licensed provider + key). | wire a licensed provider (API.Bible) behind a key |
| **Dashboard** | warm landing: **cozy countryside background** (plain / still / animated toggle; day+dusk art via Nano Banana), Verse of the Day, **devotional tile** (pop-up reader), Today's Plan, Pray-today, Continue Reading, streak, recent journal | customizable widgets, user-submitted scenes |
| **Devotional** | **Selectable devotionals** (public domain): Spurgeon's _Morning & Evening_ (366d × AM/PM) and _Faith's Checkbook_ (366d daily); picker on the page + dashboard tile; verse refs deep-link into the reader; mark complete; **daily reminder notification** at a set time | more devotionals, streaks, user-added |
| **Plans** | 5 reading plans (John 21d, Proverbs 31d, Psalms 30d, NT 90d, Bible-in-a-Year); progress by chapters read (never "behind"); mark days done; open readings; set active | custom plans, calendar view |
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

**Shipped since v1:** 5 translations + parallel view · full-text search · reading-layout toggle ·
chapter audio · cross-references + Strong's word-study rail · reading plans + Today's-Plan · prayer
reminders · **Spurgeon Morning & Evening devotional + devotional reminders** · **cozy countryside
dashboard background (plain/still/animated)**. (Details in the module table above.)

**Next:**
1. **SQLite swap** for user data — _deliberately deferred._ IndexedDB (Dexie) already persists offline
   inside the Tauri webview, so the swap's real payoff is FTS over notes/journal + portability to the
   `commentary-parser` schema, not "offline". A true `@tauri-apps/plugin-sql` backend can't run in the
   browser dev/verify loop, so it'd cost the fast iteration that's produced all of this. Do it when we
   wire the commentary corpus (which _is_ SQLite), behind the existing `src/db` repository seam.
2. **Streaming** AI responses + **local `sqlite-vec` RAG** over scripture + commentary + notes (semantic study).
3. **Matt's own commentary** as a `CommentarySource` fed from the `commentary-parser` canonical DB.
3. **Better OT Strong's** (OSHB/Open Scriptures or Berean interlinear tables) + morphology; red-letter (`wordsOfJesus`).
4. **AI study companion**: local `sqlite-vec` RAG over the whole corpus (scripture + commentary + notes); capture assistant.
5. **Licensed translations** (NASB/AMP) via API.Bible behind the user's key.
6. **More scenes / user-submitted backgrounds**; true background devotional/prayer notifications when the app is closed (Tauri notification scheduling).
7. **Optional sync** (only if multi-device becomes real): libsql/Turso or a OneQode-hosted endpoint.

## 10. Definition of done for v1

- Open the app → warm dashboard with a real verse.
- Read John 3 in BSB, hover verse 16, highlight it amber, add a note → both persist across reload.
- Add a prayer, mark it answered with a note → it moves to the Answered view and the dashboard count updates.
- Create a journal entry from a highlighted verse.
- Open the commentary rail on a chapter → see Matthew Henry, cached for offline.
- `pnpm build` and `cargo check` (Tauri) both pass.
