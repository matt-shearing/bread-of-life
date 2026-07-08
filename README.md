# 🌾 Bread of Life

A warm, **offline-first desktop homebase** for your devotional life — Bible reading, pluggable
commentary, journalling, and an **answered-prayer log you can look back on to see what God has done**.

Built from a first-principles rethink of several earlier attempts (see `docs/RESEARCH-NOTES.md`).
It is small, local-first, and has no accounts, no cloud, and no meta-framework — on purpose.

## What's in v1 (working)

- **Bible reader** — the Berean Standard Bible (public domain / CC0), all 66 books bundled for full
  offline use. Book/chapter navigation, section headings, and per-verse hover actions: highlight
  (5 colors), note, copy, → journal, → prayer. Your reading position and streak are remembered.
- **Prayers** ⭐ — add prayers, track how often you've prayed, and **mark them answered with a note on
  _how_ God answered**. A dedicated *Answered* view is your record of answered prayer.
- **Journal** — entries with tags and verse links; capture a verse straight from the reader.
- **Commentary rail** — public-domain commentaries (Matthew Henry, JFB, Clarke, Gill, K&D, Tyndale)
  that track the chapter you're reading, cached locally after first fetch. _(Fetched on demand; the
  first view of a chapter needs a connection, then it's offline.)_
- **Dashboard** — a warm landing: Verse of the Day, Continue Reading, reading streak, prayer counts,
  recent journal.

All user data lives locally in your browser/app (IndexedDB). Scripture is static JSON.

## Run it

```bash
pnpm install
pnpm fetch:bible     # downloads the BSB into public/bible/bsb/ (already present after first run)

pnpm dev             # run in a browser at http://localhost:1420
# or
pnpm tauri:dev       # run as the native desktop app
```

Build:

```bash
pnpm build                      # typecheck + web build → dist/
pnpm tauri:build                # native installers (AppImage/deb on Linux, etc.)
```

## Stack

Tauri 2 · React 18 + Vite + TypeScript · Tailwind + Radix · Zustand (UI state) · Dexie (data).
Scripture & commentary come from the [HelloAO Free Use Bible API](https://bible.helloao.org).
See `docs/TECH-LANDSCAPE-2026.md` for the full rationale and `docs/PROJECT-BRIEF.md` for the plan.

## Docs

- `docs/PROJECT-BRIEF.md` — the brief (vision, principles, scope, architecture, roadmap).
- `docs/RESEARCH-NOTES.md` — what the earlier attempts taught us (the archaeology).
- `docs/TECH-LANDSCAPE-2026.md` — technology choices and why.

## Credits & licensing

- **Berean Standard Bible** — public domain (CC0), via HelloAO.
- Commentaries — public domain, via HelloAO.
- The app itself is a personal project.
