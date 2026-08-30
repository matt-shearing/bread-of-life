# Desktop (Linux)

Bread of Life is a real native desktop app — a **Tauri 2** shell (Rust + your
system WebView) around the same UI the phone uses. On Linux it ships two ways:

| Format | Best for | Install |
|---|---|---|
| **AppImage** | Any distro, no install/root | `chmod +x Bread_of_Life_*.AppImage && ./Bread_of_Life_*.AppImage` |
| **.deb** | Debian / Ubuntu / Mint / Pop!_OS | `sudo apt install ./bread-of-life_*_amd64.deb` |

Both are attached to every GitHub Release (built by
`.github/workflows/desktop.yml`), alongside the Android APK.

## Requirements

The system WebView (WebKitGTK 4.1) and GTK 3 must be present — they usually are
on a modern desktop. On a minimal box:

- **Debian/Ubuntu:** `sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0`
- **Arch:** `sudo pacman -S webkit2gtk-4.1 gtk3`
- **Fedora:** `sudo dnf install webkit2gtk4.1 gtk3`

The AppImage bundles the rest. First launch works fully offline — scripture and
study data are baked in; only commentary, non-BSB translations, and the AI
companion reach the network.

## Audio plays in Rust, not in the webview

On Linux the app decodes and plays narration in its own Rust process
(`src-tauri/src/desktop_audio.rs`, rodio on top of cpal) and the webview only
polls it for a position. That is a workaround for a crash, and the crash is
worth understanding before anyone "simplifies" it back to an `<audio>` element.

WebKitGTK plays HTML media through GStreamer, and on Arch `gst-plugins-good` is
an *optional* dependency of `webkit2gtk-4.1`, not a hard one — `pacman -Qi
webkit2gtk-4.1` lists it under **Optional Deps**, next to the mandatory
`gst-plugins-base-libs` and `gst-plugins-bad-libs`. That one package holds
`souphttpsrc`, `autoaudiosink`, `pulsesink`, `mpegaudioparse` and `id3demux`.
Most desktops end up with it because some other media package pulls it in. A
lean install does not, and then the webview cannot build any player at all.

Faced with a pipeline it cannot build, WebKit does not fail the element — it
hits a `RELEASE_ASSERT` and aborts the whole web process. Pressing Listen turned
the window white, and `coredumpctl` showed
`/usr/lib/webkit2gtk-4.1/WebKitWebProcess` taking `SIGABRT` with no app frames
on the stack. Confirmed on webkit2gtk-4.1 2.52.6 under Hyprland; the app's own
audio code was never involved.

Check a machine in three commands, no coredump needed:

```bash
gst-launch-1.0 audiotestsrc num-buffers=5 ! autoaudiosink
gst-launch-1.0 souphttpsrc location=https://example.com ! fakesink
gst-launch-1.0 playbin uri=https://example.com/x.mp3
```

On an affected host the first two answer `erroneous pipeline: no element
"autoaudiosink"` / `no element "souphttpsrc"`, and the third `No URI handler
implemented for "https"`. No audio sink, no HTTPS source: the stack WebKit hands
`<audio>` to has nothing to play with.

Installing the plugins also stops the crash:

```bash
sudo pacman -S gst-plugins-good   # Arch
```

Every user would have had to know that, so the app no longer relies on it.
Playing the audio in Rust takes the host's GStreamer out of the picture
altogether: cpal talks to ALSA (and through it PipeWire) directly, and MP3
decoding happens in Symphonia inside the app.

What is affected where:

- **Linux Tauri** uses the Rust player (`TauriDesktopEngine` in
  `src/audio/engine.ts`).
- **macOS and Windows Tauri** keep the `<audio>` element. WKWebView and WebView2
  play media in-process, with nothing to work around.
- **Android and iOS** are untouched and still use `tauri-plugin-native-audio`
  (Media3 ExoPlayer). The Rust player is `#[cfg(desktop)]` and rodio/cpal are
  scoped to non-mobile targets, so they never enter the mobile build.

Building on Linux now needs ALSA headers (`libasound2-dev` on Debian/Ubuntu,
`alsa-lib` on Arch — already a dependency of a desktop install).

