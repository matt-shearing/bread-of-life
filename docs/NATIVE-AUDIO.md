# Audio playback: how it works

Narration, devotionals and Missler audio all play through one controller
(`src/audio/controller.ts`) and one of three engines (`src/audio/engine.ts`). The controller
owns the queue, auto-advance, marking readings done and the mini-player's state. The engine
plays.

| Platform | Engine | Who plays | Lock screen, keys, widgets |
|---|---|---|---|
| Android app | `NativeEngine` | Media3 ExoPlayer in the native-audio plugin | The plugin's media session (notification, lock screen, earphones, Android Auto) |
| Linux app | `TauriDesktopEngine` | Rust (`src-tauri/src/desktop_audio.rs`) | MPRIS from Rust (`src-tauri/src/media_keys.rs`) |
| Browser, macOS and Windows apps | `Html5Engine` | An `<audio>` element | The web Media Session, driven by the controller |

`selectEngine()` picks the engine once, at start.

## The controller and the engine seam

An engine implements `AudioEngine`:

- `load`, `play`, `pause`, `seekTo`, `currentTime`, `duration`, `release`, and optionally
  `setRate` (`supportsRate`).
- A native-queue engine (`supportsNativeQueue`, Android only) also implements `loadQueue`,
  `queueNext`, `queuePrev` and `queueSkipTo`. It is handed the whole queue and advances by
  itself, even in the background. The other engines play one track at a time and the
  controller steps through the queue.
- `usesWebMediaSession` says whether the controller should drive the web Media Session.
  Only `Html5Engine` needs it.

The engine reports through `EngineHandlers`: time, duration, loading, play and pause, ended,
and on Android also `onIndexChange`, `onFinished`, `onExternalQueue`, `onRate` and
`onPendingCompletions`. On Linux `onRemote` carries media-key commands.

The controller's state is a plain object behind `useSyncExternalStore`. `set()` notifies
subscribers only when something changed. Components read it with
`useAudioSelector((s) => …)`, so only what shows the time re-renders while audio plays;
`useAudio()` returns everything and re-renders on every change.

## Android: the native-audio plugin

`src-tauri/plugins/native-audio` began as tauri-plugin-native-audio 1.0.5 and has been
rewritten for this app. It is Android only. The app calls it only through
`src/audio/nativeAudio.ts`, a typed wrapper; nothing else builds `plugin:native-audio|…`
strings.

### Files

- `NativeAudioPlugin.kt`: `NativeAudioRuntime` owns the one ExoPlayer, the
  `MediaLibrarySession` and the progress tick; `NativeAudioPlugin` holds the commands.
- `NativeAudioService.kt`: the `MediaLibraryService` (notification and foreground state).
- `LibrarySessionCallback.kt`: the session callback and `SessionCommands` (the car's custom
  buttons and speed list).
- `CarLibrary.kt`, `CarData.kt`, `BibleCatalog.kt`, `RefParser.kt`: the Android Auto browse
  tree, media ids, voice search, and `PlaybackStore` (SharedPreferences for the car snapshot,
  Recent, Continue listening and completions; the file is still `tauri_native_audio_car`).
- `ArtworkTiles.kt`: the car's artwork tiles and `ArtworkTilesProvider`.

### Commands

Command names are snake_case in `build.rs`, in the permissions and in JS. Tauri calls the
Kotlin method with the camelCase name (`set_queue` calls `setQueue`).

