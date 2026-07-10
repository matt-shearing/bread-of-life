import { useEffect, useState } from "react";
import { useUI } from "@/store/ui";
import { loadIndex, type BookIndexEntry } from "@/data/bible";
import { BOOKS } from "@/lib/osis";

/**
 * Chapter navigation shared by the header chevrons and the reader's swipe
 * gestures. `step(+1)` = next chapter, `step(-1)` = previous — crossing book
 * boundaries just like the on-screen arrows. Book chapter counts come from the
 * (module-cached) Bible index, so calling this in more than one place is cheap.
 */
export function useChapterNav() {
  const { ho, chapter, goTo } = useUI();
  const [index, setIndex] = useState<BookIndexEntry[]>([]);

  useEffect(() => {
    loadIndex().then(setIndex);
  }, []);

  const chapterCount = index.find((b) => b.id === ho)?.chapters ?? 1;
  const order = BOOKS.find((b) => b.ho === ho)?.order ?? 1;

  const canPrev = chapter > 1 || order > 1;
  const canNext = chapter < chapterCount || order < 66;

  function step(delta: number) {
    const next = chapter + delta;
    if (next >= 1 && next <= chapterCount) {
      goTo(ho, next);
      return;
    }
    // cross book boundaries
    if (delta > 0 && order < 66) {
      const nb = BOOKS[order]; // order is 1-based → BOOKS[order] is the next book
      goTo(nb.ho, 1);
    } else if (delta < 0 && order > 1) {
      const pb = BOOKS[order - 2];
      const pbCount = index.find((b) => b.id === pb.ho)?.chapters ?? 1;
      goTo(pb.ho, pbCount);
    }
  }

  return { step, canPrev, canNext };
}
