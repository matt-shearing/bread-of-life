#!/usr/bin/env bash
#
# Bump the AUR package (bread-of-life-bin) to a released version.
#
# The AUR package lives in its OWN git repo — ssh://aur@aur.archlinux.org/bread-of-life-bin.git
# — holding just a PKGBUILD and .SRCINFO. It doesn't compile anything: it repackages the
# .deb attached to the GitHub release. So a bump is only ever three things: the new
# pkgver, fresh checksums for the release assets, and a regenerated .SRCINFO.
#
# This is the single source of truth for that, used both by hand and by CI
# (see the `aur` job in .github/workflows/desktop.yml).
#
#   scripts/bump-aur.sh 0.3.10 ~/dev/aur-bread-of-life
#
# It commits but never pushes — review with `git -C <dir> show` first, then push.
# Needs an Arch environment (makepkg, updpkgsums from pacman-contrib).
#
# Exits 0 without doing anything if the package is already at that version, so
# re-running it (or a re-run of the CI job) is safe.
set -euo pipefail

VERSION=${1:-}
REPO=${2:-}
if [ -z "$VERSION" ] || [ -z "$REPO" ]; then
  echo "usage: bump-aur.sh <version> <aur-repo-dir>" >&2
  exit 2
fi
VERSION=${VERSION#v} # accept either 0.3.10 or v0.3.10

if [ ! -f "$REPO/PKGBUILD" ]; then
  echo "no PKGBUILD in $REPO — is that the AUR checkout?" >&2
  exit 1
fi
cd "$REPO"

current=$(sed -n 's/^pkgver=//p' PKGBUILD)
if [ "$current" = "$VERSION" ]; then
  echo "AUR package already at $VERSION — nothing to do."
  exit 0
fi
echo "Bumping bread-of-life-bin: $current -> $VERSION"

# The release assets are attached by the build job; a tag push can reach us before
# they've finished uploading, so give them a chance rather than failing the release.
DEB_URL="https://github.com/matt-shearing/bread-of-life/releases/download/v${VERSION}/Bread.of.Life_${VERSION}_amd64.deb"
echo "Waiting for $DEB_URL"
for attempt in $(seq 1 30); do
  if curl -fsSL --range 0-0 -o /dev/null "$DEB_URL"; then
    echo "  release asset is up (attempt $attempt)"
    break
  fi
  if [ "$attempt" = 30 ]; then
    echo "release .deb never appeared — refusing to publish a broken PKGBUILD" >&2
    exit 1
  fi
  sleep 10
done

# pkgrel restarts at 1 for a new upstream version.
sed -i -E "s/^pkgver=.*/pkgver=${VERSION}/; s/^pkgrel=.*/pkgrel=1/" PKGBUILD

# Downloads both sources and rewrites sha256sums in place.
updpkgsums

makepkg --printsrcinfo > .SRCINFO

# Actually assemble the package before publishing it. Cheap, and it catches an
# upstream .deb whose layout changed (the package() step reaches into data.tar.gz
# and renames the .desktop file) before anyone on Arch hits it.
#
# --nodeps on purpose: nothing is compiled or linked here, so webkit2gtk/gtk3 being
# absent says nothing about whether the package assembles. Without it this only
# passes on a machine that already runs the app — CI (a bare arch container) can't.
if [ "${SKIP_BUILD:-}" != "1" ]; then
  echo "Verifying the package builds…"
  makepkg -f --nodeps --noconfirm
  pkg=$(ls -t ./*.pkg.tar.* 2>/dev/null | head -1)
  for want in usr/bin/bread-of-life usr/share/applications/bread-of-life.desktop; do
    bsdtar -tf "$pkg" | grep -qx "$want" || {
      echo "built package is missing $want" >&2
      exit 1
    }
  done
  echo "  ok: $(basename "$pkg")"
fi

git add PKGBUILD .SRCINFO
git commit -m "Update to ${VERSION}"
echo
echo "Committed. Review with:  git -C $REPO show"
echo "Then push with:          git -C $REPO push origin master"
