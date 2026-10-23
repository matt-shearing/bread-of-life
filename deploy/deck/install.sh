#!/usr/bin/env bash
# Install the deck card's timer for this user: the renderer to ~/.local/bin/bol-deck and a
# systemd user timer that runs it every five minutes, at midnight and at 17:00.
# No root needed. Undo with: systemctl --user disable --now bol-deck.timer
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
install -Dm755 "$here/../../scripts/bol-deck.py" "$HOME/.local/bin/bol-deck"
install -Dm644 "$here/bol-deck.service" "$HOME/.config/systemd/user/bol-deck.service"
install -Dm644 "$here/bol-deck.timer" "$HOME/.config/systemd/user/bol-deck.timer"
install -Dm644 "$here/README.md" "$HOME/.local/share/bread-of-life-deck/README.md"
systemctl --user daemon-reload
systemctl --user enable --now bol-deck.timer
systemctl --user start bol-deck.service
systemctl --user list-timers bol-deck.timer --no-pager
