#!/usr/bin/env python3
"""Keep the XENEON Edge deck card's snapshot of Bread of Life current while the app is closed.

The desktop app writes two files in ${XDG_STATE_HOME:-~/.local/state}/bread-of-life/:
deck-source.json (scripture, plan labels and progress, memory due times, devotions, the
next weeks' verses) and deck.json (the card's view of that source right now). This
script renders deck.json from deck-source.json again, so the card follows the clock
without the app: the date rolls over at midnight, the devotion turns to Evening at 17:00
and memory verses come due. It never reads the app's database, and it never contacts a
server.

KEEP IN STEP with renderDeck() in src/lib/deckSnapshot.ts.
scripts/test-deck-snapshot.mjs runs both over the same sources and fails if they differ.

Usage:
  bol-deck.py              render deck.json now (what the systemd timer runs)
  bol-deck.py --print      print the rendered view instead of writing it
  bol-deck.py --now MS     render for that moment (epoch ms), for tests
  bol-deck.py --source PATH --out PATH   use other files (tests)

Python standard library only.
"""

import argparse
import datetime as dt
import json
import os
import sys
import tempfile

DECK_SCHEMA_VERSION = 2
DECK_SOURCE_VERSION = 1


def state_dir():
    base = os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
    return os.path.join(base, "bread-of-life")


def local_date(ms):
    return dt.datetime.fromtimestamp(ms / 1000).date()


def local_day_key(ms):
    return local_date(ms).isoformat()


def reading_streak(days, now):
    """As readingStreak (src/lib/streak.ts): alive until today is over."""
    d = local_date(now)
    if d.isoformat() not in days:
        d -= dt.timedelta(days=1)
    n = 0
    while d.isoformat() in days:
        n += 1
        d -= dt.timedelta(days=1)
    return n


def render(src, now):
    today = local_day_key(now)

    verse = None
    for v in src.get("verses") or []:
        if v.get("date") == today:
            verse = {"ref": v["ref"], "text": v["text"], "translation": v["translation"], "source": "verse of the day"}
            break

    streak = reading_streak(set(src.get("reading_days") or []), now)
    reading = {"plan": None, "today": None, "done": False, "streak_days": streak, "day": None, "total_days": None}
    p = src.get("plan")
    if p:
        done_today = [r for r in p.get("recent") or [] if local_day_key(r["completed_at_ms"]) == today]
        done_today.sort(key=lambda r: r["day"], reverse=True)
        base = {"plan": p["name"], "streak_days": streak, "total_days": p["total_days"]}
        if done_today:
            r = done_today[0]
            reading = {**base, "today": r["label"], "done": True, "day": r["day"] + 1}
        elif p.get("next"):
            reading = {**base, "today": p["next"]["label"], "done": False, "day": p["next"]["day"] + 1}
        else:
            reading = {**base, "today": None, "done": True, "day": None}

    due = 0
    next_ref = None
    next_due_at = None
    for m in src.get("memory") or []:
        if m["due_at_ms"] <= now:
            due += 1
            if next_ref is None:
                next_ref = m["ref"]
        elif next_due_at is None or m["due_at_ms"] < next_due_at:
            next_due_at = m["due_at_ms"]

    devotion = None
    dev = src.get("devotion")
    if dev:
        day = next((x for x in dev.get("days") or [] if x.get("date") == today), None)
        if day and day.get("readings"):
            readings = day["readings"]
            index = 1 if len(readings) > 1 and dt.datetime.fromtimestamp(now / 1000).hour >= 17 else 0
            r = readings[index]
            devotion = {"name": dev["name"], "label": r["label"], "ref": r["ref"], "done": bool(r["done"])}

    return {
        "schema_version": DECK_SCHEMA_VERSION,
        "updated_at_ms": now,
        "data_as_of_ms": src["written_at_ms"],
        "verse": verse,
        "reading": reading,
        "memory": {"due": due, "next_ref": next_ref, "next_due_at_ms": next_due_at},
        "devotion": devotion,
    }


def atomic_write(path, text):
    directory = os.path.dirname(path)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".deck-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def main(argv=None):
    ap = argparse.ArgumentParser(description="Render Bread of Life's deck.json from deck-source.json.")
    ap.add_argument("--source", default=os.path.join(state_dir(), "deck-source.json"))
    ap.add_argument("--out", default=os.path.join(state_dir(), "deck.json"))
    ap.add_argument("--now", type=int, default=None, help="epoch ms (default: the clock)")
    ap.add_argument("--print", action="store_true", help="print instead of writing")
    args = ap.parse_args(argv)

    try:
        with open(args.source, encoding="utf-8") as f:
            before = os.fstat(f.fileno()).st_mtime_ns
            src = json.load(f)
    except FileNotFoundError:
        # The app has not run since the deck card was set up: nothing to show yet.
        print(f"bol-deck: no {args.source} yet; open Bread of Life once", file=sys.stderr)
        return 0
    if src.get("source_version") != DECK_SOURCE_VERSION:
        print(f"bol-deck: {args.source} is source_version {src.get('source_version')!r}, expected {DECK_SOURCE_VERSION}; leaving deck.json alone", file=sys.stderr)
        return 1

    now = args.now if args.now is not None else int(dt.datetime.now().timestamp() * 1000)
    text = json.dumps(render(src, now), ensure_ascii=False, separators=(",", ":"))
    if args.print:
        print(text)
        return 0
    # The app writes the source, then deck.json. If it rewrote the source while this ran,
    # its own deck.json is newer than this render: leave it.
    try:
        if os.stat(args.source).st_mtime_ns != before:
            return 0
    except FileNotFoundError:
        return 0
    atomic_write(args.out, text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
