# Bread of Life — working notes for Claude

A warm, **offline-first desktop homebase** for Bible reading, pluggable commentary, journalling,
and — the heart of it — an **answered-prayer log you can look back on**.

> This file is deliberately short. The prior attempts died under a huge agent-orchestration
> meta-framework ("Cracked Jacked Claude"). We are not doing that. Process is not the product.
> Full context lives in `docs/` — read `docs/PROJECT-BRIEF.md` first.

## Stack (decided — do not re-litigate)
- **Tauri 2** (Rust shell) · **Vite + React 18 + TypeScript** · **Tailwind + Radix** primitives.
- **State:** Zustand for UI (`src/store/ui.ts`) — the ONLY UI store. Never add a second state system.
- **Data:** Dexie/IndexedDB for user data (`src/db/`) behind a repository seam; static per-book JSON
  for scripture (`public/bible/bsb/`, `src/data/bible.ts`). Local-first: the device is the source
  of truth. **Optional** account sync (`src/db/sync.ts`, `src/store/syncedPrefs.ts`) talks to a small
  relay in `deploy/sync-server/` (hosted or self-hosted), with opt-in E2E encryption of journal/
  prayers/notes (`src/db/crypto.ts`). The app must work fully with sync off.
- **Verse identity:** OSIS + BBCCCVVV everywhere (`src/lib/osis.ts`).

## Ground rules
1. Ship the emotional core (prayer, warm reader) before anything clever.
2. One stack, one state system, one data source. No pivots.
3. Real data end-to-end — never mock verses.
4. Offline-first, local-first. Sync/accounts are a deliberate *later* decision.
5. Keep it warm and uncluttered (amber, Merriweather scripture, whitespace).

## Commands
- `pnpm dev` — run in a browser (fast iteration).
- `pnpm tauri:dev` — run as the desktop app.
- `pnpm build` — typecheck + production build.
- `pnpm lint` / `pnpm test` — ESLint, and every `scripts/test-*.mjs` + plan checks. CI (`ci.yml`)
  runs typecheck, lint, test and build on every PR.
- `pnpm fetch:bible` — re-download BSB from the HelloAO API into `public/bible/bsb/`.
- `cd src-tauri && cargo check` — validate the Rust shell.

## Layout
- `src/pages/` — one file per route; routes (lazy-loaded) in `src/main.tsx`, HashRouter.
- `src/components/` — by feature (`bible/`, `journal/`, `audio/`, `settings/`, …); `ui.tsx` is the
  small primitive set (Button/Card/Dialog/Popover/…).
- `src/data/` — static content loaders: scripture, commentary, Strong's/cross-refs (`study.ts`), plans.
- `src/db/` — Dexie schema, repositories, sync + E2E crypto. `src/store/` — Zustand UI store.
- `src/audio/` — narration queue/engine (played in Rust on desktop, a native playlist on Android,
  Android Auto in `car.ts`).
- `src/ai/` — the optional study companion's provider client (loaded on demand).
- `src/lib/` — small shared helpers (OSIS, dates, reminders, `htmlToText`, …).
- `src-tauri/plugins/` — our own Tauri plugins: `native-audio` (vendored fork), `reminders`,
  `device-tts`, `all-files`.
- `scripts/` — data ingestion (`fetch-bible`, `build-*`) and the `test-*.mjs` tests.
- Only the journal may import the Tiptap editor (ESLint enforces it) — it's the biggest dependency.

## Roadmap (see brief §9)
SQLite swap → Strong's + cross-refs → Matt's own commentary corpus (from `~/dev/commentary-parser`)
→ reading plans + devotionals → local `sqlite-vec` AI study companion → optional sync.
