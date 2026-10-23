# The XENEON Edge deck card

Bread of Life publishes a small snapshot that the deck (xeneon-deck) reads, so a card can show
the verse of the day, whether today's reading is done, and the memory verses due.

## Files

Both live in `${XDG_STATE_HOME:-~/.local/state}/bread-of-life/`, are written to a temporary file
and renamed into place, and have mode 0600 in a 0700 folder.

- `deck-source.json` is written by the desktop app (`src/lib/deckBridge.ts`) whenever the plan,
  memory verses, devotions or reading log change, and at least every five minutes while it runs.
  It carries the next 31 days' verses and the next 8 days' devotions, so it stays useful while
  the app is closed.
- `deck.json` is what the deck reads. The app renders it from the source once a minute while it
  runs; `bol-deck` renders it on a timer when the app is closed. Both renderers
  (`src/lib/deckSnapshot.ts`, `scripts/bol-deck.py`) are tested to agree
  (`scripts/test-deck-snapshot.mjs`).

## deck.json

```jsonc
{
  "schema_version": 2,
  "updated_at_ms": 1792735200000,     // when this view was rendered
  "data_as_of_ms": 1792735140000,     // when the app last wrote the source
  "verse": { "ref": "John 15:5", "text": "…", "translation": "BSB", "source": "verse of the day" },
  "reading": {
    "plan": "Soul Food Classic — Whole Bible in a Year",   // null without an active plan
    "today": "Genesis 12–14 · Matthew 5:1-12",              // null without a plan, or when it is finished
    "done": false,
    "streak_days": 3,
    "day": 42, "total_days": 365                             // 1-based; null without a plan
  },
  "memory": { "due": 2, "next_ref": "Romans 8:28", "next_due_at_ms": null },
  "devotion": { "name": "Morning & Evening", "label": "Morning", "ref": "Psalm 119:49", "done": true }
}
```

`verse` and `devotion` are null when there is nothing for today, including when the app has been
closed for longer than the source looks ahead. The verse is always the app's own verse of the
day in the Berean Standard Bible, which is public domain; licensed translations never leave the
app. Nothing from the journal, prayers or notes, and no keys, are in either file.

## What the deck cannot know while the app is closed

The snapshot comes from this computer's copy of the data. A reading or devotion finished on the
phone shows as done once the desktop app next runs and syncs.

## Install the timer

```sh
deploy/deck/install.sh
```

It copies `scripts/bol-deck.py` to `~/.local/bin/bol-deck` and enables the systemd user timer
`bol-deck.timer` (every five minutes, plus 00:00:05 and 17:00:05). `bol-deck --print` shows the
current view without writing it.
