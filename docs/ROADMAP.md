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
4. Account screen: local-only (default) · hosted (Matt relay) · self-host (relay URL).
5. Deploy the Evolu relay on OneQode ([[oneqode-cloud-deploy-access]]); document self-host `docker run`.

## Later (unchanged)
- Matt's own commentary corpus as a pluggable source (`~/dev/commentary-parser`).
- Local `sqlite-vec` AI study companion (pairs naturally with the SQLite move in A).
- Red-letter words-of-Jesus (BSB lacks the markup — needs a data source).
