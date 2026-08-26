import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Brain, Check, Copy, NotebookPen, HandHeart, Sparkles, StickyNote, TextSelect, X } from "lucide-react";
import { db, type HighlightColor } from "@/db";
import { setHighlight, clearHighlight, saveNote, recordProgress, addMemoryVerse } from "@/db/repos";
import { getChapterFor, translationById, type Chapter } from "@/data/bible";
import { refLabel, refRange, bookByHo } from "@/lib/osis";
import {
  citation,
  clearLiveSelection,
  hasLiveSelection,
  quoteLabel,
  readVerseSelection,
  type VerseSelection,
} from "@/lib/quote";
import { useUI } from "@/store/ui";
import { useChapterNav } from "@/lib/useChapterNav";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
  Tooltip,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { getMisslerAudio } from "@/data/missler";
import { CaptureDialog } from "./CaptureDialog";
import { AudioPlayer } from "./AudioPlayer";

/** Missler chapter audio (label → URL) merged alongside the BSB narrators, or `{}`
 *  when no local library is configured. Keyed off the current chapter. */
function useMisslerAudio(ho: string, chapter: number): Record<string, string> {
  const [entries, setEntries] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    setEntries({}); // drop the previous chapter's entries while the new ones load
    getMisslerAudio(ho, chapter).then((e) => alive && setEntries(e));
    return () => {
      alive = false;
    };
  }, [ho, chapter]);
  return entries;
}

const COLORS: { key: HighlightColor; className: string }[] = [
  { key: "amber", className: "hl-amber" },
  { key: "rose", className: "hl-rose" },
  { key: "sky", className: "hl-sky" },
  { key: "green", className: "hl-green" },
  { key: "violet", className: "hl-violet" },
];
const CLASS_BY_COLOR: Record<HighlightColor, string> = Object.fromEntries(
  COLORS.map((c) => [c.key, c.className]),
) as Record<HighlightColor, string>;

/** A run of verses grabbed together (shift+click, or "Select to…" then a tap). */
interface VerseRange {
  start: number;
  end: number;
}

/**
 * `swipeToChapter` (default true) wires touch swipes to next/previous chapter via
 * the GLOBAL ho/chapter. The guided-plan reader drives chapters itself (by plan
 * cursor), so it passes `false` — otherwise a swipe would move the global chapter
 * off-plan while the guided header/cursor stayed put (a desync).
 *
 * `scopeToPortion` (guided reader only) honours a store `portion` verse range:
 * the day's verses stay bright and are scrolled into view, the rest of the
 * chapter is dimmed for context. The Bible page leaves it off.
 */
