# Audio, Now Playing, Android Auto, spoken devotionals and reading reminders

Date: 2026-09-25. Base: `origin/main` at `5635ec6` (after v0.3.11 and the Linux desktop audio fix).

Matt asked for six things. This plan says what each one is, how it fits the code we already
have, what order to build them in, and how each will be proved to work before it is merged.

| # | Work | Branch | Depends on |
|---|------|--------|------------|
| 1 | Headset pause, then resume, loses the sound | `fix/android-headset-resume` | nothing |
| 2 | Now Playing page with the day's reading list | `feat/now-playing` | nothing (merges after 1) |
| 3 | Daily-reading reminders and streak nudges | `feat/reading-reminders` | nothing |
| 4 | Android Auto | `feat/android-auto` | 1 |
| 5 | Spurgeon's devotionals read aloud | `feat/devotional-audio` | a decision from Matt, then 2 |

Items 1, 2 and 3 start now, in parallel, each in its own worktree. They touch different files
apart from the audio controller, which items 1 and 2 may both edit; whoever merges second
resolves that. Items 4 and 5 start once item 1 is merged, because both change the same Android
audio service.

## How audio works today

- `src/audio/controller.ts` owns the queue, auto-advance, marking chapters read, and the
  mini-player state. It never plays sound itself; it calls an engine.
- `src/audio/engine.ts` picks the engine. On Android it is `NativeEngine`, which drives the
  vendored plugin in `src-tauri/plugins/native-audio/` (Media3 ExoPlayer inside a
  `MediaSessionService`, with a foreground notification). On the Linux desktop it is
  `TauriDesktopEngine` (Rust playback). In a browser it is `Html5Engine`.
- The Kotlin side is `NativeAudioPlugin.kt` (the `NativeAudioRuntime` object holds the one
  ExoPlayer, its `MediaSession`, a progress ticker and a progress checkpoint) and
  `NativeAudioService.kt` (the service and its `PlayerNotificationManager` notification).
- The daily reading plays as a native playlist (`setQueue`), so ExoPlayer advances between
  chapters by itself and tells the app through `onMediaItemTransition`.
- `docs/NATIVE-AUDIO.md` records why it was built this way.

## 1. Headset pause and resume loses the sound

**What Matt sees.** He starts the daily reading on his phone, pauses with the button on his
earphones, then presses it again. Sound comes back for a couple of seconds and then stops, but
the app carries on as though it is playing: the position keeps moving through the chapter.

**Why this path is different.** A pause or play from the earphones does not go through the app's
JavaScript. The earphones send a media-button event to the Android `MediaSession`, and Media3
calls the session's player (the `ForwardingPlayer` wrapped round ExoPlayer) directly. That
bypasses `NativeAudioRuntime.play()`, which is the only place that calls `startService()` and
clears `pendingSeekState`. So the earphone resume path starts playback without the set-up the
in-app button does.

**Likely causes, in the order to check them.**

1. *The service drops out of the foreground on pause and is not promoted back on resume.*
   On pause, `PlayerNotificationManager` posts a non-ongoing notification and the service calls
   `stopForeground(DETACH)`. On an earphone resume nothing calls `startService` or
   `startForeground` again until the notification manager reposts. If the process is in the
   background, Android can restrict or freeze it, and audio stops within seconds while the
   player's clock carries on. The Pixel's "cached app freezer" behaves exactly like this.
2. *Audio focus.* ExoPlayer is set to handle focus (`setAudioAttributes(…, true)`). If the
   WebView holds its own media session or focus from an earlier HTML audio element, a resume
   can bounce focus between them. Check `PlaybackSuppressionReason` and focus-change logs.
3. *Two players.* Confirm that nothing on Android still creates an `Html5Engine` or an `<audio>`
   element (for example `src/components/bible/AudioPlayer.tsx`), and that the WebView's own
   media session is not registered alongside ours.
4. *Stale JavaScript state.* When the WebView is frozen in the background, JS receives a burst
   of queued state events on resume. Check the controller does not answer that burst by
   pausing, seeking or reloading the source.

**What to do.**

