#!/usr/bin/env bash
#
# Refuse to release a commit that changes anything but the version.
#
# Why this exists: v0.3.10's release commit (126969f) announced "the active reading
# plan follows your account" and, in the same commit, staged the deletion of the
# feature it was announcing — syncedPrefs.ts, the startPrefSync() call, and the
# onSyncRound hook. Nothing caught it. The tag, the GitHub release, the .deb and
# the AUR package all shipped without it, and the bug the release claimed to fix
# stayed broken on every desktop.
#
# A release commit is a version bump and nothing else. Every healthy one in this
# repo's history has touched exactly the same handful of files; the broken one is
# the only release commit that has ever touched src/. So this fails closed on
# anything outside that set rather than trying to be clever about intent.
#
#   scripts/check-release-commit.sh            # check HEAD
#   scripts/check-release-commit.sh v0.3.11    # check a tag before pushing it
#
# Run it by hand before tagging, or let the `release-guard` job in
# .github/workflows/desktop.yml run it for you on every v* tag.
set -euo pipefail

REF=${1:-HEAD}

# Paths a version bump is allowed to touch. Anything else is a mistake.
ALLOWED=$(
  cat <<'EOF'
package.json
pnpm-lock.yaml
src-tauri/Cargo.toml
src-tauri/Cargo.lock
src-tauri/tauri.conf.json
README.md
CHANGELOG.md
EOF
)
# ...plus these prefixes: release notes and store metadata travel with a release.
ALLOWED_PREFIXES="docs/ fastlane/"

commit=$(git rev-parse "$REF^{commit}")
subject=$(git log -1 --format=%s "$commit")

if ! git rev-parse --verify --quiet "$commit^1" >/dev/null; then
  echo "check-release-commit: $REF is a root commit — nothing to compare against."
  exit 0
fi

# --first-parent semantics: if a release is ever a merge, compare against the
# branch it landed on, not the side branch.
changed=$(git diff --name-only "$commit^1" "$commit")

offenders=""
while IFS= read -r path; do
  [ -n "$path" ] || continue
  if grep -qxF "$path" <<<"$ALLOWED"; then continue; fi
  ok=""
  for prefix in $ALLOWED_PREFIXES; do
    case "$path" in "$prefix"*) ok=1 ;; esac
  done
  [ -n "$ok" ] && continue
  offenders+="  $path"$'\n'
done <<<"$changed"

if [ -z "$offenders" ]; then
  echo "check-release-commit: OK — $(git rev-parse --short "$commit") ($subject)"
  echo "$changed" | sed 's/^/  /'
  exit 0
fi

# Deletions are the failure mode that actually shipped, so name them explicitly:
# a reviewer skimming `--stat` reads "-139" as a diff stat, not as a lost feature.
deleted=$(git diff --diff-filter=D --name-only "$commit^1" "$commit" || true)

cat >&2 <<EOF

check-release-commit: REFUSING to release $(git rev-parse --short "$commit")

  $subject

A release commit must only bump the version. This one also changes:

$offenders
EOF

if [ -n "$deleted" ]; then
  cat >&2 <<EOF
and it DELETES these files outright:

$(echo "$deleted" | sed 's/^/  /')

That is exactly how v0.3.10 shipped without the reading-plan sync it announced.
EOF
fi

cat >&2 <<EOF
Move those changes into their own commit before the release commit, then re-tag.
If a change genuinely belongs to the release itself, add its path to ALLOWED in
this script — deliberately, not to make a red build go green.

EOF
exit 1
