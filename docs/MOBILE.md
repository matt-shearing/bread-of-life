# Mobile (Android)

Bread of Life ships as an Android app from the same codebase via **Tauri 2**.
The UI is responsive and foldable-aware: a bottom-nav single-column layout on a
normal phone, and the full desktop-style sidebar + multi-pane layout on tablets
and the **Pixel Fold unfolded** (it switches automatically by screen width).

## How it's distributed

| Channel | Status | How |
|---|---|---|
| **Obtainium** (recommended) | ✅ ready | Point Obtainium at this GitHub repo; it installs/updates from the Release APKs the CI produces. |
| **F-Droid** | ⏳ needs submission | The repo is FOSS and carries `fastlane/` store metadata; inclusion requires a merge request to `fdroiddata`. See below. |
| **Google Play** | ⏳ needs a dev account | Build an AAB and upload in the Play Console. See below. |

## Building the APK (CI)

Local builds need the Android SDK + NDK, so releases are built in GitHub
Actions: `.github/workflows/android.yml`. Push a tag to trigger it:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The workflow installs the Android toolchain, runs `tauri android init` +
`tauri android build --apk`, signs the APK, attaches it to the GitHub Release,
and also uploads it as a build artifact.

**Signing (required for installable / updatable APKs).** Generate a release
keystore once and store it as repo secrets:

```bash
keytool -genkey -v -keystore bol.jks -keyalg RSA -keysize 2048 -validity 10000 -alias bol
base64 -w0 bol.jks   # value for ANDROID_KEYSTORE_BASE64
```

Add secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Keep the keystore safe — updates
must be signed with the same key or installers reject them.

### Building locally (optional)

With Android Studio's SDK + NDK installed and `ANDROID_HOME` / `NDK_HOME` set,
plus the Rust Android targets:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
pnpm android:init      # once — scaffolds src-tauri/gen/android (gitignored)
pnpm android:dev       # run on a device/emulator
pnpm android:build     # produce the APK
```

## Installing via Obtainium

1. Install Obtainium (from F-Droid or its GitHub Releases).
2. **Add App** → paste this repo's URL: `https://github.com/matt-shearing/bread-of-life`.
3. Obtainium finds the latest Release APK and installs it; it auto-checks for
   updates on new releases. The repo is public, so no token is needed.

## Android Auto

Bread of Life has its own icon in the Android Auto launcher. Open it in the car to play the
day's reading, any chapter of the Bible, today's devotional (once its recordings exist) or
something you played recently. It works without opening the app on the phone first.

### What the car shows

Android Auto draws media apps from Google's templates, so the screens look like any other
audio app's. The four tabs along the top are:

- **Today**: *Continue listening* (the last chapter played, from where it stopped), then
  *Play today's reading* (the active plan's day, from the first chapter not yet read), then
  each of the day's readings. A reading already heard has a tick.
- **Bible**: Old Testament or New Testament, then a grid of books, then a grid of chapters.
  Psalms and Isaiah are split into pages of 50 chapters. A chapter plays on through the
  following chapters, up to 150, as the Bible page in the app does.
- **Devotional**: today's Spurgeon *Morning* and *Evening*. The tab appears only when the
  app has recorded audio for today.
- **Recent**: the last ten chapters or devotionals played.

While something plays, the car shows the queue and three extra buttons: back 30 seconds,
next reading (skips the rest of a passage such as "Genesis 1–3") and playback speed (1×,
1.2×, 1.5×, 2×, 0.8×). In the car, the skip buttons move a whole chapter; on earphones they
still move 10 seconds.

Voice works too: "Hey Google, play John 3 on Bread of Life", "play First Corinthians
chapter thirteen on Bread of Life", "play today's reading on Bread of Life", or "resume
Bread of Life".

Chapters finished in the car count towards the reading plan. The phone records them the
next time the app opens.

### Set up on GrapheneOS

Do this once, on the phone, before the first drive.

