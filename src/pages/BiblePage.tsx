import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen, Search } from "lucide-react";
import { ChapterPicker } from "@/components/bible/ChapterPicker";
import { TranslationPicker } from "@/components/bible/TranslationPicker";
import { Reader } from "@/components/bible/Reader";
import { CommentaryRail } from "@/components/bible/CommentaryRail";
import { useUI } from "@/store/ui";
import { loadIndex, type BookIndexEntry } from "@/data/bible";
import { BOOKS } from "@/lib/osis";
import { Button, Tooltip } from "@/components/ui";

export function BiblePage() {
  const { ho, chapter, goTo, railOpen, toggleRail } = useUI();
  const navigate = useNavigate();
  const [index, setIndex] = useState<BookIndexEntry[]>([]);

  useEffect(() => {
    loadIndex().then(setIndex);
  }, []);

  const chapterCount = index.find((b) => b.id === ho)?.chapters ?? 1;

  function step(delta: number) {
    const next = chapter + delta;
    if (next >= 1 && next <= chapterCount) {
      goTo(ho, next);
      return;
    }
    // cross book boundaries
    const order = BOOKS.find((b) => b.ho === ho)?.order ?? 1;
    if (delta > 0 && order < 66) {
      const nb = BOOKS[order]; // order is 1-based → BOOKS[order] is next
      goTo(nb.ho, 1);
    } else if (delta < 0 && order > 1) {
      const pb = BOOKS[order - 2];
      const pbCount = index.find((b) => b.id === pb.ho)?.chapters ?? 1;
      goTo(pb.ho, pbCount);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border bg-background/80 px-4 py-3 backdrop-blur">
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
          <Tooltip label="Search scripture">
            <Button variant="ghost" size="icon" onClick={() => navigate("/search")} aria-label="Search">
              <Search style={{ width: 18, height: 18 }} />
            </Button>
          </Tooltip>
          <TranslationPicker />
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
        {railOpen && <CommentaryRail />}
      </div>
    </div>
  );
}
