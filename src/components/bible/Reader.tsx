import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Brain, Copy, NotebookPen, HandHeart, Sparkles, StickyNote } from "lucide-react";
import { db, type HighlightColor } from "@/db";
import { setHighlight, clearHighlight, saveNote, recordProgress, addMemoryVerse } from "@/db/repos";
import { getChapterFor, translationById, type Chapter } from "@/data/bible";
import { refLabel, bookByHo } from "@/lib/osis";
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
import { CaptureDialog } from "./CaptureDialog";
import { AudioPlayer } from "./AudioPlayer";

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

/**
 * `swipeToChapter` (default true) wires touch swipes to next/previous chapter via
 * the GLOBAL ho/chapter. The guided-plan reader drives chapters itself (by plan
 * cursor), so it passes `false` — otherwise a swipe would move the global chapter
 * off-plan while the guided header/cursor stayed put (a desync).
 */
export function Reader({ swipeToChapter = true }: { swipeToChapter?: boolean } = {}) {
  const { ho, chapter, translation, parallel, fontScale, readingLayout, selectVerse, setCompanionSeed, railOpen, setRailOpen } =
    useUI();
  const { step } = useChapterNav();
  const navigate = useNavigate();
  const [ch, setCh] = useState<Chapter | null>(null);
  const [ch2, setCh2] = useState<Chapter | null>(null);
  const [loading, setLoading] = useState(true);
  const [capture, setCapture] = useState<{ mode: "journal" | "prayer"; verse: number; text: string } | null>(null);
  const [noteVerse, setNoteVerse] = useState<number | null>(null);

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
    >
      <article className={cn("mx-auto px-4 py-6 md:px-8 md:py-8", parallel ? "max-w-4xl" : "max-w-2xl")}>
        <div className="mb-6 flex items-center justify-between gap-3">
          <h2 className="font-serif text-3xl font-bold">{refLabel(ho, chapter)}</h2>
          <AudioPlayer audio={ch.audio} />
        </div>
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
          const verse = (
            <Verse
              ho={ho}
              chapter={chapter}
              n={item.n}
              text={item.text}
              color={hlByVerse.get(item.n)}
              hasNote={noteByVerse.has(item.n)}
              memorised={memByVerse.has(item.n)}
              onSelect={() => selectVerse(item.n)}
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

interface VerseProps {
  ho: string;
  chapter: number;
  n: number;
  text: string;
  color?: HighlightColor;
  hasNote: boolean;
  memorised: boolean;
  onSelect: () => void;
  onNote: () => void;
  onMemorise: () => void;
  onCapture: (mode: "journal" | "prayer") => void;
  onAsk: () => void;
}

function Verse({ ho, chapter, n, text, color, hasNote, memorised, onSelect, onNote, onMemorise, onCapture, onAsk }: VerseProps) {
  const [open, setOpen] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const toggleColor = (c: HighlightColor) => {
    if (color === c) clearHighlight(ho, chapter, n);
    else setHighlight(ho, chapter, n, c);
  };
  const copy = () => navigator.clipboard?.writeText(`${text} — ${refLabel(ho, chapter, n)} (BSB)`);

  // The verse itself is the trigger: click or right-click pops a floating
  // toolbar anchored to the verse. Nothing is reserved in the text flow, so
  // the reading column stays clean.
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) onSelect();
      }}
    >
      <PopoverTrigger asChild>
        <span
          onClick={onSelect}
          onContextMenu={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
          className={cn(
            "cursor-pointer rounded-sm font-serif leading-[2] transition-colors hover:bg-accent/60",
            color && CLASS_BY_COLOR[color],
            color && "px-0.5",
            open && "bg-accent ring-1 ring-primary/40",
          )}
        >
          <sup className="mr-0.5 select-none align-super text-[0.62em] font-sans font-semibold text-primary-600">
            {n}
          </sup>
          {text}
          {hasNote && (
            <StickyNote
              className="ml-1 inline-block align-super text-primary-500"
              style={{ width: 12, height: 12 }}
            />
          )}
          {(memorised || justAdded) && (
            <Brain
              className="ml-1 inline-block align-super text-primary-500"
              style={{ width: 12, height: 12 }}
            />
          )}
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={4} className="w-auto p-2">
        <div className="mb-1.5 px-0.5 text-xs font-semibold text-muted-foreground">
          {refLabel(ho, chapter, n)}
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
            label="Copy"
            onClick={() => {
              copy();
              setOpen(false);
            }}
          >
            <Copy style={{ width: 15, height: 15 }} />
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