1. **Install sandboxed Google Play** if it is not already installed: open the **App Store**
   (GrapheneOS's own), and install **Google Play services**.
2. **Install Android Auto** from the GrapheneOS **App Store** as well. GrapheneOS does not
   let Android Auto come from the Play Store or anywhere else.
3. Open **Settings → Apps → Sandboxed Google Play → Android Auto**. Turn on **Allow
   permissions for wired Android Auto** (or the wireless one, for a wireless car). Each
   toggle asks you to confirm. If a wired connection will not start, turn on the wireless
   permissions as well; some cars need them even over a cable.
4. Let Android Auto show apps that did not come from the Play Store. Bread of Life comes
   from Obtainium, and Android Auto hides such apps until you allow them:
   1. Open **Settings → Apps → Android Auto → Additional settings in the app**.
   2. Scroll to the bottom and tap **Version and permissions info** ten times. A message
      says developer mode is on.
   3. Tap the **⋮** menu at the top right, then **Developer settings**.
   4. Scroll to the bottom and turn on **Unknown sources**.
5. Connect to the car. If Bread of Life is not in the car's launcher, disconnect, force-stop
   Android Auto (**Settings → Apps → Android Auto → Force stop**) and connect again. If it is
   still missing, check that the launcher is not hiding it: in Android Auto's settings on the
   phone (the screen from step 4.1), open **Customize launcher** and tick Bread of Life.

GrapheneOS documents steps 1 to 3 in its [usage guide](https://grapheneos.org/usage#android-auto).
Step 4 is Android Auto's own developer setting; Google can change or remove it in an Android
Auto update, and it may need turning on again after one.

### If something goes wrong

In the app, **Settings → Feedback → Copy audio debug log** copies the player's recent
events: every button press from the car, the phone or earphones, what the car asked to play,
and the service starting and stopping. Paste it into a message or a bug report.

## F-Droid submission (when ready)

F-Droid builds from source and requires the app to be fully FOSS. This project
qualifies (Apache/MIT/ISC deps only); scripture and study data are public
domain / CC-BY. The AI companion calls a third-party API **only** when the user
enters their own key — that's the `NonFreeNet` anti-feature, not a build
blocker. Steps:

1. Fork `gitlab.com/fdroid/fdroiddata`.
2. Add `metadata/com.breadoflife.app.yml` (Categories, License `MIT` or your
   chosen SPDX, `RepoType: git`, `Repo:` this URL, a build recipe that runs the
   Tauri Android build, `AutoUpdateMode`/`UpdateCheckMode: Tags`).
3. Reuse the `fastlane/metadata/android/en-US/` text already in this repo.
4. Open a merge request; F-Droid's CI does a reproducible build and publishes.

## Google Play (when ready)

1. Create a Play Console account ($25 one-time).
2. Build an **AAB**: `tauri android build --aab` (add the signing config).
3. Create the app in Play Console, upload the AAB to a track, complete the
   store listing (reuse the `fastlane/` text and screenshots), and submit for
   review.

## Password managers show "tauri.localhost"

When you create/sign in to a sync account on Android, a password manager (Proton
Pass, Bitwarden, Google) saves the entry against **`tauri.localhost`** rather
than `breadoflife.dev` or "Bread of Life".

**Why:** the app runs inside a system WebView whose pages are served from Tauri's
internal custom protocol. On Android/Windows that origin is fixed at
`http://tauri.localhost`; on macOS/iOS/Linux it's `tauri://localhost`. Password
managers key (and label) saved logins by the page **origin**, and Tauri v2
exposes no config to rename that host — it isn't a real domain the app controls,
so there is no `productName`/`identifier`/window-title knob that changes it. A
true fix would require serving the app from an actual `https://breadoflife.dev`
origin (a hosted webview / Digital Asset Links association), which we don't do —
the app is offline-first and loads locally.

**What we did do:** the sign-in UI is a real `<form>` with correct
`autocomplete` hints (`username` / `current-password` / `new-password`) and field
`name`s, so managers reliably recognise the login form and fill the right fields.
The saved entry is still labelled `tauri.localhost`; renaming it is a manual step
in the password manager. (Revisit if we ever move to a hosted-origin webview.)

## Notes

- App id: `com.breadoflife.app`. Min SDK follows Tauri's default (24).
- `src-tauri/gen/` is gitignored and regenerated by `android init`.
- The bundled scripture/study data (~40 MB) is committed, so CI needs no
  network to build — the app is fully offline on first launch (commentary,
  non-BSB translations, and the AI companion are the only online features).
