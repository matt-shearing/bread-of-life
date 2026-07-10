# Bread of Life — session handoff (2026-07-11)

Comprehensive context for continuing this project after a context compaction. Pairs with
`docs/ROADMAP.md` (the full backlog) and the auto-memory file
`~/.claude/projects/-home-contra-dev/memory/bread-of-life-2026-fresh-start.md`.

---

## 1. What this is
**Bread of Life** — a warm, offline-first "homebase" for the devotional life: Bible reading + pluggable
commentary + journalling + an **answered-prayer log you can look back on** (the emotional core) + reading
plans + devotionals + optional AI study companion + **cross-device sync**. First-principles rebuild that
superseded ~10 prior attempts. Owner/user: **Matt Shearing** (matt@oneqode.com).

- Local dir: `~/dev/bread-of-life-2026`. Repo: **github.com/matt-shearing/bread-of-life** (PUBLIC).
- Stack: **Tauri 2** (Rust shell + system webview) · **React 18 + Vite + TypeScript** · Tailwind + Radix ·
  **Zustand** for UI state (`src/store/ui.ts` — the ONLY UI store) · **Dexie/IndexedDB** for user data
  (`src/db/`, behind a repo seam). Scripture = static per-book JSON (BSB, CC0, bundled). Verse identity =
  OSIS + BBCCCVVV (`src/lib/osis.ts`). HashRouter (`src/main.tsx`). Commentary/other translations from the
  HelloAO Free Use Bible API, cached in Dexie.
- Ground rules (from CLAUDE.md): ship the emotional core first; ONE stack/state/data-source; real data
  end-to-end (never mock verses); offline-first; keep it warm/uncluttered (amber, Merriweather scripture).

## 2. Current shipped state — **v0.2.0** (stable, Latest)
Released on all platforms. Features: Bible reader (BSB + WEB/KJV/ASV/YLT + parallel; NASB/AMP license-gated),
reading-layout toggle, chapter audio, full-text search, **study rail** (Commentary + cross-refs + Strong's;
opens by default on desktop), highlights/notes, **prayers w/ answered-review**, journal (Tiptap), dashboard
(VOTD/streak/plans over a cozy countryside bg), reading plans incl. **Soul Food** (OT·NT·Psalm·Proverbs
Bible-in-a-year), Spurgeon devotionals + reminders, multi-provider AI companion (Claude/OpenAI/Grok/Gemini/
DeepSeek/Ollama; bring-your-own-key), and **cross-device sync** (see §4). In-app **Request a feature / Report
a bug** (opens prefilled GitHub issues). ~40MB static data bundled; fully offline on first launch.

### Distribution (all live)
- **Android**: signed APK via CI (`.github/workflows/android.yml`) on `v*` tag → GitHub Release → Obtainium.
  Keystore `~/bread-of-life-android.jks` (password `~/bread-of-life-android-keystore-info.txt` — BACK UP;
  same key required for all updates). Secrets `ANDROID_KEYSTORE_*` set in the repo.
- **Desktop**: CI matrix (`.github/workflows/desktop.yml`) builds Linux AppImage+deb / Windows nsis .exe /
  macOS universal .dmg on `v*` tags. Unsigned beta (SmartScreen/Gatekeeper notes in release).
- **AUR**: `bread-of-life-bin` (`yay -S bread-of-life-bin`) at **0.2.0**. Repo `~/dev/aur-bread-of-life`
  (`ssh://aur@aur.archlinux.org/bread-of-life-bin.git`, key = default `~/.ssh/id_ed25519`, maintainer
  Matt Shearing <matt@block-sense.io>). Repackages the release `.deb` (SYSTEM webkit → works on Arch).
  To bump: edit `pkgver`, `updpkgsums`, `makepkg --printsrcinfo > .SRCINFO`, commit+push.
- **Website**: **https://breadoflife.dev** (GitHub Pages from `website/index.html`; HTTPS enforced;
  auto-deploys on `website/**` change via `.github/workflows/pages.yml`). Christ-centered design on the app's
  cozy dusk-countryside art.

## 3. Infrastructure / access
- **Domain**: breadoflife.dev (also owns breadoflife.app — see roadmap: migrate later). Registrar Porkbun;
  API creds at `~/.porkbun.json` (chmod 600). DNS script pattern in scratchpad/pb-dns.py.
- **Sync server (LIVE)**: **https://sync.breadoflife.dev** on Matt's OneQode OpenStack cloud. VM
  `bol-sync-01` (oq.small, Singapore), floating IP **202.43.5.120**, SG `bol-sync`. Docker compose at
  `/opt/bol/deploy/sync-server` (our node:sqlite server + Caddy auto-TLS + rate-limit). SSH
  `ssh -i ~/.ssh/hermes_vm ubuntu@202.43.5.120`. Deploy record: `~/dev/oneqode-deploy/deployments/bol-sync.md`.
  OneQode CLI: `~/.venvs/openstack/bin/openstack --os-cloud openstack`; provision via `~/dev/oneqode-deploy/`.

