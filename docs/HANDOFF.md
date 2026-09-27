# Handoff

Bread of Life v0.4.0 is released on every platform. v0.5.0 is merged on `integrate/v0.5` and waits
for Matt's approval. The v0.5 sync server is written but not deployed, because SSH to the sync VM is
blocked. Read this page, then `CLAUDE.md`, before changing anything. What comes next is in
[`ROADMAP.md`](ROADMAP.md).

## What the app is

Bread of Life is a warm, offline-first home for Bible reading, prayer and journalling. Its heart is
an answered-prayer log you can look back on. Around that sit the Berean Standard Bible (bundled,
plus fifteen free translations fetched on demand, and the ESV, NLT and NASB read with the user's own
key; see [`LICENSED-TRANSLATIONS.md`](LICENSED-TRANSLATIONS.md)), commentary, cross-references and Strong's,
reading plans, Spurgeon's devotionals, Memory Lane, an audio Bible, Android Auto and an optional AI
study companion. Everything works without an account; sync is opt-in.

The owner is Matt Shearing. The repository is public at
[matt-shearing/bread-of-life](https://github.com/matt-shearing/bread-of-life), and the website is
[breadoflife.dev](https://breadoflife.dev). Call the hosted sync option "the hosted sync service",
never by Matt's name.

## How it is built

- **Stack:** Tauri 2, React 18 with Vite and TypeScript, Tailwind with Radix, Zustand for UI state
  and Dexie for user data. `CLAUDE.md` has the rules and the layout; do not add a second state
  system or data source.
- **Platforms:** Android (the main one; Matt uses a Pixel 10 Pro Fold with GrapheneOS), Linux,
  Windows and macOS. iOS is not built.
- **Audio:** on Android a vendored Media3 plugin plays a native queue and serves Android Auto. On the
  Linux desktop, audio plays in Rust, because the WebKitGTK webview aborts on media. See
  [`NATIVE-AUDIO.md`](NATIVE-AUDIO.md).
- **Our Tauri plugins** live in `src-tauri/plugins/`: `native-audio` (Android only), `reminders`
  (exact alarms), `device-tts` (the phone's voice) and `all-files` (all-files access and the folder
  picker).

## Test it

Run these before you push. CI runs the first four on every pull request.

- `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`. `pnpm test` runs every
  `scripts/test-*.mjs` file plus the plan checks.
- `cd src-tauri && cargo check` when you touch Rust. CI's `cargo check --locked` job runs only when
  `src-tauri/` changes.
- `pnpm test:sync`, `pnpm test:backup` and `pnpm test:sync-server` for anything near sync. The
  harness in `scripts/lib/` loads the real `src/db` code as several devices, each with its own
  fake IndexedDB and a clock you can skew. It runs every case against two servers: the v0.4.0
  server read from git, which production runs, and the current one. A client change must pass
  against both.
- The native-audio plugin's Robolectric tests run in the "Android APK" workflow
  (`android.yml`), after the APK builds. That workflow runs on `v*` tags and on manual dispatch, not
  on pull requests. Dispatch it on your branch when you change Kotlin or anything Android.
- For UI changes, drive `pnpm dev` with Playwright at 832×880 (the unfolded Fold), 412×915 and
  1440×900, in light and dark.

Nothing in v0.5 has run on a real phone or in the desktop app yet. Say so in any pull request that
touches native code.

## Release

A release commit changes the version and nothing else.

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, then
   run `cargo update -p bread-of-life --precise <version>` in `src-tauri/`. The bundle names come
   from these, so they must agree with the tag.
2. Update the "Latest" paragraph in `README.md`.
3. Commit as `release: vX.Y.Z — <summary>` and run `scripts/check-release-commit.sh`. It fails on
   any file outside the version files, `README.md`, `CHANGELOG.md`, `docs/` and `fastlane/`.
4. Tag `vX.Y.Z` and push the tag. `desktop.yml` runs the same check as its `release-guard` job,
   builds the Linux, Windows and macOS bundles, attaches them to the release and publishes
   `bread-of-life-bin` to the AUR through `scripts/bump-aur.sh`. `android.yml` builds, signs and
   attaches the APK, which Obtainium picks up.
5. Check that the release has all five assets and that the AUR package moved. The AUR search lags
   the git push by a while.

The release guard exists because v0.3.10's release commit deleted the feature it announced. Make
release commits from a git worktree, not from `~/dev/bread-of-life-2026`, which Syncthing also
touches.

The website is `website/index.html`, published by `pages.yml` from `main` whenever `website/**`
changes.

## Where things live

- **Checkouts:** `~/dev/bread-of-life-2026` is the primary checkout. `main` is checked out in the
  worktree `~/dev/bol-e2e`, so `gh pr merge --delete-branch` fails its local step; the merge still
  lands, and you delete the remote branch by hand. Each branch gets its own worktree under
  `~/dev/bol-*`. Never share one checkout between two sessions.
- **Remotes:** `origin` is GitHub. `forge` is the private Forgejo mirror.
- **Android signing:** the keystore is `~/bread-of-life-android.jks`, and its password is in
  `~/bread-of-life-android-keystore-info.txt`. Every update must use the same key. CI reads it from
  the `ANDROID_KEYSTORE_*` secrets.
- **AUR:** the `aur` job in `desktop.yml` publishes with a key held in the `aur` environment. The
  local copy of the package repository is `~/dev/aur-bread-of-life`.
- **Devotional audio:** 732 MP3s of *Morning and Evening* (Kokoro-82M, voice `bm_george`, 607 MB)
  and a `manifest.json` are assets of the GitHub prerelease `devotional-audio-v1`. The app fetches
  the manifest with `plugin-http`, because GitHub sends no CORS headers, so a plain browser always
  shows "No recording". The generator is `scripts/build-devotional-audio.py`; see
  [`DEVOTIONAL-AUDIO.md`](DEVOTIONAL-AUDIO.md).
- **Sync server:** the code is `deploy/sync-server/`. Production is `https://sync.breadoflife.dev`
  on the OneQode VM `bol-sync-01` (floating IP 202.43.5.120), running Docker Compose in
  `/opt/bol/deploy/sync-server` with Caddy in front. The deployment record is
  `~/dev/oneqode-deploy/deployments/bol-sync.md`. `.env.production` points release builds at it.
- **DNS:** Porkbun, scriptable with the credentials in `~/.porkbun.json`. Matt also owns
  breadoflife.app.

## The sync server cannot be reached by SSH

Since 25 September 2026, port 22 on `bol-sync-01` times out from outside and from `hermes-prod-01`
on the same subnet, while port 443 answers. The fault is the host firewall or sshd, not the
security group. Sync keeps working, but production still runs the v0.4.0 server.

To deploy v0.5:

1. Open the console with `openstack console url show bol-sync-01` and restore SSH.
2. Confirm that `/opt/bol/deploy/sync-server/.env` sets `TOKEN_SECRET`. The v0.5 server refuses to
   start in production without it, and changing it signs everyone out. Existing v0.4.0 tokens and
   password hashes keep working.
3. If Cloudflare fronts the server, set `TRUSTED_PROXIES` to Cloudflare's ranges (listed in the
   server README). Otherwise every user shares one rate-limit bucket.
4. Pull the new bundle and run `docker compose up -d --build`, then check that `/health` lists the
   new `features`.

After the deploy, the app shows the account buttons (sign out everywhere, change password, delete
account) and starts syncing reading history.

## Android and Tauri traps

- **Kotlin command names are camelCase.** A Kotlin `@Command` method is `fun pickFolder`, while the
  Rust command, the JS `invoke` name and the permission id stay `pick_folder`. A mismatch fails at
  run time with "No command pickFolder found".
- **Never call `ndk_context::android_context()` from Rust.** Tauri does not initialise it, so it
  panics, and with `panic = "abort"` the app dies. v0.3.7 crashed on opening Settings this way.
  Reach Android APIs through a Kotlin plugin.
- **Icons after `android init`.** `tauri android init` scaffolds the project with the default Tauri
  icon, so CI runs `pnpm tauri icon src-tauri/app-icon.png` afterwards. The generated
  `src-tauri/gen/android` is not in git; manifest changes need a plugin or a CI patch.
- **minSdk 26.** CI raises the scaffolded `minSdk` to 26 for the native-audio plugin.
- **Blank desktop window on Matt's box.** `pnpm tauri:dev` shows a blank window unless both
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` and `WEBKIT_DISABLE_COMPOSITING_MODE=1` are set. `lib.rs` sets
  only the first.
- **The dependency cooldown.** `pnpm-workspace.yaml` holds `minimumReleaseAge` (three days), so CI
  inherits it. It is not a stray file; keep it committed.
- **Invoke errors are objects.** A rejected `invoke` gives a plain object; print it with
  `JSON.stringify`, not `String(e)`.
- **Tests after merges.** Merging parallel branches has silently dropped handlers before. Run the
  full `pnpm test` after every merge.

## Known open issues

- The v0.5 sync server is not deployed (see above).
- `feat/website-v2` (pull request #18), the rewritten website, targets `main` and is not merged.
- The E2E data key, the AI key and the Bible API keys sit in plain text in localStorage.
- The licensed translations (ESV, NLT, API.Bible) have only run against faked responses; check
  them with real keys (see [`LICENSED-TRANSLATIONS.md`](LICENSED-TRANSLATIONS.md)).
- `prayedCount` and array-valued settings merge as whole rows.
- On Android, `window.print()` probably does nothing, so the Faithfulness review offers Share and
  Copy text instead of a PDF.
- A chapter finished while Android has the app frozen can be logged on two days.
- A symphonia panic while decoding on the desktop cannot be caught and ends the app.
- Browser speech devotionals pause without the sleep-timer fade.
- Android Auto lists refresh only while the app runs.
- Signing up with an email already in use answers 409, which reveals that the account exists.
- `react-router` 6 has two advisories fixed only in version 7.
- The Word for Today is on `feat/word-for-today`, held for UCB's permission. Rebase it before any
  merge.
