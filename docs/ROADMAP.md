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

### Decision needed
Adopt **Evolu** (A) and migrate the synced data layer to SQLite, or keep Dexie and hand-roll a
minimal E2E sync service (B)? (C is the quick-but-proprietary fallback.) This gates the sync build.

## Later (unchanged)
- Matt's own commentary corpus as a pluggable source (`~/dev/commentary-parser`).
- Local `sqlite-vec` AI study companion (pairs naturally with the SQLite move in A).
- Red-letter words-of-Jesus (BSB lacks the markup — needs a data source).