## 4. Cross-device sync — THE big architecture story (read before touching sync)
- **Requirement**: sync prayers/journal/reading-progress/notes/plans across devices; a hosted default +
  optional self-host; refer to the hosted option as **"app-hosted" / "the hosted sync service"** — NEVER by
  Matt's name (his explicit instruction).
- **Evolu was tried and ABANDONED.** Evolu (local-first SQLite-WASM + E2E) needs **OPFS**, and webkit2gtk
  2.52's `FileSystemSyncAccessHandle` backend is **unimplemented** → Evolu can't persist on the Linux desktop
  webview (verified in the real Tauri app; enabling webkit OPFS feature flags exposed the API but the SAH
  backend still throws `NotSupportedError`). The whole Evolu migration lives on the DEAD-END branch
  `feat/sync` — do NOT ship it. Lesson: I recommended Evolu on paper without weighting the OPFS-in-webview
  risk enough; verification caught it.
- **Shipped approach (the standard one)**: keep **Dexie/IndexedDB** (works in EVERY webview incl. desktop —
  proven) + a hand-rolled **delta-sync**. `src/db/sync.ts` = engine: Dexie CRUD hooks stamp `updatedAt` and
  enqueue changed rows into an `outbox` table (guarded by an `applyingRemote` flag so pulls don't echo);
  `pushChanges()` sends the outbox, `pullChanges()` merges last-write-wins by cursor; `syncNow()` (re-runs if
  called mid-sync); `startSync()` in `src/main.tsx` (deferred + guarded). Auth = email+password → HMAC token.
  Transport uses `@tauri-apps/plugin-http` in Tauri (no CORS), `window.fetch` in browser (server sends CORS).
  **repos.ts + all read sites are UNTOUCHED** — the hooks do the work. Account UI = `SyncSettings.tsx`.
  `.env.production` sets `VITE_BOL_SYNC_URL=https://sync.breadoflife.dev` → the Hosted option appears.
  Server: `deploy/sync-server/` (Node built-in `node:sqlite`, per-record LWW, tombstones, scrypt pw;
  Docker + Caddy bundle; also self-hostable). **VERIFIED** end-to-end: 2 real webkit2gtk instances (2×
  WebKitWebDriver) synced bidirectionally + deletes through the LIVE prod server.
- **Known sync gap (being fixed on `feat/sync-onboarding`)**: only NEW edits enqueue via hooks; data created
  BEFORE sign-in never uploaded (Matt hit this — an early phone prayer didn't reach desktop). The
  "Link this device" full backfill (enqueue all local rows on first sign-in) fixes it.

## 5. Key issues & solutions (so they aren't re-hit)
- **Linux blank screen (AppImage)**: two distinct causes. (a) webkit DMABUF renderer — fixed by setting
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` in `src-tauri/src/lib.rs` before the webview inits. (b) the AppImage
  BUNDLES an old ubuntu-built webkit that clashes with Arch's newer system webkit → blank even with (a).
  Fix = strip bundled webkit from the AppImage (branch `fix/appimage-webkit`: post-build extract → delete
  libwebkit2gtk/libjavascriptcoregtk + the webkit2gtk-4.1 helper dir → re-appimagetool). The **.deb/AUR use
  SYSTEM webkit and work** — that's the reliable Linux path for Matt (Arch).
- **Subagents share the main working tree by default** → parallel `git checkout` corrupts each other. MUST
  launch feature subagents with `isolation:"worktree"` (each gets its own worktree; branch visible via shared
  .git). First v0.3 attempt without this clobbered everything (0 commits, discarded).
- **Headless verification harnesses that WORK here** (Xvfb software rendering; the app renders fine in webkit
  so bugs like DMABUF are GPU-specific): (1) Chromium: launch via `run_in_background` (shell `&` trips a
  watchdog → exit 144) + connect-only CDP (don't spawn chromium from the node driver). (2) webkit2gtk: run
  `WebKitWebDriver --port=P --replace-on-new-session` under `xvfb-run` (ONE session per instance → use
  multiple ports for multiple "devices"), MiniBrowser `--automation` (IndexedDB works in it; OPFS does not),
  drive via WebDriver `execute/async` for promise-returning ops. Scripts in the session scratchpad
  (wk-sync2.mjs etc.). (3) Real Tauri app: `xvfb-run pnpm tauri dev` + a Worker/probe reporting via
  tauri-http to a local `python -m http.server`.
- **Version bump**: bump `package.json` + `src-tauri/tauri.conf.json` + `src-tauri/Cargo.toml` (+ `cargo
  update -p bread-of-life --precise X`) together, else bundle filenames mismatch the tag. Settings shows the
  version via `import { version } from "../../package.json"` (was hardcoded "v0.1" — fixed).

## 6. v0.3 IN FLIGHT — feature branches (integrate next; see §7)
All built by `isolation:"worktree"` subagents off `main`, each committed to its branch, tsc+build green:
| Branch | What | Status |
|---|---|---|
| `feat/sync-onboarding` | **Link-this-device backfill** (fixes the sync gap) + first-run onboarding + dashboard sync nudge | ✅ 1 commit |
| `feat/prayers-polish` | custom prayer categories, pull-to-refresh, README update, tauri.localhost investigation (webview origin — not configurable; documented) | ✅ 1 commit |
| `feat/bible-layout` | resizable StudyRail (`railWidth`) + collapsible sidebar (`sidebarCollapsed`) | ✅ 1 commit |
| `feat/swipe-gestures` | swipe next/prev chapter (+ shared `src/lib/useChapterNav.ts`) | ✅ 1 commit |
| `fix/appimage-webkit` | strip bundled webkit from AppImage (workflow step + `scripts/appimage-unbundle-webkit.sh`) | ✅ 1 commit |
| `feat/journal-rich` | tag-in-bible verse linking, read-view+edit, journal↔prayer cross-ref, study-rail References tab | ⏳ building |
| `feat/plan-rails` | guided "on-rails" reading mode (walks a plan's chapters, partial tracking, leave-guard) | ⏳ building |
| `feat/memory-verses` | memory-verse pool + SM-2 spaced-repetition deck + gamify + notify | ❌ agent flaked twice (0 tool uses) — RETRY |

Already on `main` this batch: roadmap (all v0.3 items), Settings real version, reminder-toggle fix.
Already-inline fixes elsewhere: reminder toggle (`SettingsPage.tsx`).

Fixes/inline already committed to main earlier: everything through v0.2.0 + the v0.3 docs + 2 small fixes.

## 7. INTEGRATION PLAN (do this next, ideally clean context)
1. Merge the ready branches into `main` SEQUENTIALLY, running `npx tsc --noEmit` (0) + `pnpm build` after each.
2. Expected CONFLICTS: (a) **multiple Dexie `db.version(N)` bumps** — `feat/journal-rich` (link fields),
   `feat/memory-verses` (new table), `feat/plan-rails` (partial-completion) each add a version; RENUMBER them
   to sequential versions (current max on main = 6, from sync's outbox/syncState). (b) shared files touched by
   several branches: `src/store/ui.ts`, `src/pages/BiblePage.tsx`, `src/components/bible/StudyRail.tsx`
   (References tab in journal vs resize in bible-layout), `src/pages/SettingsPage.tsx`, `src/main.tsx`
   (routes), `src/components/layout/Sidebar.tsx`/`MobileNav.tsx` (nav items). (c) `src/lib/useChapterNav.ts`
   (swipe) may overlap plan-rails' chapter nav.
   Suggested merge order (least→most invasive): appimage-fix → prayers-polish → swipe-gestures → bible-layout
   → sync-onboarding → plan-rails → journal-rich → (memory-verses after retry).
3. RETRY `feat/memory-verses` (fully specced in ROADMAP "## Memory verses"; launch with isolation:"worktree").
4. After integration: bump version, cut **v0.3.0** (CI builds all platforms + the fixed AppImage), update the
   AUR to 0.3.0, and finalize release notes.
5. On-device: have Matt confirm sync backfill + the AppImage fix on his Arch box.

## 8. Deferred backlog (in ROADMAP.md — not yet started)
- **Faithfulness review** — monthly/yearly answered-prayer auto-story → warm PDF/share card.
- **E2E encryption** — journals/prayers sit in PLAINTEXT on the relay until this lands. Design: passphrase/
  recovery-key-derived key, encrypt payloads client-side before push.
- **breadoflife.app migration** — Matt owns it; move site + `sync.breadoflife.app`, keep .dev redirecting,
  make sync URL swappable via config; ensure data/accounts migrate.
- **Chuck Missler "Line by Line" commentary** — source located: `/run/media/contra/Infinar/Chuck Missler/
  The Holy Bible - Chuck Missler -  Line by Line - OT and NT - mp3 with pdf notes` (157 PDFs, Briefings/NT/OT
  + mp3). Build the parser + pluggable commentary source keyed by OSIS. COPYRIGHT: local-only/personal
  (gitignore the notes; don't redistribute), or a user-run build step against their own files. Reuse
  `~/dev/commentary-parser` + the born-digital pdf_to_text approach ([[unlimited-ocr-amd-triage]] memory).

## 9. Matt's standing instructions / preferences
- Ship real, verified, working features; commit incrementally; avoid the old "Cracked Jacked Claude"
  meta-framework bloat that killed prior attempts.
- Hosted sync = "app-hosted"/"the hosted service" — never his name. No personal name on the website either.
- Wants heavy use of well-contextualized subagents (he flagged my context limit); wants docs kept current
  (README/ROADMAP/Settings version were lagging — keep them updated each release).
- Verify things yourself (he pushed back on being asked to test — do it in a VM/harness when possible).
- Memory verses excite him (gamify + tasteful notifications); the answered-prayer log is the emotional core.
