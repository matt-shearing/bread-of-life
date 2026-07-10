#!/usr/bin/env bash
#
# appimage-unbundle-webkit.sh — make the Linux AppImage rely on the SYSTEM
# WebKitGTK instead of the copy Tauri/linuxdeploy bundles into it.
#
# Why: `tauri build --bundles appimage` runs linuxdeploy-plugin-gtk, which
# copies the BUILD machine's WebKitGTK into the AppImage:
#   usr/lib/<triplet>/libwebkit2gtk-4.1.so*
#   usr/lib/<triplet>/libjavascriptcoregtk-4.1.so*
#   usr/lib/<triplet>/webkit2gtk-4.1/            (WebKitNetworkProcess,
#                                                 WebKitWebProcess,
#                                                 injected-bundle/…)
# We build on ubuntu-22.04, so that copy is an OLD (2.36-era) WebKit. On
# rolling distros (Arch, EndeavourOS, …) it clashes with the newer system
# WebKit the app is actually linked against at runtime → a BLANK WINDOW
# (see tauri-apps/tauri#5292, #10626, #12463). The `.deb`/AUR builds work
# precisely because they use the system WebKit.
#
# Fix: delete those bundled WebKit + JavaScriptCore files from the AppDir and
# repack. With them gone, the dynamic loader falls back to the host's
# libwebkit2gtk-4.1 (LD_LIBRARY_PATH still lists usr/lib first, but the libs
# simply aren't there), and the SYSTEM libwebkit2gtk spawns its OWN matching
# WebKitWebProcess / injected-bundle from the system paths — no version skew.
# The AppImage now REQUIRES webkit2gtk-4.1 to be installed on the host, which
# is the same contract the `.deb`/AUR already have and every supported distro
# satisfies.
#
# Only the AppImage is touched. The `.deb` produced by the same build is left
# exactly as-is.
#
# Usage:
#   scripts/appimage-unbundle-webkit.sh [path/to/app.AppImage]
# With no argument it finds the AppImage under src-tauri/target.
#
# Env: needs `appimagetool` on PATH, or it downloads one to a temp dir.
# Honors APPIMAGE_EXTRACT_AND_RUN=1 (set in CI; required on FUSE-less runners).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── locate the AppImage ──────────────────────────────────────────────────────
APPIMAGE="${1:-}"
if [ -z "$APPIMAGE" ]; then
  APPIMAGE="$(find "$ROOT/src-tauri/target" -type f -name '*.AppImage' 2>/dev/null | head -n1 || true)"
fi
if [ -z "$APPIMAGE" ] || [ ! -f "$APPIMAGE" ]; then
  echo "appimage-unbundle-webkit: no .AppImage found (arg: '${1:-}')" >&2
  exit 1
fi
APPIMAGE="$(readlink -f "$APPIMAGE")"
echo "appimage-unbundle-webkit: target = $APPIMAGE"

ARCH="${ARCH:-$(uname -m)}"
export ARCH

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# ── extract ──────────────────────────────────────────────────────────────────
# The AppImage runtime unpacks itself into ./squashfs-root with --appimage-extract.
cp "$APPIMAGE" "$WORK/app.AppImage"
chmod +x "$WORK/app.AppImage"
( cd "$WORK" && "$WORK/app.AppImage" --appimage-extract >/dev/null )
APPDIR="$WORK/squashfs-root"
[ -d "$APPDIR" ] || { echo "appimage-unbundle-webkit: extract produced no squashfs-root" >&2; exit 1; }

# ── strip bundled WebKit / JavaScriptCore ────────────────────────────────────
echo "appimage-unbundle-webkit: removing bundled WebKit/JSC:"
removed=0
while IFS= read -r -d '' p; do
  echo "  - ${p#"$APPDIR"/}"
  rm -rf "$p"
  removed=$((removed + 1))
done < <(
  find "$APPDIR" \( \
       -name 'libwebkit2gtk-4.1.so*' \
    -o -name 'libjavascriptcoregtk-4.1.so*' \
    -o -type d -name 'webkit2gtk-4.1' \
    \) -print0 2>/dev/null
)

if [ "$removed" -eq 0 ]; then
  # Bundling layout changed (or a future Tauri stopped bundling WebKit). Don't
  # silently ship an unmodified AppImage under a "fixed" name — fail loudly so
  # the workflow surfaces it.
  echo "appimage-unbundle-webkit: found NO bundled WebKit to remove — did the" >&2
  echo "  Tauri/linuxdeploy layout change? Refusing to repack. Inspect the AppDir." >&2
  exit 2
fi

# ── appimagetool ─────────────────────────────────────────────────────────────
AIT="$(command -v appimagetool || true)"
if [ -z "$AIT" ]; then
  echo "appimage-unbundle-webkit: downloading appimagetool"
  AIT="$WORK/appimagetool"
  # continuous release tracks upstream; -x86_64 asset works for our runners.
  curl -fsSL -o "$AIT" \
    "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH}.AppImage"
  chmod +x "$AIT"
fi

# ── repack (overwrite the original in place) ─────────────────────────────────
OUT="$WORK/out.AppImage"
echo "appimage-unbundle-webkit: repacking with appimagetool"
"$AIT" "$APPDIR" "$OUT"
mv -f "$OUT" "$APPIMAGE"
chmod +x "$APPIMAGE"

echo "appimage-unbundle-webkit: done — removed $removed bundled WebKit/JSC path(s)."
echo "appimage-unbundle-webkit: AppImage now uses the host's system webkit2gtk-4.1."
