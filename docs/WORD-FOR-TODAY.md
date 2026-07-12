# The Word for Today — HELD from release (pending UCB licensing)

**Status:** implemented, working, and verified — but **deliberately NOT merged to `main` or shipped.**
The code lives on branch **`feat/word-for-today`** (built on top of the Soul Food reading-plan rework).

## What it is
A "live-fetch" devotional source that adds **The Word for Today** (Bob & Debby Gass) alongside the
bundled public-domain devotionals (Spurgeon's Morning & Evening, Faith's Checkbook). It fetches the
day's entry at runtime from the publisher's own page, renders it in our devotional style (title,
featured verse, body, a tappable "Bible in a Year" reading, "Read on ucb.co.uk"), and caches only the
most recent days locally for offline re-reading. **No devotional text is bundled in this repo.**

Implementation: `src/data/wordForToday.ts` (fetch via `tauri-plugin-http` → parse the UCB Drupal page
by its field classes → cache in `localStorage`), plus a `source: "web"` branch in `src/data/devotional.ts`,
web extras in `DevotionView.tsx`, and a `ucb.co.uk` opener entry in `src-tauri/capabilities/default.json`.

## Why it's held
**The Word for Today is copyrighted** — "© United Christian Broadcasters, published under licence from
UCB International." Unlike everything else in the app, it is **not public domain**. Fetching it live
(rather than bundling text) is the least-exposed approach, but it still reproduces UCB's proprietary
content in our UI, outside their site — which their terms restrict.

## What's needed before it can ship
**Written permission / a licence from UCB** to display *The Word for Today* in the app. UCB does license
it to third parties (print, email, apps) — contact them via https://www.ucb.co.uk/word-for-today or
publications@ucb.co.uk. Once permission is in hand, merge `feat/word-for-today` and confirm the live
fetch on-device in the real Tauri app (browser dev hits CORS by design; the desktop app does not).
