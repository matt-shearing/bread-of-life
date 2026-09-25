# Background audio — native engine plan

The audio Bible plays through a **swappable playback engine** (`src/audio/engine.ts`).
Today the default is `Html5Engine` (an `Audio()` element); OS transport controls come from
the web Media Session (`src/audio/controller.ts`). That gives lock-screen metadata + controls,
but **not** reliable playback when the app is fully backgrounded/closed on Android — a WebView's
media gets suspended and there's no foreground service holding the process alive.

## Why (the AntennaPod answer)
Every real background-audio app plays natively inside a **foreground `MediaSessionService`**
(Media3 / ExoPlayer), declared with `foregroundServiceType="mediaPlayback"` + the
`FOREGROUND_SERVICE(_MEDIA_PLAYBACK)` permissions. The ongoing media notification is what keeps
the OS from killing playback and shows the transport controls. A WebView can't do this from JS.

## The seam (already in place — Option 1 done)
- `src/audio/engine.ts` — `AudioEngine` interface (`load / play / pause / seekTo / currentTime /
  duration / release` + `handlers` for time/duration/ended/play/pause/loading) and `Html5Engine`.
  `selectEngine()` chooses the engine; `usesWebMediaSession` tells the controller whether to run
  the web Media Session (true for HTML5, **false** for native).
- `src/audio/controller.ts` — owns the QUEUE, auto-advance, mark-read-on-finish, mini-player state,
  and (web) Media Session. It only calls the engine; it never touches an `Audio()` element directly.

So swapping in native playback is a **drop-in `NativeEngine` implementing the same interface** —
nothing else in the app changes (mini-player, "Listen the whole day", mark-read all keep working).

## Remaining native wiring (do AFTER `fix/missler-android-media` merges to main)
Two agents editing the Android/`src-tauri` config at once = conflicts, so this half is deferred.

1. **Plugin.** Evaluate [`tauri-plugin-native-audio`](https://github.com/uvarov-frontend/tauri-plugin-native-audio)
   (v1.0.5; Media3 ExoPlayer + MediaSessionService + foreground service; API: `initialize` /
   `setSource({src,id,title,artist,artworkUrl})` / `play` / `pause` / `seekTo` / `getState` /
   `addStateListener`; **no queue** — fine, our controller owns the queue). Caveat: young/small
   (≈8★, AI-built), 0 open issues. If it's not solid, write a minimal own Media3 `MediaSessionService`
   plugin exposing the same handful of calls.
2. **`NativeEngine`** in `src/audio/engine.ts`: implement `AudioEngine` over the plugin
   (`setSource` on `load`, forward `addStateListener` → `handlers.onTime/onEnded/...`),
   `usesWebMediaSession = false`. Make `selectEngine()` return it when
   `"__TAURI_INTERNALS__" in window && isMobile`.
3. **Android config** (the conflict-prone part): plugin's Rust + JS deps, gradle, and manifest
   `<service>` + `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_MEDIA_PLAYBACK` / `POST_NOTIFICATIONS` /
   `WAKE_LOCK` permissions + `src-tauri/capabilities`.
4. **Verify on device** (unavoidable — no audio sink in CI): playback, background-when-closed,
   lock-screen controls, auto-advance on track end, mark-read firing. Desktop stays on `Html5Engine`.

## Foreground service and earphone buttons (fixed 2026-09)

**Symptom.** Pause from the earphone button, press it again: sound returns for a couple of
seconds, then stops, while the lock-screen progress bar keeps moving.

**Cause.** An earphone, lock-screen or notification command never passes through the app's
JavaScript or `NativeAudioRuntime.play()`. Android delivers it to the `MediaSession`, and Media3
calls the session's player directly. The service used to be started only by `play()`
(`startForegroundService`), and its notification came from a hand-rolled
`PlayerNotificationManager`, with `MediaSessionService.onUpdateNotification` overridden to do
nothing, which switched off Media3's own foreground handling. On pause the service left the
foreground. If Android then stopped it (background-service limits about a minute after it
leaves the foreground, or the paused notification being swiped away), nothing brought it back:
`onDestroy` had detached the `PlayerNotificationManager`, and the earphone play path never
called `startService`. ExoPlayer played with no foreground service, Android cached and froze
the process within seconds, and the sound stopped. The system UI kept extrapolating the last
"playing" state, which is why the position appeared to keep moving.

**What the code does now.**

- `NativeAudioService` lets Media3 own the notification and the foreground state
  (`DefaultMediaNotificationProvider`, subclassed only to show back 10 s / play-pause /
  forward 10 s). Media3 promotes the service on every play, whatever sent it, and demotes it
  on pause while keeping the notification.
- `NativeAudioRuntime` binds to the service while anything is loaded, so background limits
  cannot stop it during a pause. The binding is dropped on `dispose` and when the app is
  swiped away while paused.
- Every play reaches ExoPlayer through the session's `ForwardingPlayer`, whose `play()` and
  `setPlayWhenReady(true)` do the set-up a play needs (clear the pending seek and error, make
  sure the service is bound). The app's own Play button goes through the same wrapper.
- The app never calls `startForegroundService` itself, so there is no `startForeground`
  deadline to miss.
- The notification and lock-screen artwork is the app icon, supplied by the session's bitmap
  loader rather than stored in each of the queue's (up to ~1,000) items.
- JS trusts native after a resume: `NativeEngine` re-reads `getState` whenever the WebView
  becomes visible, and drops queued state events older than the newest snapshot
  (`capturedAtMs`).

**Evidence for the next report.** Every media-button event, controller command (with the
sending package and whether it was the media notification, Android Auto or a legacy
Bluetooth controller), play/pause request, audio-focus suppression change and service
lifecycle event goes into a 300-line ring buffer, read with the `get_debug_log` plugin command.
It is also written to logcat under the tag `BoLAudio` in debug builds, or in a release build
after `adb shell setprop log.tag.BoLAudio DEBUG`.

**Tests.** `src-tauri/plugins/native-audio/android/src/test/.../HeadsetResumeTest.kt`
(Robolectric) drives the real Media3 service with earphone-button intents. CI runs it after
the APK build in `.github/workflows/android.yml`.
