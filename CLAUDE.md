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
  for scripture (`public/bible/bsb/`, `src/data/bible.ts`).
- **Sync (optional, shipped):** an account on the hosted or a self-hosted server
  (`deploy/sync-server/`) syncs the Dexie tables by delta sync (`src/db/sync.ts`). A Dexie
  middleware (`src/db/syncTracking.ts`) stamps and queues every write; what syncs is listed in
  `src/db/syncSchema.ts`. Journal, prayers and notes can be end-to-end encrypted. Test with
  `pnpm test:sync` and `pnpm test:sync-server`; client changes must keep working with the
  server version in production (the tests run against v0.4.0's server too).
- **Verse identity:** OSIS + BBCCCVVV everywhere (`src/lib/osis.ts`).

## Ground rules
1. Ship the emotional core (prayer, warm reader) before anything clever.
2. One stack, one state system, one data source. No pivots.
3. Real data end-to-end — never mock verses.
4. Offline-first, local-first. Everything works without an account; sync is opt-in.
5. Keep it warm and uncluttered (amber, Merriweather scripture, whitespace).

## Commands
- `pnpm dev` — run in a browser (fast iteration).
- `pnpm tauri:dev` — run as the desktop app.
- `pnpm build` — typecheck + production build.
- `pnpm fetch:bible` — re-download BSB from the HelloAO API into `public/bible/bsb/`.
- `cd src-tauri && cargo check` — validate the Rust shell.

## Layout
- `src/pages/` — Dashboard, Bible, Prayers, Journal, Settings (routes in `src/main.tsx`, HashRouter).
- `src/components/bible/` — Reader, ChapterPicker, CommentaryRail, CaptureDialog.
- `src/components/ui.tsx` — the small primitive set (Button/Card/Dialog/Popover/…).
- `src/data/` — `bible.ts` (scripture), `commentary.ts` (pluggable commentary sources).
- `scripts/fetch-bible.mjs` — the scripture ingestion pipeline.

## Roadmap (see brief §9)
SQLite swap → Strong's + cross-refs → Matt's own commentary corpus (from `~/dev/commentary-parser`)
→ reading plans + devotionals → local `sqlite-vec` AI study companion. (Optional sync has shipped.)
