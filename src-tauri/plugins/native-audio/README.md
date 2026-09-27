# native-audio (vendored fork)

Bread of Life's Android audio: Media3 ExoPlayer inside a `MediaLibraryService`, with the
lock screen, earphone buttons, the notification and Android Auto all driving the one session.

This began as [tauri-plugin-native-audio](https://github.com/uvarov-frontend/tauri-plugin-native-audio)
1.0.5 (MIT OR Apache-2.0; the licence files are kept here). It has since been rewritten for
this app and is not published anywhere: playlists, skips that are not counted as listening,
completions recorded for the app, Android Auto's browse tree, and so on. The upstream iOS half
and its npm package were removed; the app calls the commands through `src/audio/nativeAudio.ts`.

How it fits together, the commands and the state event: `docs/NATIVE-AUDIO.md`.
Tests (Robolectric, run by CI after the APK build): `android/src/test`.
