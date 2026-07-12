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
