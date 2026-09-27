import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db";
import { AlignLeft, ChevronLeft, Hand, ChevronRight, PanelRightClose, PanelRightOpen, Rows3, Search } from "lucide-react";
import { ChapterPicker } from "@/components/bible/ChapterPicker";
import { TranslationPicker } from "@/components/bible/TranslationPicker";
import { ParallelPicker } from "@/components/bible/ParallelPicker";
import { Reader } from "@/components/bible/Reader";
import { StudyRail } from "@/components/bible/StudyRail";
import { StudyRailCoach } from "@/components/bible/StudyRailCoach";
import { ReturnChip } from "@/components/bible/ReturnChip";
import { useRailLayout } from "@/lib/layout";
import { useUI } from "@/store/ui";
import { isDesktopMouse } from "@/lib/device";
import { useChapterNav } from "@/lib/useChapterNav";
import { Button, ChipGroup, Tooltip } from "@/components/ui";
import { cn } from "@/lib/cn";

export function BiblePage() {
  const { railOpen, toggleRail, setRailOpen, readingLayout, setReadingLayout, railEverOpened, noteBibleOpen } = useUI();
  const navigate = useNavigate();
  const { step } = useChapterNav();
  const [coach, setCoach] = useState<null | "toggle" | "resize">(null);
  const rail = useRailLayout();

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
    // Only the docked rail has a drag handle; the Fold's floating panel does not.
    if (coach === "toggle" && railOpen) setCoach(rail.mode === "docked" ? "resize" : null);
  }, [railOpen, coach, rail.mode]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 whitespace-nowrap border-b border-border bg-background/80 px-3 py-2.5 backdrop-blur md:px-4 md:py-3">
        <ChapterPicker />
        <div className="flex items-center gap-1">
          <Tooltip label="Previous chapter">
            <Button variant="ghost" size="icon" onClick={() => step(-1)} aria-label="Previous chapter">
              <ChevronLeft size={18} />
            </Button>
          </Tooltip>
          <Tooltip label="Next chapter">
            <Button variant="ghost" size="icon" onClick={() => step(1)} aria-label="Next chapter">
              <ChevronRight size={18} />
            </Button>
          </Tooltip>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <ChipGroup
            variant="segmented"
            label="Reading layout"
            value={readingLayout}
            onValueChange={(v) => v && setReadingLayout(v)}
            className="mr-1 hidden bg-transparent sm:inline-flex"
            options={[
              { value: "lines", label: <Rows3 size={16} aria-hidden />, ariaLabel: "Verse per line", title: "Verse per line" },
              { value: "flowing", label: <AlignLeft size={16} aria-hidden />, ariaLabel: "Flowing paragraphs", title: "Flowing paragraphs" },
            ]}
          />
          <Tooltip label="Search scripture">
            <Button variant="ghost" size="icon" onClick={() => navigate("/search")} aria-label="Search">
              <Search size={18} />
            </Button>
          </Tooltip>
          <TranslationPicker />
          <div className="hidden sm:block">
            <ParallelPicker />
          </div>
          <Tooltip label={railOpen ? "Hide commentary" : "Show commentary"}>
            <Button variant="ghost" size="icon" onClick={toggleRail} aria-label="Toggle commentary">
              {railOpen ? (
                <PanelRightClose size={18} />
              ) : (
                <PanelRightOpen size={18} />
              )}
            </Button>
          </Tooltip>
        </div>
      </header>

      <ReturnChip />
      <ReaderHint />
      {/* The rail is positioned inside this box; the reader leaves it `reserve` px. */}
      <div className="relative min-h-0 flex-1">
        <div className="h-full min-w-0" style={{ paddingRight: rail.reserve }}>
          <Reader />
        </div>
        {railOpen && <StudyRail />}
      </div>

      {coach && <StudyRailCoach step={coach} onDismiss={() => setCoach(null)} />}
    </div>
  );
}

/** First run: say what tapping a verse does, until it's dismissed (UX 12). */
function ReaderHint() {
  const dismissed = useUI((s) => s.readerHintDismissed);
  const dismiss = useUI((s) => s.dismissReaderHint);
  const hasAnnotations = useLiveQuery(async () => (await db.highlights.count()) + (await db.notes.count()) > 0, []);
  // Someone who already highlights or takes notes has found it; don't tell them.
  if (dismissed || hasAnnotations !== false) return null;
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  return (
    <div
      role="note"
      className={cn(
        "flex items-center gap-3 border-b border-border bg-primary/10 px-4 py-2 text-sm",
        "text-primary-900 dark:text-primary-100",
      )}
    >
      <Hand size={16} className="shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        {touch ? "Tap" : "Click"} a verse to highlight it, add a note, copy it or pray about it.
      </p>
      <Button variant="ghost" size="sm" onClick={dismiss} className="shrink-0">
        Got it
      </Button>
    </div>
  );
}