export function Reader({
  swipeToChapter = true,
  scopeToPortion = false,
  onListen,
}: {
  swipeToChapter?: boolean;
  scopeToPortion?: boolean;
  /** Override what the chapter audio button queues — see AudioPlayer's `onStart`. */
  onListen?: (label: string) => void;
} = {}) {
  const { ho, chapter, translation, parallel, fontScale, readingLayout, selectVerse, setCompanionSeed, railOpen, setRailOpen, portion } =
    useUI();
  const active =
    scopeToPortion && portion && portion.ho === ho && portion.chapter === chapter ? portion : null;
  const activeKey = active ? `${active.ho}.${active.chapter}.${active.start}.${active.end}` : "";
  const { step } = useChapterNav();
  const navigate = useNavigate();
  const misslerAudio = useMisslerAudio(ho, chapter);
  const [ch, setCh] = useState<Chapter | null>(null);
  const [ch2, setCh2] = useState<Chapter | null>(null);
  const [loading, setLoading] = useState(true);
  const [capture, setCapture] = useState<{ mode: "journal" | "prayer"; verse: number; text: string } | null>(null);
  const [noteVerse, setNoteVerse] = useState<number | null>(null);

  const translationShort = translationById(translation)?.short ?? translation;

  /* ------------------------------ grabbing verses ----------------------------- */

  // A live text selection inside the reader (a phrase, or words spanning verses),
  // and a whole-verse run picked with shift+click / "Select to…". They are mutually
  // exclusive: starting one drops the other, so the tray only ever offers one answer.
  const [selection, setSelection] = useState<VerseSelection | null>(null);
  const [range, setRange] = useState<VerseRange | null>(null);
  // Set while waiting for the second tap of a range — the no-keyboard path.
  const [pickFrom, setPickFrom] = useState<number | null>(null);
  // Where a shift+click measures from: the last verse tapped on its own.
  const anchor = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);

  const clearGrab = useCallback(() => {
    setRange(null);
    setPickFrom(null);
    setSelection(null);
    clearLiveSelection();
  }, []);

  // A different chapter is a different set of verses; nothing carries over.
  useEffect(() => {
    setRange(null);
    setPickFrom(null);
    setSelection(null);
    anchor.current = null;
  }, [ho, chapter]);

  // Watch the native selection. `selectionchange` fires continuously while a drag
  // is in flight, and reading it back walks every verse in the chapter (Psalm 119
  // is 176 of them), so settle first and read once.
  useEffect(() => {
    let timer = 0;
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const found = readVerseSelection(document.getElementById("reader-scroll"));
        setSelection(found);
        if (found) {
          // Dragging across the words is a clear enough statement of intent to
          // drop a verse run that was sitting there.
          setRange(null);
          setPickFrom(null);
        }
      }, 80);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
    };
  }, []);

  // Esc backs out of a range or a half-made one, as it does everywhere else.
  useEffect(() => {
    if (!range && pickFrom === null && !selection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearGrab();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [range, pickFrom, selection, clearGrab]);

  // Touch swipe: left → next chapter, right → previous. Only a quick, clearly
  // horizontal one-finger flick counts, so vertical scroll, pinch/parallel
  // gestures, taps, and (slow) text selection are left untouched. A flick that
  // starts at the right bezel opens the study rail instead of paging.
  const swipe = useRef<{ x: number; y: number; t: number; w: number } | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 1) {
      swipe.current = null;
      return;
    }
    const t = e.touches[0];
    swipe.current = { x: t.clientX, y: t.clientY, t: Date.now(), w: window.innerWidth };
  }
  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length > 1) swipe.current = null; // second finger → not a swipe
  }
  function onTouchEnd(e: React.TouchEvent) {
    const s = swipe.current;
    swipe.current = null;
    if (!swipeToChapter) return; // guided reader owns chapter navigation
    // Hauling a selection handle sideways is not a page turn. Without this, widening
    // a phone selection past 60px threw you into the next chapter.
    if (hasLiveSelection()) return;
    const t = e.changedTouches[0];
    if (!s || !t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    const adx = Math.abs(dx);
    if (Date.now() - s.t > 600 || adx < 60 || adx < Math.abs(dy) * 2) return;
    if (!railOpen && dx < 0 && s.x > s.w - 32) {
      setRailOpen(true); // edge-swipe in from the right opens commentary
      return;
    }
    step(dx < 0 ? 1 : -1);
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getChapterFor(translation, ho, chapter).then((c) => {
      if (!alive) return;
      setCh(c);
      setLoading(false);
      recordProgress(ho, chapter, 1);
      document.getElementById("reader-scroll")?.scrollTo({ top: 0 });
    });
    return () => {
      alive = false;
    };
  }, [translation, ho, chapter]);

  // When scoped to a verse portion, bring the day's verses into view once the
  // chapter has rendered (the load effect above resets scroll to the top first).
  useEffect(() => {
    if (!active || loading) return;
    const t = window.setTimeout(() => {
      document.getElementById(`rv-${active.start}`)?.scrollIntoView({ block: "center" });
    }, 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, loading]);

  useEffect(() => {
    if (!parallel) {
      setCh2(null);
      return;
    }
    let alive = true;
    getChapterFor(parallel, ho, chapter).then((c) => alive && setCh2(c));
    return () => {
      alive = false;
    };
  }, [parallel, ho, chapter]);

  const secMap = useMemo(() => {
    const m = new Map<number, string>();
    if (ch2) for (const it of ch2.items) if (it.t === "v") m.set(it.n, it.text);
    return m;
  }, [ch2]);

  // Verse number → text, for quoting a run of verses in full (a shift+click range
  // takes the whole of every verse it covers, not whatever happens to be on screen).
  const textByVerse = useMemo(() => {
    const m = new Map<number, string>();
    if (ch) for (const it of ch.items) if (it.t === "v") m.set(it.n, it.text);
    return m;
  }, [ch]);

  // Stable merged audio set (BSB narrators + Missler) — a fresh object literal each
  // render would retrigger AudioPlayer's chapter-reset effect and stall playback.
  const audio = useMemo(() => ({ ...ch?.audio, ...misslerAudio }), [ch, misslerAudio]);

  const order = bookByHo(ho)?.order ?? 0;
  const start = order * 1_000_000 + chapter * 1_000;
  const end = start + 999;

  const highlights = useLiveQuery(
    () => db.highlights.where("bbcccvvv").between(start, end, true, true).toArray(),
    [start, end],
    [],
  );
  const notes = useLiveQuery(
    () => db.notes.where("bbcccvvv").between(start, end, true, true).toArray(),
    [start, end],
    [],
  );
  const memory = useLiveQuery(
    () => db.memory.where("bbcccvvv").between(start, end, true, true).toArray(),
    [start, end],
    [],
  );

  const hlByVerse = useMemo(() => {
    const m = new Map<number, HighlightColor>();
    for (const h of highlights ?? []) m.set(h.bbcccvvv - start, h.color);
    return m;
  }, [highlights, start]);
  const noteByVerse = useMemo(() => {
    const m = new Map<number, string>();
    for (const n of notes ?? []) m.set(n.bbcccvvv - start, n.body);
    return m;
  }, [notes, start]);
  const memByVerse = useMemo(() => {
    const s = new Set<number>();
    for (const c of memory ?? []) s.add(c.bbcccvvv - start);
    return s;
  }, [memory, start]);

  /**
   * A tap on a verse, before the toolbar gets it. Returns true when the tap was
   * spent on building a range, in which case the caller suppresses the toolbar —
   * popping it open over the verse you just reached for would hide the run.
   */
  function claimVerseTap(n: number, shift: boolean): boolean {
    if (pickFrom !== null) {
      setRange({ start: Math.min(pickFrom, n), end: Math.max(pickFrom, n) });
      anchor.current = pickFrom;
      setPickFrom(null);
      return true;
    }
    if (shift && anchor.current !== null && anchor.current !== n) {
      clearLiveSelection(); // a stray caret selection would win the tray back
      setRange({ start: Math.min(anchor.current, n), end: Math.max(anchor.current, n) });
      return true;
    }
    // A plain tap is the way out of a range as well as the way into the toolbar.
    if (range) setRange(null);
    anchor.current = n;
    return false;
  }

  /** The verses the tray would copy, or null when there is nothing grabbed. */
  const grabbed = useMemo((): { n: number; text: string }[] | null => {
    if (selection) return selection.verses;
    if (!range) return null;
    const out: { n: number; text: string }[] = [];
    for (let n = range.start; n <= range.end; n++) {
      const text = textByVerse.get(n);
      if (text) out.push({ n, text });
    }
    return out.length ? out : null;
  }, [selection, range, textByVerse]);

  function copyGrabbed() {
    if (!grabbed) return;
    void navigator.clipboard?.writeText(citation(ho, chapter, grabbed, translationShort));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  if (loading) return <div className="p-10 text-muted-foreground">Loading…</div>;
  if (!ch)
    return (
      <div className="p-10 text-muted-foreground">
        {translation === "BSB"
          ? "Chapter not found."
          : `Couldn't load ${translationById(translation)?.name ?? translation} here — you may be offline. It caches after the first online view; BSB always works offline.`}
      </div>
    );

  return (
    <div
      id="reader-scroll"
      className="h-full overflow-y-auto"
      style={{ fontSize: `${fontScale}rem` }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      // Tapping the margin is the third way out of a range, alongside Esc and
      // tapping a verse. Taps on a verse or on the tray itself are theirs to handle.
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest("[data-verse]") || el.closest("[data-quote-tray]")) return;
        if (range || pickFrom !== null) clearGrab();
      }}
    >
      <QuoteTray
        label={
          pickFrom !== null
            ? `Tap the last verse of the range — from ${refLabel(ho, chapter, pickFrom)}`
            : grabbed
              ? quoteLabel(ho, chapter, grabbed)
              : null
        }
        detail={
          pickFrom !== null || !grabbed
            ? null
            : grabbed.length > 1
              ? `${grabbed.length} verses`
              : selection?.partial
                ? `“${grabbed[0].text}”`
                : null
        }
        copied={copied}
        onCopy={pickFrom !== null ? null : copyGrabbed}
        onDismiss={clearGrab}
      />

      <article className={cn("mx-auto px-4 py-6 md:px-8 md:py-8", parallel ? "max-w-4xl" : "max-w-2xl")}>
        <div className="mb-6 flex items-center justify-between gap-3">
          <h2 className="font-serif text-3xl font-bold">{refLabel(ho, chapter)}</h2>
          <AudioPlayer audio={audio} onStart={onListen} />
        </div>
        {active && (
          <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary-700 dark:text-primary-300">
            Today's portion: <span className="font-semibold">{refRange(ho, chapter, active.start, active.end)}</span>
            <span className="text-muted-foreground"> · the rest of the chapter is dimmed for context</span>
          </div>
        )}
        {parallel && (
          <div className="mb-3 grid grid-cols-2 gap-6 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <div>{translationById(translation)?.short ?? translation}</div>
            <div>{translationById(parallel)?.short ?? parallel}</div>
          </div>
        )}
        {ch.items.map((item, i) => {
          if (item.t === "h") {
            return (
              <h3 key={i} className="mb-2 mt-6 font-serif text-lg font-bold text-primary-700 dark:text-primary-300">
                {item.text}
              </h3>
            );
          }
          const dim = !!active && (item.n < active.start || item.n > active.end);
          const verse = (
            <Verse
              ho={ho}
              chapter={chapter}
              n={item.n}
              text={item.text}
              translationShort={translationShort}
              anchorId={`rv-${item.n}`}
              dim={dim}
              color={hlByVerse.get(item.n)}
              hasNote={noteByVerse.has(item.n)}
              memorised={memByVerse.has(item.n)}
              inRange={!!range && item.n >= range.start && item.n <= range.end}
              isRangeAnchor={pickFrom === item.n}
              onTap={(shift) => claimVerseTap(item.n, shift)}
              onSelect={() => selectVerse(item.n)}
              onPickRange={() => {
                setSelection(null);
                clearLiveSelection();
                setRange(null);
                setPickFrom(item.n);
              }}
              onNote={() => setNoteVerse(item.n)}
              onMemorise={() =>
                addMemoryVerse({ ho, chapter, verse: item.n, text: item.text, translation })
              }
              onCapture={(mode) => setCapture({ mode, verse: item.n, text: item.text })}
              onAsk={() => {
                setCompanionSeed(`Help me understand ${refLabel(ho, chapter, item.n)}: “${item.text}”`);
                navigate("/companion");
              }}
            />
          );
          if (parallel) {
            return (
              <div key={i} className="mb-3 grid grid-cols-2 gap-6">
                <div>{verse}</div>
                <div className="font-serif leading-relaxed text-foreground/90">
                  <sup className="mr-0.5 align-super text-[0.62em] font-sans font-semibold text-primary-600">
                    {item.n}
                  </sup>
                  {secMap.get(item.n) ?? "…"}
                </div>
              </div>
            );
          }
          return readingLayout === "lines" ? (
            <p key={i} className="mb-2 leading-relaxed">
              {verse}
            </p>
          ) : (
            <Fragment key={i}>{verse} </Fragment>
          );
        })}
        <p className="mt-10 text-center text-xs text-muted-foreground">
          {translationById(translation)?.name ?? translation} · Public Domain
        </p>
      </article>

      {capture && (
        <CaptureDialog
          mode={capture.mode}
          ho={ho}
          chapter={chapter}
          verse={capture.verse}
          verseText={capture.text}
          label={refLabel(ho, chapter, capture.verse)}
          onClose={() => setCapture(null)}
        />
      )}

      {noteVerse !== null && (
        <NoteDialog
          ho={ho}
          chapter={chapter}
          verse={noteVerse}
          existing={noteByVerse.get(noteVerse) ?? ""}
          onClose={() => setNoteVerse(null)}
        />
      )}
    </div>
  );
}

