import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, X } from "lucide-react";
import { BOOKS, parseOsis, refLabel, toOsis } from "@/lib/osis";
import { getChapterFor, loadIndex, verses, type BookIndexEntry } from "@/data/bible";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui";
import { cn } from "@/lib/cn";

function osisToLabel(osis: string) {
  const p = parseOsis(osis);
  return p ? refLabel(p.ho, p.chapter, p.verse) : osis;
}

/**
 * "Tag in the Bible" — a self-contained verse picker. Navigate book → chapter,
 * tap verses to toggle them into the selection (across chapters), then confirm.
 * Returns an OSIS list (e.g. ["John.3.16", "John.3.17"]).
 */
export function VersePicker({
  initial = [],
  onConfirm,
  onClose,
}: {
  initial?: string[];
  onConfirm: (osis: string[]) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState<BookIndexEntry[]>([]);
  const [ho, setHo] = useState(() => parseOsis(initial[0] ?? "")?.ho ?? "JHN");
  const [chapter, setChapter] = useState(() => parseOsis(initial[0] ?? "")?.chapter ?? 1);
  const [verseNums, setVerseNums] = useState<number[]>([]);
  const [selected, setSelected] = useState<string[]>(initial);
  const [bookOpen, setBookOpen] = useState(false);
  const [chapOpen, setChapOpen] = useState(false);

  useEffect(() => {
    loadIndex().then(setIndex);
  }, []);

  useEffect(() => {
    let alive = true;
    getChapterFor("BSB", ho, chapter).then((ch) => {
      if (!alive) return;
      setVerseNums(ch ? verses(ch).map((v) => v.n) : []);
    });
    return () => {
      alive = false;
    };
  }, [ho, chapter]);

  const chapterCount = index.find((b) => b.id === ho)?.chapters ?? 1;
  const ot = BOOKS.filter((b) => b.testament === "OT");
  const nt = BOOKS.filter((b) => b.testament === "NT");
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggleVerse(n: number) {
    const osis = toOsis(ho, chapter, n);
    setSelected((prev) => (prev.includes(osis) ? prev.filter((o) => o !== osis) : [...prev, osis]));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Tag verses in the Bible</DialogTitle>
        <DialogDescription>Pick a passage, then tap verses to link them.</DialogDescription>

        {/* book + chapter navigators */}
        <div className="flex items-center gap-2">
          <Popover open={bookOpen} onOpenChange={setBookOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 font-serif">
                <BookOpen style={{ width: 14, height: 14 }} />
                {BOOKS.find((b) => b.ho === ho)?.name ?? ho}
                <ChevronDown style={{ width: 14, height: 14 }} className="opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="max-h-72 w-56 overflow-y-auto p-2">
              <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Old Testament
              </div>
              {ot.map((b) => (
                <BookRow
                  key={b.ho}
                  name={b.name}
                  active={b.ho === ho}
                  onClick={() => {
                    setHo(b.ho);
                    setChapter(1);
                    setBookOpen(false);
                  }}
                />
              ))}
              <div className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                New Testament
              </div>
              {nt.map((b) => (
                <BookRow
                  key={b.ho}
                  name={b.name}
                  active={b.ho === ho}
                  onClick={() => {
                    setHo(b.ho);
                    setChapter(1);
                    setBookOpen(false);
                  }}
                />
              ))}
            </PopoverContent>
          </Popover>

          <Popover open={chapOpen} onOpenChange={setChapOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 font-serif">
                Ch. {chapter}
                <ChevronDown style={{ width: 14, height: 14 }} className="opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="max-h-72 w-56 overflow-y-auto p-3">
              <div className="grid grid-cols-5 gap-1.5">
                {Array.from({ length: chapterCount }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setChapter(n);
                      setChapOpen(false);
                    }}
                    className={cn(
                      "flex h-9 items-center justify-center rounded-md text-sm hover:bg-accent",
                      n === chapter && "bg-primary text-primary-foreground hover:bg-primary-600",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* verse grid */}
        <div className="max-h-[34vh] overflow-y-auto rounded-md border border-border p-2">
          {verseNums.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Loading verses…</p>
          ) : (
            <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10">
              {verseNums.map((n) => {
                const on = selectedSet.has(toOsis(ho, chapter, n));
                return (
                  <button
                    key={n}
                    onClick={() => toggleVerse(n)}
                    aria-pressed={on}
                    className={cn(
                      "flex h-8 items-center justify-center rounded-md border text-sm transition-colors",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* running selection */}
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((o) => (
              <button
                key={o}
                onClick={() => setSelected((prev) => prev.filter((x) => x !== o))}
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs text-primary-700 hover:bg-primary/10 dark:text-primary-300"
              >
                {osisToLabel(o)}
                <X style={{ width: 11, height: 11 }} />
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(selected)}>
            OK{selected.length > 0 ? ` · ${selected.length}` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BookRow({ name, active, onClick }: { name: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
        active && "bg-accent font-medium",
      )}
    >
      {name}
    </button>
  );
}
