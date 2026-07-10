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

  // Until the index resolves, the current book's chapter count is UNKNOWN. Default
  // to Infinity (not 1) so a forward step stays inside the book instead of falling
  // through to the cross-book branch and silently skipping the whole book. Crossing
  // a boundary is gated on `entry` existing, so we never guess across books.
  const entry = index.find((b) => b.id === ho);
  const chapterCount = entry?.chapters ?? Infinity;
  const order = BOOKS.find((b) => b.ho === ho)?.order ?? 1;

  const canPrev = chapter > 1 || order > 1;
  const canNext = chapter < chapterCount || order < 66;

  function step(delta: number) {
    const next = chapter + delta;
    if (next >= 1 && next <= chapterCount) {
      goTo(ho, next);
      return;
    }
    if (!entry) return; // index not loaded for this book — don't cross a boundary we can't measure
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