The AUR package (`bread-of-life-bin`) should still depend on `gst-plugins-good`.
Narration no longer needs it, but anything else that plays media through the
webview does, and webkit2gtk-4.1 will not pull it in on its own.

## Building it yourself

```bash
pnpm install
pnpm tauri build                       # all bundles for this host
pnpm tauri build --bundles appimage    # just the AppImage
pnpm tauri build --bundles deb         # just the .deb
```

Output lands in `src-tauri/target/release/bundle/{appimage,deb}/`. The `.deb`
bundle needs `dpkg-deb`; the AppImage step downloads `linuxdeploy`/`appimagetool`
on first run (so that build needs network once). System build deps:

- **Arch:** `sudo pacman -S webkit2gtk-4.1 gtk3 librsvg alsa-lib base-devel`
- **Debian/Ubuntu:** `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libasound2-dev patchelf file`

## Windows

Download `Bread of Life_<ver>_x64-setup.exe` from the release and run it.
The beta installer is **unsigned**, so SmartScreen may warn: click
**More info → Run anyway**. (Authenticode signing is on the roadmap.)

## macOS

Download `Bread of Life_<ver>_universal.dmg` (works on both Apple Silicon and
Intel), open it, and drag the app to Applications. The beta is **unsigned/not
notarized**, so Gatekeeper blocks it on first launch — either **right-click the
app → Open** (then confirm), or run:

```bash
xattr -dr com.apple.quarantine "/Applications/Bread of Life.app"
```

Proper Developer-ID signing + notarization is on the roadmap (see `ROADMAP.md`).

## Releasing to the AUR

Arch users install `bread-of-life-bin`, which lives in its own AUR repo
(`ssh://aur@aur.archlinux.org/bread-of-life-bin.git`) holding just a PKGBUILD and
`.SRCINFO`. It compiles nothing — it repackages the `.deb` attached to the GitHub
release — so a bump is only the new `pkgver`, fresh checksums, and a regenerated
`.SRCINFO`.

That used to be a manual step, and the AUR drifted a release behind more than once.
It now happens automatically: the `aur` job in `.github/workflows/desktop.yml` runs
after the release bundles are attached and pushes the bump. It no-ops cleanly if the
`AUR_SSH_PRIVATE_KEY` secret is missing (forks), and if the AUR is already at that
version — so re-running a release is safe.

**One-off setup.** The deploy key lives in a GitHub *environment* named `aur`, not
in plain repo secrets, and that environment allows only `v*` tags — so a branch push
or a pull request cannot read it even by editing the workflow, because the rule is
enforced on GitHub's side. Add `AUR_SSH_PRIVATE_KEY` there (`gh secret set
AUR_SSH_PRIVATE_KEY --env aur`), holding a key dedicated to CI whose public half is
registered on the AUR account — not a personal key.

Because this is the one job in the repo holding a credential that can publish to a
package registry, it is deliberately the narrowest thing in the workflows:

- **No marketplace actions at all**, not even `actions/checkout` — it clones the tag
  with the container's own git. So the job runs no JavaScript action and installs
  nothing from npm; its whole dependency surface is pacman, git and bash.
- `permissions: {}` — it talks to the AUR over SSH and wants nothing from GitHub's token.
- Guarded on `github.repository`, so it can never run on a fork.
- The AUR host key is **pinned**, not trusted on first use — a release that pushes
  itself must not accept whatever key answers on the day. Verify against the
  fingerprints the AUR publishes before ever changing that line:

```
SHA256:RFzBCUItH9LZS0cKB5UE6ceAYhBD5C8GeOBip8Z11+4   (ed25519)
```

Third-party actions in the other jobs are pinned to full commit SHAs rather than
mutable tags, since those jobs hold the Android signing secrets.

**By hand**, if CI is unavailable (needs Arch — `makepkg`, `pacman-contrib`):

```bash
scripts/bump-aur.sh 0.3.10 ~/dev/aur-bread-of-life   # bumps, checksums, builds, commits
git -C ~/dev/aur-bread-of-life show                  # review
git -C ~/dev/aur-bread-of-life push origin master
```

CI runs that same script, so the two paths can't drift.