- Reproduce it in code first: read the Media3 source for the version pinned in
  `android/build.gradle.kts` and trace exactly what happens on `KEYCODE_MEDIA_PLAY_PAUSE` into a
  `MediaSessionService` whose notification is driven by `PlayerNotificationManager` (we disable
  `onUpdateNotification`, so Media3's own foreground handling is switched off).
- Likely fix: route every play command, whatever its source, through one path that keeps the
  service in the foreground. The cleanest version is to let Media3 manage the notification and
  foreground state (`MediaSessionService`'s default `MediaNotification.Provider`) and delete the
  hand-rolled `PlayerNotificationManager`; this is also what Android Auto (item 4) needs. If
  that is too large a change, override `play()` and `setPlayWhenReady()` on the
  `ForwardingPlayer` so they do what `NativeAudioRuntime.play()` does.
- Add a `MediaSession.Callback` that logs every media-button and controller command with its
  source, behind a debug flag, so the next report comes with evidence.
- Make the JS side trust the native state after a resume: the snapshot from native is the
  source of truth for `playing` and `currentTime`.

**How it will be proved.** No Android SDK is installed on tetelestai, so the APK is built in CI
by dispatching the `Android APK` workflow on the branch, which produces a signed APK. The
agent must also add a Kotlin unit or Robolectric test if the fix is testable that way. Matt then
checks on his phone: start the daily reading, lock the phone, pause from the earphones, wait 30
seconds, resume from the earphones, and listen for two minutes, including across a chapter
change. Repeat with the app in the foreground and with the phone unlocked on another app.

## 2. Now Playing page

Tapping the mini-player opens a full Now Playing view in the app's theme.

- A route (for example `/now-playing`) rendered as a full-screen sheet on phones and a panel on
  desktop. Use the app's existing tokens, fonts and dark mode; no new palette.
- Top: what is playing (book and chapter, the plan and day for a daily reading), a large
  scrubber with elapsed and remaining time, play/pause, previous, next, back 10 s, forward 30 s,
  and a speed control if the engine supports it (`setRate` exists natively).
- Below, for a daily reading: the day's list of readings (Old Testament, New Testament, Psalm,
  Proverbs, or whatever the plan has), each showing done, playing or up next. Tapping one jumps
  to it (`jumpTo`). The list updates as playback moves through the day and marks each part read.
  For ordinary Bible listening, show the next few chapters of the continuous queue.
- "Skip to next reading" moves to the next item in the day, not only the next chapter, where a
  reading spans several chapters. The queue needs to know which reading each track belongs to;
  `src/audio/queue.ts` `buildReadingQueue` is where to add that.
- Swipe down or the back button closes it. The mini-player stays as it is.
- Verify in the browser (`pnpm dev` + Playwright, as in earlier releases): open from the
  mini-player, list reflects the queue, tapping a row jumps, next/previous work, the page
  follows an automatic track change, and the layout holds at phone width and on desktop.

## 3. Daily-reading reminders and streak nudges

Reminders already exist (`src/lib/notify.ts`, OS-scheduled through
`@tauri-apps/plugin-notification`, one daily time per kind, and a `plan` kind). What is missing:

- **Two or more reminder times** for the daily reading, defaulting to 2 pm and 8 pm, each able to
  be switched off, set in Settings.
- **Only if not done.** A reminder should not fire once today's reading is complete. OS
  schedules cannot check that, so: whenever today's reading is completed, cancel today's
  remaining reminders and schedule tomorrow's; on every app start and on sync, reconcile the
  schedule with the actual state. On Android, check whether the plugin supports one-off
  schedules at an exact time (`Schedule.at`) and whether it needs the exact-alarm permission.
- **Streak nudges.** When the current streak is two days or more, the evening reminder says so:
  "You're on a 12-day streak. Today's reading takes about 15 minutes." Use the same streak
  calculation the dashboard uses and `localDayKey` from `src/lib/day.ts` (never UTC dates).
- Tapping the notification opens today's reading. A "Listen now" action that starts the day's
  audio is a stretch goal.
- Sync: the reminder settings are per device and must not be written to the synced `settings`
  table (see the `misslerLibraryPath` mistake). Completion state *does* sync, so a reading done
  on the desktop should cancel the phone's reminder when the phone next syncs.
- Verify with unit tests for the scheduling logic (given today's state and times, which
  notifications should exist), a browser test of the Settings UI, and a CI APK for Matt to
  check on the phone.

## 4. Android Auto

Bread of Life gets its own icon and full-screen app in the Android Auto launcher, as NewPipe
and Pocket Casts do. Android Auto draws a media app's screens from Google's templates (only
navigation apps draw freely, and only on the map), so the work is to use those templates well:

- up to four **browse tabs** across the top (Today, Bible, Devotional, Recent), using the
  content-style hints (`DESCRIPTION_EXTRAS_KEY_CONTENT_STYLE_BROWSABLE_HINT` / `…_PLAYABLE_HINT`)
  for grid tiles or lists as suits each level;
- **artwork** on every item (generated tiles showing the book name and chapter number in the
  app's amber style, and one for the devotional), served through a content provider or bundled
  as bitmaps;
- **custom playback buttons** through Media3 `CommandButton`s on the session: Next reading,
  back 30 s, playback speed;
- the **queue** exposed, so the car shows what is coming up in the day's reading;
- **voice search** (below).

GrapheneOS: Android Auto needs sandboxed Google Play and the Android Auto app, plus
GrapheneOS's Android Auto permission toggles under Settings, Apps, Sandboxed Google Play. The
release notes must spell out those steps as well as the "Unknown sources" step.

- Switch the service from `MediaSessionService` to `MediaLibraryService` and implement
  `MediaLibrarySession.Callback` (`onGetLibraryRoot`, `onGetChildren`, `onGetItem`,
  `onSetMediaItems`, `onSearch`).
- Declare Auto support: `res/xml/automotive_app_desc.xml` with `<uses name="media"/>`, the
  `com.google.android.gms.car.application` meta-data, and the `MediaBrowserService` intent
  filter on the service.
- Suggested tree (short, large targets, nothing more than three taps deep):
  - **Today's reading**: plays the whole day; children are the day's readings.
  - **Continue listening**: resumes where the last session stopped.
  - **Morning and Evening**: today's Spurgeon devotional (once item 5 exists).
  - **Bible**: Old Testament and New Testament, then book, then chapter.
  - **Recent**: the last few chapters played.
- Voice search ("play John 3 on Bread of Life") through `onSearch` and a small reference parser
  (reuse `parseHumanRef` logic on the Kotlin side, or pass the query to JS).
- The tree needs data the Kotlin side does not have: the plan, today's readings, progress and
  the audio URLs. The app is often not running when the car connects, so the WebView cannot be
  relied on. Have JS write a small JSON snapshot (today's queue, continue point, recent items)
  to the plugin whenever it changes, persisted in SharedPreferences, and build the Bible
  book/chapter tree natively from a static book list and the known audio URL pattern.
  Completion events from the car are queued natively and handed to JS on next launch so
  progress still gets recorded.
- **Sideloading catch.** Android Auto hides apps not installed from Google Play unless
  "Unknown sources" is turned on in Android Auto's developer settings (tap the version number
  ten times, then Settings, then Unknown sources). Bread of Life installs through Obtainium, so
  Matt will need to do this once. Put it in `docs/MOBILE.md`.
- Test with the Desktop Head Unit (DHU) from the Android SDK in CI if practical; otherwise Matt
  tests in the car. The Media3 `MediaBrowser` test client can check the tree in a unit test.

## 5. Spurgeon's devotionals read aloud

The Morning and Evening text is public domain and already bundled (366 days × 2). The question
is where the voice comes from. Options:

- **A. Pre-recorded with a good neural voice (recommended).** Generate all 732 readings once
  with a high-quality local text-to-speech model on legion or tetelestai, host the MP3s next to
  the sync server (or on GitHub Releases), and play them through the existing audio queue, so
  they get the Now Playing page, lock-screen controls and Android Auto for free. Roughly 5
  minutes each at 64 kbps is about 1.7 GB in total. Costs a one-off generation run and some
  hosting; sounds far better than the phone's voice and works the same on every platform.
- **B. The phone's own voice.** Android's `TextToSpeech` engine, synthesised to a file by the
  native plugin and played through ExoPlayer. Free and offline, but the voice quality varies by
  phone, and the desktop would need a separate path.
- **C. Both.** Pre-recorded audio where available, the phone's voice as a fallback.

**Decision (Matt, 2026-09-25): C, both.** Pre-recorded audio is the main path; the phone's own
voice is the fallback when the file is not available.

The generation pipeline (a script that turns the bundled text into MP3s, plus voice samples
for Matt to choose from) does not touch the app and starts now on `feat/devotional-audio-pipeline`.
The in-app playback and the phone-voice fallback wait for items 1 and 2. Whichever is chosen, the playback side is the same:
a devotional becomes a `Track` in the queue with a title such as "Morning — Oct 3", and the
Devotional page gets a Listen button.

## Order of merging

1. Item 1 (the bug), after Matt confirms the fix on his phone.
2. Item 2, rebased on item 1.
3. Item 3, whenever it is ready.
4. Items 4 and 5 on top.
5. Then a release through the normal path (`scripts/check-release-commit.sh` guards the
   release commit; the AUR job publishes on tag).

## Rules for the agents doing the work

- Work only in your own worktree. Do not touch `~/dev/bread-of-life-2026` (another session has
  uncommitted work there on `feat/xeneon-edge`) or `~/dev/bol-e2e`.
- `npx tsc --noEmit` and `pnpm build` must pass, but that is not enough: prove the behaviour
  (browser tests for UI, unit tests for logic, a CI APK for Android changes).
- Kotlin `@Command` method names are camelCase; never call `ndk_context::android_context()`
  from Rust.
- Commit on your branch and push it. Open a pull request to `main` with a plain-English summary
  at the top. Do not merge, and do not push `main`.
