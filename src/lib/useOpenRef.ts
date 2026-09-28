import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useUI } from "@/store/ui";

/** Where a followed reference came from, e.g. `{ path: "/devotional", label: "Devotional" }`. */
export interface RefOrigin {
  path: string;
  label: string;
}

/**
 * Open a passage in the Bible tab, landing on (and briefly highlighting) the verse.
 *
 * With an `origin`, the jump is a *peek*: the reader shows a "Back to <label>" chip,
 * your own reading position is left alone while you look, and going back puts the
 * Bible tab where you were before. Every "tap a reference" in the app goes through
 * here so they all behave the same way.
 */
export function useOpenRef() {
  const navigate = useNavigate();
  return useCallback(
    (ho: string, chapter: number, verse?: number | null, origin?: RefOrigin) => {
      const s = useUI.getState();
      if (origin) {
        // Keep the FIRST origin if one peek leads to another (a cross-ref inside a
        // devotional reference): "back" should still mean back to the devotional.
        if (!s.returnTo) {
          const own = s.readingPos;
          const prev =
            own && own.ho === s.ho && own.chapter === s.chapter
              ? { ho: own.ho, chapter: own.chapter, verse: own.verse }
              : { ho: s.ho, chapter: s.chapter, verse: null };
          s.setReturnTo({ path: origin.path, label: origin.label, prev });
        }
      } else {
        s.setReturnTo(null);
      }
      s.goTo(ho, chapter, verse ?? null);
      navigate("/bible");
    },
    [navigate],
  );
}

/** Go back from a peek: restore the Bible tab to your own place, then return to the origin. */
export function useReturnFromRef() {
  const navigate = useNavigate();
  return useCallback(() => {
    const s = useUI.getState();
    const r = s.returnTo;
    if (!r) return;
    s.setReturnTo(null);
    s.goTo(r.prev.ho, r.prev.chapter, r.prev.verse, { flash: false });
    navigate(r.path);
  }, [navigate]);
}