| Command | What it does |
|---|---|
| `initialize` | Builds the player and session and asks for the notification permission. The app calls it before its first playback, not at start. |
| `get_state` | The current state. Does not build the player. |
| `set_queue` | Loads a playlist (`items`, `startIndex`) and prepares it. |
| `skip_to` | Jumps to `index` of the loaded playlist at `positionSec` and plays. Rejects "stale queue" when `queueGeneration` is not the loaded one. |
| `play`, `pause` | Through `Util.handlePlayButtonAction`, as Media3 does for the lock screen, so Play works after a playback error. |
| `stop` | Unloads the playlist, moves the queue generation on and releases the service binding. The mini-player's ✕. |
| `next`, `previous` | The next chapter; the previous chapter, or the start of this one after 3 s. |
| `seek_to`, `set_rate` | Seek within the item; set the speed for the whole queue. |
| `set_sleep_timer` | `{ atEpochMs }`, `{ endOfItem: true }` or `{ endOfGroup: true }` starts or replaces the sleep timer; no arguments cancel it. See "The sleep timer". |
| `get_queue` | The loaded playlist with each item's chapter and plan position, to adopt a queue the app did not load. |
| `set_car_snapshot` | Stores the app's snapshot for Android Auto (today's plan day, devotional audio, narrator, subtitle). |
| `take_completions`, `ack_completions` | Plan chapters and devotionals heard to the end, and their acknowledgement. `take_car_completions` and `ack_car_completions` are the v0.4.0 names, kept until v0.5. |
| `get_debug_log` | The last 300 audio events, for bug reports (Settings, "Copy audio log"). |
| `register_listener`, `remove_listener` | Handled by Tauri's base `Plugin` class for the state event. They must stay allowed. |

`set_car_snapshot`, the completions and `get_state` read `PlaybackStore` directly and never
build ExoPlayer, so a session that plays nothing creates no player and asks for no
permission.

### The state event

`native_audio_state` carries:

- `status`, `currentTime`, `duration`, `isPlaying`, `buffering`, `rate`, `error`, `index`.
- `capturedAtMs`: monotonic time of the snapshot. JS drops any event older than one it has
  applied, because events queued in a frozen WebView can arrive after a fresher `get_state`.
- `queueGeneration`: bumped by every queue change and by `stop`.
- `queueOrigin`: `"app"`, or `"external"` when the queue came through the session: Android
  Auto, a voice request, the system's resume card, or an earphone press that resumed Continue
  listening after the app's stop. v0.4.0 said `"car"`; JS accepts both.
- `finished`: the indexes of this queue generation that played to their natural end.
- `pendingCompletions`: how many completions wait for the app. The store keeps it as a
  counter.
- `sleepTimer`: `{ mode: "time" | "item" | "group", endsAtEpochMs?, remainingMs? }`, or null
  when no timer runs. Always present.

Native sends the event on every player change, and on a timer while something plays and the
app's activity is on screen: every 500 ms. While the activity is not on screen it sends
nothing on the timer; the tick still runs every 5 s to save the Continue-listening position.
Visibility comes from the plugin's `onResume` and `onStop`. When the app becomes visible
again, native sends the state at once, and `NativeEngine` also reads `get_state` on
`visibilitychange`.

### How the app's queue and native's stay in step

- `playQueue` calls `set_queue`. Events from the queue it replaces (an older generation) are
  ignored from then on.
- A jump in Now Playing, or "Next reading", calls `skip_to`. Until native reports the target
  index, events still showing another index were captured before the jump and are ignored.
  If native has a different queue by then (the car replaced it), `skip_to` fails and the app
  sends the whole queue with `set_queue` instead.
- An external queue is adopted: the app fetches it with `get_queue` and shows it. The app
  also adopts whatever native holds at start.
- `stop` unloads native's queue; the app ignores native until it loads or adopts a queue
  again.

### What counts as heard

Only a chapter that plays to its natural end counts. Native tells the two apart by Media3's
transition reason: `AUTO` (and the end of the playlist) is heard; `SEEK` is a skip, whether it
came from the app, the car's Next or "Next reading", or the lock screen. The app marks each
index in `finished` once.

