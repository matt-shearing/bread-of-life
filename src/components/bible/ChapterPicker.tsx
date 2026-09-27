import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, CornerDownLeft } from "lucide-react";
import { BOOKS } from "@/lib/osis";
import { findBook, formatReference, parseReference } from "@/lib/reference";
import { loadIndex, type BookIndexEntry } from "@/data/bible";
import { useUI } from "@/store/ui";
import { useCoarsePointer } from "@/lib/layout";
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { refLabel } from "@/lib/osis";
import { cn } from "@/lib/cn";

/**
 * Book + chapter picker. Opens scrolled to the book you're in, and a filter box
 * narrows the book list as you type — or takes a whole reference ("jn 3", "ps 23:4").
 */
export function ChapterPicker() {
  const { ho, chapter, goTo } = useUI();
  const [index, setIndex] = useState<BookIndexEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [selBook, setSelBook] = useState(ho);
  const [filter, setFilter] = useState("");
  const bookList = useRef<HTMLDivElement>(null);
  const coarse = useCoarsePointer();

  useEffect(() => {
    loadIndex().then(setIndex);
  }, []);
  useEffect(() => setSelBook(ho), [ho]);

  // Each time it opens: start from the current book, scrolled into view.
  useEffect(() => {
    if (!open) return;
    setSelBook(ho);
    setFilter("");
    const raf = requestAnimationFrame(() => {
      bookList.current?.querySelector<HTMLElement>(`[data-book="${ho}"]`)?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(raf);
  }, [open, ho]);

  const f = filter.trim().toLowerCase();
  const ref = useMemo(() => (f ? parseReference(f) : null), [f]);
  const shown = useMemo(() => {
    if (!f) return BOOKS;
    const alias = findBook(f);
    return BOOKS.filter((b) => b.name.toLowerCase().includes(f) || b.osis.toLowerCase().startsWith(f) || b.ho === alias?.ho);
  }, [f]);

  // Narrowed to one book: select it, so its chapters show straight away.
  useEffect(() => {
    if (shown.length === 1) setSelBook(shown[0].ho);
    else if (ref) setSelBook(ref.ho);
  }, [shown, ref]);

  const chapterCount = index.find((b) => b.id === selBook)?.chapters ?? 1;
  const ot = shown.filter((b) => b.testament === "OT");
  const nt = shown.filter((b) => b.testament === "NT");

  function go(book: string, ch: number, verse?: number) {
    goTo(book, ch, verse);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-1.5 whitespace-nowrap font-serif text-base" aria-label={`Choose book and chapter, now ${refLabel(ho, chapter)}`}>
          {refLabel(ho, chapter)}
          <ChevronDown style={{ width: 16, height: 16 }} className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(520px,calc(100vw-1.5rem))] p-0"
        // On touch, don't pop the keyboard up over the list just for opening it.
        onOpenAutoFocus={(e) => {
          if (coarse) e.preventDefault();
        }}
      >
        <form
          className="border-b border-border p-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (ref) go(ref.ho, ref.chapter, ref.verse);
            else if (shown.length === 1) setSelBook(shown[0].ho);
          }}
        >
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter books, or type “jn 3”"
            aria-label="Filter books or type a reference"
            className="h-10"
          />
          {ref && !ref.bookOnly && (
            <button
              type="submit"
              className="mt-2 flex w-full items-center justify-between rounded-md bg-primary/10 px-3 py-2 text-left text-sm font-medium text-primary-700 hover:bg-primary/15 dark:text-primary-300"
            >
              Go to {formatReference(ref)}
              <CornerDownLeft style={{ width: 14, height: 14 }} />
            </button>
          )}
        </form>
        <div className="grid grid-cols-2">
          <div ref={bookList} className="max-h-72 overflow-y-auto border-r border-border p-2">
            {ot.length > 0 && (
              <div className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Old Testament
              </div>
            )}
            {ot.map((b) => (
              <BookRow key={b.ho} ho={b.ho} name={b.name} active={b.ho === selBook} onClick={() => setSelBook(b.ho)} />
            ))}
            {nt.length > 0 && (
              <div className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                New Testament
              </div>
            )}
            {nt.map((b) => (
              <BookRow key={b.ho} ho={b.ho} name={b.name} active={b.ho === selBook} onClick={() => setSelBook(b.ho)} />
            ))}
            {shown.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">No book matches.</p>}
          </div>
          <div className="max-h-72 overflow-y-auto p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {BOOKS.find((b) => b.ho === selBook)?.name} · chapter
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {Array.from({ length: chapterCount }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  onClick={() => go(selBook, n)}
                  aria-current={selBook === ho && n === chapter ? "true" : undefined}
                  className={cn(
                    "flex h-10 items-center justify-center rounded-md text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selBook === ho && n === chapter && "bg-primary text-primary-foreground hover:bg-primary-600",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function BookRow({ ho, name, active, onClick }: { ho: string; name: string; active: boolean; onClick: () => void }) {
  return (
    <button
      data-book={ho}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "w-full rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-accent font-medium",
      )}
    >
      {name}
    </button>
  );
}
