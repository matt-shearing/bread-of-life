# Roadmap

Status of the post-v0.1.0 work. Shipping order, not a wishlist.

## ✅ Distribution (done / in progress)
- **Android** — signed APK via CI → GitHub Release → Obtainium. ✅
- **Linux** — AppImage + `.deb` via CI. ✅
- **AUR** — `bread-of-life-bin` published (`yay -S bread-of-life-bin`). ✅
- **Windows / macOS** — CI matrix builds `.exe` (NSIS) + universal `.dmg`. ⏳ unsigned beta
  (see *Code signing* below).

## Platforms

### Windows & macOS (in progress)
`.github/workflows/desktop.yml` now builds all three desktop OSes. Beta bundles are **unsigned**:
- Windows: SmartScreen "More info → Run anyway".
- macOS: right-click → Open (or `xattr -dr com.apple.quarantine`), because unsigned.

**Code signing (next):**
- *macOS* — Apple Developer Program ($99/yr) → Developer ID cert → sign + **notarize** in CI
  (`APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` secrets). Removes Gatekeeper
  friction and is also the prerequisite for the App Store / iOS.
- *Windows* — an Authenticode/OV or EV code-signing cert (~$100–300/yr, e.g. via a CA) → sign the
  NSIS installer. Optional for beta; removes SmartScreen warnings.

### iOS (roadmap — blocked on Apple account)
Tauri targets iOS from the same codebase (`tauri ios init` / `build`). Blockers, in order:
1. **Apple Developer Program** ($99/yr) — required to sign for *any* real device, even free apps.
2. **Distribution channel** — since the app is free and open-source:
   - **TestFlight** (up to 10k testers) — easiest for a beta; still needs a review but lighter.
   - **App Store** — full review; free apps are fine, but review scrutinizes the "bring your own AI
     key" flow and any external links.
   - **AltStore / sideloading** — no App Store, but the user must resign every 7 days (free account)
     or via their own dev account; poor UX. Not recommended as the primary channel.
3. **Build infra** — iOS bundles must build on macOS CI (`macos-latest`) with Xcode + signing certs.

Plan: land macOS signing first (shares the Apple account + certs), then `tauri ios init`, a manual
signed TestFlight build, then wire an iOS CI job once the certs are in secrets.

## Profiles & cross-device sync (design — decision pending)

**Goal:** optional user profiles so reading progress, streaks, prayers, journal, highlights, notes,
and plans sync across a person's devices (desktop ↔ phone ↔ …). Two deployment modes, from the same
codebase:
- **(a) User-controlled / self-hosted** — the sync server is open-source; a user runs their own and
  points the app at it. Their data, their box.
- **(b) Optionally hosted by Matt** — the same server, run on the OneQode OpenStack cloud we already
  have deploy access to. Users who don't want to self-host just sign up.

**Non-negotiables:** offline-first stays (local is always the source of truth; sync is additive);
"local-only, no account" remains the default. Ideally **end-to-end encrypted** so even the hosted
mode can't read journals/prayers — this is what makes "under their control" true even when Matt hosts.

### Options evaluated