Native also records every plan chapter (`plan/…` media id) and devotional (`dev/…`) that ends
naturally, whoever loaded the queue, because the app may be gone or frozen by then. The app
gives devotionals it plays the car's id (`dev/spurgeon-morning-evening%3A09-25%3Am`) for this
reason. It collects them at start, on returning to the foreground and when an event reports
some waiting (at most every 5 s), records each with `setChapterDone` or `setDevotionDone`
(`src/audio/nativeCompletions.ts`, `src/audio/carSnapshot.ts`), then acknowledges them. An
entry that fails three times is dropped so that it cannot hold back the rest. Recording is
idempotent.

### Audio focus

Narration is tagged as speech. When another app asks to duck (a navigation prompt in the car),
ExoPlayer pauses speech instead of lowering it, then resumes.

## Earphone buttons and the foreground service (fixed 2026-09)

**Symptom.** Pause from the earphone button, press it again: sound returns for a couple of
seconds, then stops, while the lock-screen progress bar keeps moving.

**Cause.** An earphone, lock-screen or notification command never passes through the app's
JavaScript or `NativeAudioRuntime.play()`. Android delivers it to the `MediaSession`, and
Media3 calls the session's player directly. The service used to be started only by `play()`,
and its notification came from a hand-rolled `PlayerNotificationManager` that switched off
Media3's own foreground handling. Once Android stopped the paused service, nothing brought it
back, ExoPlayer played with no foreground service, and Android froze the process.

**What the code does now.**

- `NativeAudioService` lets Media3 own the notification and the foreground state
  (`DefaultMediaNotificationProvider`, showing back 10 s, play-pause and forward 10 s).
- `NativeAudioRuntime` binds to the service while anything is loaded, so background limits
  cannot stop it during a pause. The binding is dropped by `stop` and when the app is swiped
  away while paused.
- Every play reaches ExoPlayer through the session's `ForwardingPlayer`, whose `play()` and
  `setPlayWhenReady(true)` do the set-up a play needs. The app's own Play goes through it too.
- The app never calls `startForegroundService`, so there is no `startForeground` deadline to
  miss.
- The notification artwork is the app icon, supplied by the session's bitmap loader rather
  than stored in each of the queue's (up to about 1,200) items.

**Evidence for the next report.** Every media-button event, controller command, play and
pause request, audio-focus change and service lifecycle event goes into the debug log
(`get_debug_log`). It also goes to logcat under the tag `BoLAudio` in debug builds, or in a
release build after `adb shell setprop log.tag.BoLAudio DEBUG`.

## The sleep timer

Now Playing offers 5, 10, 15, 30, 45 or 60 minutes, "End of this chapter", and on a plan day
"End of this reading" (the last chapter of the passage playing). The mini-player shows a moon
and the time left. The last 10 seconds fade out, then playback **pauses**, so Play carries on.
Stop and any new queue clear the timer. The controller's `setSleepTimer` and `state.sleep`
are the app's side on every platform.

