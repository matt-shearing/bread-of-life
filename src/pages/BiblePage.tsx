import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlignLeft, ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen, Rows3, Search } from "lucide-react";
import { ChapterPicker } from "@/components/bible/ChapterPicker";
import { TranslationPicker } from "@/components/bible/TranslationPicker";
import { ParallelPicker } from "@/components/bible/ParallelPicker";
import { Reader } from "@/components/bible/Reader";
import { StudyRail } from "@/components/bible/StudyRail";
import { StudyRailCoach } from "@/components/bible/StudyRailCoach";
import { useUI } from "@/store/ui";
import { isDesktopMouse } from "@/lib/device";
import { useChapterNav } from "@/lib/useChapterNav";
import { Button, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";

export function BiblePage() {
  const { railOpen, toggleRail, setRailOpen, readingLayout, setReadingLayout, railEverOpened, noteBibleOpen } = useUI();
  const navigate = useNavigate();
  const { step } = useChapterNav();
  const [coach, setCoach] = useState<null | "toggle" | "resize">(null);

  // Only a real DESKTOP (a wide screen with a mouse) auto-opens the study rail —
  // there it enriches without crowding. On touch tablets/folds (coarse pointer,
  // same md width) it would squeeze the reader into a sliver, so we leave it
  // closed and instead, occasionally, coach where to find it (if never opened).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isDesktopMouse()) {
      setRailOpen(true);
      return;
    }
    const n = noteBibleOpen();
    const wide = window.matchMedia("(min-width: 768px)").matches; // tablet/fold width
    if (wide && !railEverOpened && n % 5 === 0) setCoach("toggle");
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When they take the hint and open the rail, advance to the resize hint.
  useEffect(() => {
    if (coach === "toggle" && railOpen) setCoach("resize");
  }, [railOpen, coach]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-background/80 px-3 py-2.5 backdrop-blur md:px-4 md:py-3">
        <ChapterPicker />
        <div className="flex items-center gap-1">
          <Tooltip label="Previous chapter">
            <Button variant="ghost" size="icon" onClick={() => step(-1)} aria-label="Previous chapter">
              <ChevronLeft style={{ width: 18, height: 18 }} />
            </Button>
          </Tooltip>
          <Tooltip label="Next chapter">
            <Button variant="ghost" size="icon" onClick={() => step(1)} aria-label="Next chapter">
              <ChevronRight style={{ width: 18, height: 18 }} />
            </Button>
          </Tooltip>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <div className="mr-1 hidden items-center rounded-md border border-border p-0.5 sm:flex">
            <Tooltip label="Verse per line">
              <button
                onClick={() => setReadingLayout("lines")}
                aria-label="Verse per line"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded",
                  readingLayout === "lines" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Rows3 style={{ width: 16, height: 16 }} />
              </button>
            </Tooltip>
            <Tooltip label="Flowing paragraphs">
              <button
                onClick={() => setReadingLayout("flowing")}
                aria-label="Flowing paragraphs"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded",
                  readingLayout === "flowing" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <AlignLeft style={{ width: 16, height: 16 }} />
              </button>
            </Tooltip>
          </div>
          <Tooltip label="Search scripture">
            <Button variant="ghost" size="icon" onClick={() => navigate("/search")} aria-label="Search">
              <Search style={{ width: 18, height: 18 }} />
            </Button>
          </Tooltip>
          <TranslationPicker />
          <div className="hidden sm:block">
            <ParallelPicker />
          </div>
          <Tooltip label={railOpen ? "Hide commentary" : "Show commentary"}>
            <Button variant="ghost" size="icon" onClick={toggleRail} aria-label="Toggle commentary">
              {railOpen ? (
                <PanelRightClose style={{ width: 18, height: 18 }} />
              ) : (
                <PanelRightOpen style={{ width: 18, height: 18 }} />
              )}
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <Reader />
        </div>
        {railOpen && <StudyRail />}
      </div>

      {coach && <StudyRailCoach step={coach} onDismiss={() => setCoach(null)} />}
    </div>
  );
}
