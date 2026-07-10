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

- **Arch:** `sudo pacman -S webkit2gtk-4.1 gtk3 librsvg base-devel`
- **Debian/Ubuntu:** `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf file`

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
