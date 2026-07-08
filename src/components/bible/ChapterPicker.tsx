import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { BOOKS } from "@/lib/osis";
import { loadIndex, type BookIndexEntry } from "@/data/bible";
import { useUI } from "@/store/ui";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@/components/ui";
import { refLabel } from "@/lib/osis";
import { cn } from "@/lib/cn";

export function ChapterPicker() {
  const { ho, chapter, goTo } = useUI();
  const [index, setIndex] = useState<BookIndexEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [selBook, setSelBook] = useState(ho);

  useEffect(() => {
    loadIndex().then(setIndex);
  }, []);
  useEffect(() => setSelBook(ho), [ho]);

  const chapterCount = index.find((b) => b.id === selBook)?.chapters ?? 1;
  const ot = BOOKS.filter((b) => b.testament === "OT");
  const nt = BOOKS.filter((b) => b.testament === "NT");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-1.5 font-serif text-base">
          {refLabel(ho, chapter)}
          <ChevronDown style={{ width: 16, height: 16 }} className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[520px] p-0">
        <div className="grid grid-cols-2">
          <div className="max-h-80 overflow-y-auto border-r border-border p-2">
            <div className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Old Testament
            </div>
            {ot.map((b) => (
              <BookRow key={b.ho} name={b.name} active={b.ho === selBook} onClick={() => setSelBook(b.ho)} />
            ))}
            <div className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              New Testament
            </div>
            {nt.map((b) => (
              <BookRow key={b.ho} name={b.name} active={b.ho === selBook} onClick={() => setSelBook(b.ho)} />
            ))}
          </div>
          <div className="max-h-80 overflow-y-auto p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Chapter
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {Array.from({ length: chapterCount }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    goTo(selBook, n);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-9 items-center justify-center rounded-md text-sm hover:bg-accent",
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