| Option | Open + self-host? | E2E | Keeps Dexie? | Effort | Notes |
|---|---|---|---|---|---|
| **A. Evolu** (recommended) | ✅ MIT, self-host relay | ✅ built-in | ❌ moves synced data to SQLite | Medium | Local-first engine: SQLite-WASM client + E2E binary sync protocol + self-hostable relay; works browser/Electron/**React Native**. *Also delivers the long-planned SQLite swap + enables FTS / sqlite-vec later.* |
| **B. Hand-rolled minimal E2E sync** | ✅ we write it | ✅ (via `@noble` crypto) | ✅ stays on Dexie | Medium-High | Oplog + last-write-wins + a tiny sync server on OneQode. Max control, no data-layer change, but we build & maintain the crypto + server + conflict logic ourselves. |
| **C. Dexie Cloud** | ⚠️ self-host = paid commercial license | ✅ | ✅ | Low | Fastest (we already use Dexie), but the self-host edition isn't free/open — fails the "open, under their control" ideal for mode (a). Hosted free tier = 3 users/100MB. |
| CouchDB/PouchDB | ✅ | ➖ add-on | ❌ replace Dexie w/ PouchDB | High | Classic offline sync, but dated and a bigger rewrite than Evolu. |

**Recommendation: A (Evolu).** It's the only option that satisfies *open + self-hostable + optionally-
hosted + E2E* in one MIT codebase, supports our exact platforms (browser desktop + React Native
mobile), and folds in the SQLite migration that was already roadmapped — so we get sync **and** FTS
**and** a future local `sqlite-vec` study companion off one move. The cost is migrating the synced
tables from Dexie → Evolu's SQLite (kept behind the existing `src/db/` repo seam; unsynced/ephemeral
UI state can stay in Zustand/IndexedDB).

**Migration shape (if A):**
1. Introduce Evolu alongside Dexie behind `src/db/`. Model synced entities (prayers, journal,
   highlights, notes, reading-progress, streaks, plans, settings) as Evolu tables.
2. One-time importer: copy existing Dexie rows → Evolu on first run, then read/write via Evolu.
3. Ship an "Account" screen: **local-only** (default) · **self-hosted** (enter relay URL) ·
   **hosted** (sign up on the Matt-run relay). Mnemonic/passphrase = the E2E key; add recovery-code UX.
4. Stand up the Evolu **relay** on OneQode (mode b) via the `oneqode-deploy` flow; document the
   self-host `docker run` (mode a).

### Decision (2026-07-10): **Evolu (A)** ✅
Chosen for the maintenance offload (Evolu owns auth/sync/conflict/security) with a Matt-hosted relay as
the idiot-proof default and self-host as an optional toggle. E2E is *deferred* as a goal but Evolu
provides it inherently (bonus); the only UX cost is a save-once recovery phrase to add a device.

**Spike findings (2026-07-10):**
- **Evolu needs React 19** (`@evolu/react@10` peer `react>=19`; we're on 18.3.1). So step 0 is a
  React 18→19 bump (Radix/Tiptap/Zustand/react-router/Vite6 all support 19). Branch `spike/evolu-sync`
  has the Evolu deps installed as a starting point.
- Current API: `@evolu/common` + `@evolu/react` + `@evolu/react-web`; `createEvolu(evoluReactWebDeps)(
  Schema, { name, transports:[{type:"WebSocket", url}] })`; schema via `Evolu.id()`/`Evolu.NonEmptyString100`
  /`Evolu.SqliteBoolean` (auto system cols createdAt/updatedAt/isDeleted/ownerId); `useEvolu().insert/update`,
  `evolu.createQuery`+`useQuery`. Default public relay `wss://free.evoluhq.com`; self/Matt-host sets a
  custom `transports` url. Relay self-host via `@evolu/relay-node` (`createNodeJsRelay` + a SQLite driver).
- OPFS persistence: **confirmed** Evolu bundles the `opfs-sahpool` VFS (`installOpfsSAHPoolVfs` in its
  sqlite-wasm) → **no COOP/COEP cross-origin-isolation headers required** (those would break the webview
  loading external images/fonts/HelloAO — so this was the key risk, now cleared). React 18→19 upgrade
  also verified clean (typecheck + build). Remaining unknown: OPFS actually *persisting* inside
  webkit2gtk (Linux/Mac desktop) + Android System WebView — needs an on-device check once wired (headless
  Chromium couldn't be driven in this env, and it only proxies the low-risk Chromium/Android path anyway).

**Build order:**
1. **React 19 bump + spike** — upgrade React, wire a minimal Evolu table, verify SQLite-WASM
   persistence works inside the Tauri webviews (webkit2gtk on Linux/Mac via WKWebView, Android System
   WebView) with NO cross-origin-isolation headers. Browser (`pnpm dev`) + Android WebView are
   Chromium-ish (low risk); webkit2gtk/WKWebView need an actual on-device check.
2. Model synced entities as Evolu tables behind `src/db/`; keep ephemeral UI state in Zustand.
3. One-time Dexie→Evolu importer on first run.
4. Account screen: local-only (default) · hosted (the app-hosted relay) · self-host (relay URL).
5. Deploy the Evolu relay on the app cloud; document self-host `docker run`.

## Notifications — proper, cross-platform (requested 2026-07-10)

Today's reminders lean on the web Notification API (in-app scheduler) — they don't fire reliably when
the app is closed and little is on by default. Rebuild on **real OS notifications** via
`tauri-plugin-notification` (desktop incl. Linux + Android), with **scheduled** delivery so they fire
even when the app isn't focused. Each notification **deep-links** to the right screen.

- **Reading-plan reminder** — when enrolled in a plan, a **daily** nudge (default **ON** on enroll) to
  read today's portion; tap → today's reading. User-set time.
- **Devotional reminder** — **opt-in**; tap → straight into the devotional, with a check-off action.
- **Prayer prompts** — an occasional "take a moment to add your prayers" nudge, **default OFF**. Plus
  any prayer with a per-prayer reminder set fires its own daily notification (→ that prayer).
- All toggleable in Settings. Verify delivery per platform (Linux notifications; Android channels +
  scheduled/background delivery — the closed-app case is the real risk). Upgrades `src/lib/notify.ts`.

## Reading plans — "Soul Food" Bible-in-a-year (requested 2026-07-10)

Add a built-in **OT · NT · Psalm · Proverbs** daily plan (the J. Vernon McGee / Chuck Missler-style
4-track "Bible in a year" — a portion from each track every day). Generate the 365-day schedule into
the plans system (`PlanProgress`/`setDayDone`), surface it beside the existing plans, and wire it to the
reading-plan reminder above.

## Later (unchanged)
- Matt's own commentary corpus as a pluggable source (`~/dev/commentary-parser`).
- Local `sqlite-vec` AI study companion (pairs naturally with the SQLite move in A).
- Red-letter words-of-Jesus (BSB lacks the markup — needs a data source).

---

# v0.3 candidate work (captured 2026-07-10 from user feedback)

## Bugs / polish
- **Settings shows "v0.1"** — hardcoded; must read the real app version (import package version). Fix inline.
- **Reminders toggle**: pressing "Off" doesn't switch back to "On" (Settings → Reminders — the Off/On button state is stuck). Fix the toggle logic.
- **Commentary/study rail** should default to OPEN ("appear") on the Bible page on desktop/fold. (An open-on-mount effect exists; verify it actually works in v0.2.0 and make it reliably default-open on ≥md.)
- **Proton Pass / password-manager name is "tauri.localhost"** when creating an account on phone — should be `breadoflife.dev` (or the app name). Driven by the webview origin/hostname; set a proper hostname/identifier (Tauri `app` config / a real origin) so autofill shows the right name.

## Prayers
- **Custom categories** — let users add their own prayer categories (beyond personal/family/community/thanksgiving/world).
- **Pull-to-refresh** (mobile) to force a sync.
- **Journal ↔ prayer cross-referencing** — link prayers to journal entries and vice-versa.

## Journal
- **Rich Bible-verse linking** — a "tag in the Bible" flow: from the journal editor, jump to the Bible, select verse(s), hit OK → return to the journal with those verses inserted as hyperlinks (tap to open the passage later).
- **Read-view by default after submit** — submitting an entry shows a read view; an **Edit** button re-opens the editor.
- **Journal ↔ prayer cross-ref** (see Prayers).

## Bible / study rail (desktop + fold)
- **Resizable commentary side panel** — drag the divider to make it wider/thinner.
- **Collapsible left nav** — a minimise button that collapses the sidebar to icons-only and expands back (Spotify-style).
- **New "References" tab in the study rail** — shows journal/prayer entries that reference the current verse/chapter.

## Sync
- **"Link this device" full backfill** (HIGH PRIORITY — biggest real sync hole): on first sign-in, explicitly enqueue ALL existing local synced-table rows into the outbox (with a progress UI) so pre-existing data uploads. **Root cause of the reported edge case** (an early prayer created before sync existed never uploaded — only NEW changes go through the outbox/hooks; pre-existing rows are never marked dirty). This makes multi-device onboarding trustworthy.
- **E2E encryption** — journals/prayers currently sit in PLAINTEXT on the relay until E2E lands. Design: passphrase/recovery-key-derived key, encrypt row payloads client-side before push; server stores ciphertext. Keep it opt-in-transparent. (Was deferred; now a real privacy item.)

## Onboarding
- **First-run onboarding** — offer to create a hosted-sync account (or skip / self-host) during onboarding, and run a short walkthrough of the main features.
- **Unobtrusive home prompt** — a subtle prompt at the bottom of the dashboard to create a sync account (or set up self-hosted sync) if not signed in.

## Memory verses (new feature — design + build)
- A **memory-verse pool**: add verses while reading (a "memorise" action in the reader, like highlight/note), plus a curated starter set.
- **Spaced repetition** (SM-2-ish, offline) — a short **daily card deck** built from memory-flagged verses + highlights ("Memory Lane"). Uses data people already create in the reader.
- **Gamification** — rewards/streaks for reviewing; occasional **fill-in-the-blank test** cards. Pair with tasteful notifications ("today's verse to hide in your heart").
- Rationale in the user's words: memory verses are one of the best weapons (cf. Jesus using Deuteronomy). Grok's framing: a short daily card deck.

## Answered-prayer "Faithfulness review" (new feature)
- Monthly/yearly **auto-story**: answered prayers + answer notes + linked verses + journal tags, exported as a warm **PDF / share card**. Leans into the emotional core (the answered-prayer log) rather than more study tools.

## Domain / infra
- **Migrate to `breadoflife.app`** (user owns it; also owns breadoflife.dev). Move the site + `sync.breadoflife.app`; ensure all features/data migrate cleanly (accounts, sync URL, DNS). Keep breadoflife.dev working/redirecting during transition. Put behind a config so the sync URL etc. can be swapped without a rebuild ideally.
- **Fix the AppImage on Arch/rolling distros** — it bundles an older (ubuntu-built) webkit that clashes with newer system webkit → blank screen. Fix the Linux build to rely on system webkit (don't bundle it) or otherwise resolve the clash. (.deb/AUR already use system webkit and work.)
- **Docs hygiene** — README + ROADMAP + the in-app version were lagging; keep them updated each release (Grok flagged this).
