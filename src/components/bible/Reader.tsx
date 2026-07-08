import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Copy, Highlighter, NotebookPen, HandHeart, StickyNote } from "lucide-react";
import { db, type HighlightColor } from "@/db";
import { setHighlight, clearHighlight, saveNote, recordProgress } from "@/db/repos";
import { getChapter, type Chapter } from "@/data/bible";
import { refLabel, bookByHo } from "@/lib/osis";
import { useUI } from "@/store/ui";
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

export function Reader() {
  const { ho, chapter, fontScale } = useUI();
  const [ch, setCh] = useState<Chapter | null>(null);
  const [loading, setLoading] = useState(true);
  const [capture, setCapture] = useState<{ mode: "journal" | "prayer"; verse: number; text: string } | null>(null);
  const [noteVerse, setNoteVerse] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getChapter(ho, chapter).then((c) => {
      if (!alive) return;
      setCh(c);
      setLoading(false);
      recordProgress(ho, chapter, 1);
      document.getElementById("reader-scroll")?.scrollTo({ top: 0 });
    });
    return () => {
      alive = false;
    };
  }, [ho, chapter]);

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

  if (loading) return <div className="p-10 text-muted-foreground">Loading…</div>;
  if (!ch) return <div className="p-10 text-muted-foreground">Chapter not found.</div>;

  return (
    <div
      id="reader-scroll"
      className="h-full overflow-y-auto"
      style={{ fontSize: `${fontScale}rem` }}
    >
      <article className="mx-auto max-w-2xl px-8 py-8">
        <h2 className="mb-6 font-serif text-3xl font-bold">{refLabel(ho, chapter)}</h2>
        {ch.items.map((item, i) =>
          item.t === "h" ? (
            <h3 key={i} className="mb-2 mt-6 font-serif text-lg font-bold text-primary-700 dark:text-primary-300">
              {item.text}
            </h3>
          ) : (
            <Verse
              key={i}
              ho={ho}
              chapter={chapter}
              n={item.n}
              text={item.text}
              color={hlByVerse.get(item.n)}
              hasNote={noteByVerse.has(item.n)}
              onNote={() => setNoteVerse(item.n)}
              onCapture={(mode) => setCapture({ mode, verse: item.n, text: item.text })}
            />
          ),
        )}
        <p className="mt-10 text-center text-xs text-muted-foreground">
          Berean Standard Bible · Public Domain (CC0)
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
  onNote: () => void;
  onCapture: (mode: "journal" | "prayer") => void;
}

function Verse({ ho, chapter, n, text, color, hasNote, onNote, onCapture }: VerseProps) {
  const toggleColor = (c: HighlightColor) => {
    if (color === c) clearHighlight(ho, chapter, n);
    else setHighlight(ho, chapter, n, c);
  };

  return (
    <span className="group relative">
      <span
        className={cn(
          "font-serif leading-[2] transition-colors [text-align:justify]",
          color && CLASS_BY_COLOR[color],
          color && "rounded px-0.5",
        )}
      >
        <sup className="mr-1 select-none text-[0.65em] font-sans font-semibold text-primary-600">{n}</sup>
        {text}
        {hasNote && (
          <StickyNote
            className="ml-1 inline-block align-super text-primary-500"
            style={{ width: 12, height: 12 }}
          />
        )}
      </span>{" "}
      <span className="inline-flex translate-y-[-1px] gap-0.5 align-middle opacity-0 transition-opacity group-hover:opacity-100">
        <Popover>
          <Tooltip label="Highlight">
            <PopoverTrigger asChild>
              <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <Highlighter style={{ width: 14, height: 14 }} />
              </button>
            </PopoverTrigger>
          </Tooltip>
          <PopoverContent className="flex gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c.key}
                aria-label={c.key}
                onClick={() => toggleColor(c.key)}
                className={cn(
                  "h-6 w-6 rounded-full border border-border",
                  c.className,
                  color === c.key && "ring-2 ring-primary ring-offset-1",
                )}
              />
            ))}
            {color && (
              <button
                onClick={() => clearHighlight(ho, chapter, n)}
                className="ml-1 rounded px-2 text-xs text-muted-foreground hover:bg-accent"
              >
                Clear
              </button>
            )}
          </PopoverContent>
        </Popover>

        <IconBtn label="Note" onClick={onNote} active={hasNote}>
          <NotebookPen style={{ width: 14, height: 14 }} />
        </IconBtn>
        <IconBtn label="Copy" onClick={() => navigator.clipboard?.writeText(`${text} — ${refLabel(ho, chapter, n)} (BSB)`)}>
          <Copy style={{ width: 14, height: 14 }} />
        </IconBtn>
        <IconBtn label="Journal" onClick={() => onCapture("journal")}>
          <span className="text-[11px] font-semibold">J</span>
        </IconBtn>
        <IconBtn label="Pray" onClick={() => onCapture("prayer")}>
          <HandHeart style={{ width: 14, height: 14 }} />
        </IconBtn>
      </span>
    </span>
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
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground",
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