/**
 * The floating pill that says what you have hold of and offers to copy it.
 *
 * It rides at the top of the reading column rather than the bottom: the bottom is
 * where the guided reader's "Mark read & next" button lives, and on a phone it is
 * also where the OS puts its own selection handles. Zero-height and sticky, so it
 * appears over the text without shoving the chapter down the page.
 */
function QuoteTray({
  label,
  detail,
  copied,
  onCopy,
  onDismiss,
}: {
  label: string | null;
  detail: string | null;
  copied: boolean;
  onCopy: (() => void) | null;
  onDismiss: () => void;
}) {
  if (!label) return null;
  return (
    <div data-quote-tray className="pointer-events-none sticky top-0 z-30 h-0">
      <div className="flex justify-center px-3 pt-3">
        <div className="pointer-events-auto flex max-w-[min(36rem,calc(100vw-2rem))] items-center gap-2 rounded-full border border-primary/30 bg-card/95 py-1.5 pl-4 pr-1.5 text-sm shadow-card backdrop-blur">
          <div className="min-w-0">
            <div className="truncate font-medium">{label}</div>
            {detail && <div className="truncate text-xs text-muted-foreground">{detail}</div>}
          </div>
          {onCopy && (
            <Button size="sm" variant={copied ? "success" : "primary"} className="shrink-0 rounded-full" onClick={onCopy}>
              {copied ? (
                <>
                  <Check style={{ width: 14, height: 14 }} /> Copied
                </>
              ) : (
                <>
                  <Copy style={{ width: 14, height: 14 }} /> Copy
                </>
              )}
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 rounded-full"
            onClick={onDismiss}
            aria-label={onCopy ? "Clear selection" : "Cancel"}
          >
            <X style={{ width: 15, height: 15 }} />
          </Button>
        </div>
      </div>
    </div>
  );
}

interface VerseProps {
  ho: string;
  chapter: number;
  n: number;
  text: string;
  translationShort: string;
  anchorId?: string;
  dim?: boolean;
  color?: HighlightColor;
  hasNote: boolean;
  memorised: boolean;
  inRange: boolean;
  isRangeAnchor: boolean;
  /** Give the parent first refusal on the tap; true means it used it for a range. */
  onTap: (shift: boolean) => boolean;
  onSelect: () => void;
  onPickRange: () => void;
  onNote: () => void;
  onMemorise: () => void;
  onCapture: (mode: "journal" | "prayer") => void;
  onAsk: () => void;
}

function Verse({
  ho,
  chapter,
  n,
  text,
  translationShort,
  anchorId,
  dim,
  color,
  hasNote,
  memorised,
  inRange,
  isRangeAnchor,
  onTap,
  onSelect,
  onPickRange,
  onNote,
  onMemorise,
  onCapture,
  onAsk,
}: VerseProps) {
  const [open, setOpen] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  // The words that were selected inside THIS verse when the toolbar opened. Read at
  // open time rather than at copy time so it survives the popover taking focus.
  const [fragment, setFragment] = useState<{ n: number; text: string }[] | null>(null);
  const down = useRef<{ x: number; y: number } | null>(null);

  const toggleColor = (c: HighlightColor) => {
    if (color === c) clearHighlight(ho, chapter, n);
    else setHighlight(ho, chapter, n, c);
  };

  function captureFragment() {
    const live = readVerseSelection(document.getElementById("reader-scroll"));
    const mine = !!live && live.partial && live.verses.length === 1 && live.verses[0].n === n;
    setFragment(mine && live ? live.verses : null);
  }

  const copy = () =>
    navigator.clipboard?.writeText(citation(ho, chapter, fragment ?? [{ n, text }], translationShort));

  // The verse itself is the trigger: click or right-click pops a floating
  // toolbar anchored to the verse. Nothing is reserved in the text flow, so
  // the reading column stays clean.
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          captureFragment();
          onSelect();
        }
      }}
    >
      <PopoverTrigger asChild>
        <span
          id={anchorId}
          data-verse={n}
          onPointerDown={(e) => {
            down.current = { x: e.clientX, y: e.clientY };
            // Shift+click is the browser's own "extend the selection to here", and
            // that ran first: the caret dragged out across the verses and the
            // resulting text selection replaced the verse run we were building.
            // Take the gesture for the range instead.
            if (e.shiftKey) e.preventDefault();
          }}
          onClick={(e) => {
            // A click that travelled is the tail of a drag-select. Let the words
            // stay selected and let the tray offer the copy — covering them with
            // the toolbar is exactly what made selecting inside a verse futile.
            const from = down.current;
            const dragged = from ? Math.hypot(e.clientX - from.x, e.clientY - from.y) > 6 : false;
            if (dragged || hasLiveSelection()) {
              e.preventDefault(); // Radix skips its own handler once default is prevented
              return;
            }
            if (onTap(e.shiftKey)) e.preventDefault(); // spent on a range
          }}
          onContextMenu={(e) => {
            // Right-click keeps working over a selection, which is how you reach
            // the toolbar's other actions without losing the phrase you highlighted.
            e.preventDefault();
            captureFragment();
            setOpen(true);
          }}
          className={cn(
            "cursor-pointer rounded-sm font-serif leading-[2] transition-colors hover:bg-accent/60",
            color && CLASS_BY_COLOR[color],
            color && "px-0.5",
            dim && "opacity-40",
            inRange && "ring-2 ring-primary/45",
            inRange && !color && "bg-primary/10",
            isRangeAnchor && "ring-2 ring-primary/70",
            open && "bg-accent ring-1 ring-primary/40",
          )}
        >
          <sup className="mr-0.5 select-none align-super text-[0.62em] font-sans font-semibold text-primary-600">
            {n}
          </sup>
          {/* The words, and only the words — see src/lib/quote.ts. `select-text`
              defends the selection against any inherited user-select: none. */}
          <span data-verse-text className="select-text">
            {text}
          </span>
          {hasNote && (
            <StickyNote
              className="ml-1 inline-block select-none align-super text-primary-500"
              style={{ width: 12, height: 12 }}
            />
          )}
          {(memorised || justAdded) && (
            <Brain
              className="ml-1 inline-block select-none align-super text-primary-500"
              style={{ width: 12, height: 12 }}
            />
          )}
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={4} className="w-auto p-2">
        <div className="mb-1.5 px-0.5 text-xs font-semibold text-muted-foreground">
          {refLabel(ho, chapter, n)}
          {fragment && <span className="ml-1 font-normal text-primary-600">· selected words</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c.key}
              aria-label={`Highlight ${c.key}`}
              onClick={() => toggleColor(c.key)}
              className={cn(
                "h-6 w-6 rounded-full border border-border transition-transform hover:scale-110",
                c.className,
                color === c.key && "ring-2 ring-primary ring-offset-1",
              )}
            />
          ))}
          {color && (
            <button
              onClick={() => clearHighlight(ho, chapter, n)}
              className="ml-0.5 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              Clear
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-0.5 border-t border-border pt-2">
          <IconBtn
            label="Note"
            onClick={() => {
              setOpen(false);
              onNote();
            }}
            active={hasNote}
          >
            <NotebookPen style={{ width: 15, height: 15 }} />
          </IconBtn>
          <IconBtn
            label={memorised || justAdded ? "In Memory Lane" : "Memorise"}
            onClick={() => {
              onMemorise();
              setJustAdded(true);
              setTimeout(() => setOpen(false), 550);
            }}
            active={memorised || justAdded}
          >
            <Brain style={{ width: 15, height: 15 }} />
          </IconBtn>
          <IconBtn
            label={fragment ? "Copy selected words" : "Copy"}
            onClick={() => {
              copy();
              setOpen(false);
            }}
          >
            <Copy style={{ width: 15, height: 15 }} />
          </IconBtn>
          <IconBtn
            label="Select to…"
            onClick={() => {
              setOpen(false);
              onPickRange();
            }}
          >
            <TextSelect style={{ width: 15, height: 15 }} />
          </IconBtn>
          <IconBtn
            label="Journal"
            onClick={() => {
              setOpen(false);
              onCapture("journal");
            }}
          >
            <span className="text-[12px] font-semibold">J</span>
          </IconBtn>
          <IconBtn
            label="Pray"
            onClick={() => {
              setOpen(false);
              onCapture("prayer");
            }}
          >
            <HandHeart style={{ width: 15, height: 15 }} />
          </IconBtn>
          <IconBtn
            label="Ask companion"
            onClick={() => {
              setOpen(false);
              onAsk();
            }}
          >
            <Sparkles style={{ width: 15, height: 15 }} />
          </IconBtn>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function IconBtn({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip label={label}>
      <button
        onClick={onClick}
        aria-label={label}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
          active && "text-primary-600",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function NoteDialog({
  ho,
  chapter,
  verse,
  existing,
  onClose,
}: {
  ho: string;
  chapter: number;
  verse: number;
  existing: string;
  onClose: () => void;
}) {
  const [body, setBody] = useState(existing);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogTitle>Note on {refLabel(ho, chapter, verse)}</DialogTitle>
        <Textarea autoFocus rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Your note…" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              await saveNote(ho, chapter, verse, body);
              onClose();
            }}
          >
            Save note
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