- **Android**: native runs it, because the WebView's timers are frozen in the background.
  `set_sleep_timer` posts a check on the main looper; while something plays the service is in
  the foreground and ExoPlayer holds a wake lock, so it fires with the screen off. The fade is
  the player's volume. End of chapter uses Media3's `pauseAtEndOfMediaItems` (set only on the
  reading's last chapter for "end of reading"); the chapter is recorded as heard when the
  pause happens, and not again when Play moves on. The state event carries the timer, so a
  timer set from the car shows in the app.
- **Android Auto**: a fourth button (a moon) steps off, 15 min, 30 min, end of chapter, off.
- **Browser and Linux**: the controller runs it, checking on every time update (which a
  playing `<audio>` element keeps firing in a background tab) and once a second. The fade is
  the `<audio>` element's volume, or `desktop_audio_volume` on Linux. At the end of the
  chapter it records the chapter, loads the next one paused and clears the timer.

## Android Auto

The service is a Media3 `MediaLibraryService`, so Android Auto can browse the app and play
from it without the app open. User-facing steps and the GrapheneOS set-up are in
`docs/MOBILE.md` ("Android Auto").

- **Declarations** (the plugin's `AndroidManifest.xml`, merged into the app): the
  `com.google.android.gms.car.application` meta-data pointing at
  `res/xml/automotive_app_desc.xml`; the service, exported, with the `MediaLibraryService`,
  `MediaSessionService` and `android.media.browse.MediaBrowserService` actions; and
  `ArtworkTilesProvider`. CI checks each in the built APK with `aapt`.
- **Browse tree** (`CarLibrary.kt`): Today, Bible, Devotional (only when there is audio),
  Recent. Media ids describe themselves (`ch/JHN/3`, `plan/<plan>/<day>/<reading>/<book>/<chapter>`,
  `dev/<id>`), so any id can be turned back into a queue (`MediaIds` in `CarData.kt`).
- **Data without the app**: the Bible comes from `BibleCatalog.kt`, which builds narration
  URLs with the same pattern as `src/audio/audioUrl.ts` (both are tested against
  `src/audio/audio-url-cases.json`). Today and Devotional come from the app's snapshot
  (`set_car_snapshot`, built in `src/audio/carSnapshot.ts`). Recent and Continue listening are
  recorded natively, for streamable URLs only (never a cache file).
- **Buttons**: back 30 s, next reading, speed and the sleep timer (`SessionCommands`). The speed button steps
  through the app's own speeds (`src/audio/speeds.json`). Previous and next move a whole
  chapter when the command comes from Android Auto and 10 s otherwise (earphones, lock screen).
- **Voice**: `onSetMediaItems` receives the search query; `RefParser.kt` reads book names,
  abbreviations, spoken ordinals and number words. "Resume" goes to `onPlaybackResumption`.
- **Artwork**: amber tiles drawn natively and cached, served from
  `content://<app id>.nativeaudio.artwork/...`. The provider draws only the paths the library
  lists. Tab icons are vector drawables.

## Linux: the Rust player

WebKitGTK plays `<audio>` through GStreamer and aborts the web process on a host without
`gst-plugins-good` (see `docs/DESKTOP.md`), so on Linux the app plays in Rust.

- `desktop_audio_load` returns at once and fetches in the background. A newer load abandons
  an older fetch part-way. A play sent while a track loads is applied when it is ready.
- The sound device opens for a track and closes on stop, on an error and at the end of a
  track, so the device can suspend and a replaced device is found with the next track. It
  stays open while paused.
- The webview polls `desktop_audio_state` every 250 ms while something plays or loads, and
  not while paused or stopped.
- Media keys and the desktop's media widget: the app registers as an MPRIS player
  (`org.mpris.MediaPlayer2.breadoflife`) when the first track loads, and the widget's commands
  reach the controller as `desktop-media-control` events.

## Tests

- `pnpm test:audio` (`scripts/test-audio-queue.mjs`): the real controller and engines against
  stubs of the plugin and React. Jumps, skips and heard chapters, adopting external queues,
  stop, `dev/` ids, lazy start, change-only notifications and selectors, the completions
  drain, the sleep timer's native commands and state, and the Linux engine.
- `pnpm test:audio-url`: the narration URL pattern, shared with the Kotlin side.
- Robolectric (`src-tauri/plugins/native-audio/android/src/test`, run by CI after the APK
  build): `HeadsetResumeTest` (earphone buttons and the service), `AndroidAutoTest` (a Media3
  `MediaBrowser` against the real session), `PlaybackReviewTest` (play after an error, speech
  focus, stop, `skip_to`, completions, artwork paths, speeds), `SleepTimerTest` (the fade and
  pause, end of chapter and of reading, cleared by a new queue and stop), `AudioUrlAgreementTest`, and
  `ArtworkTilesSamplesTest`, which writes sample tiles to `build/car-artwork-samples/`.
- `cd src-tauri && cargo test`: the Rust player's URL resolution, position handling and MP3
  duration scan, and the MPRIS command mapping.
