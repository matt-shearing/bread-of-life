import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * The ONE UI-state store. Everything transient/navigational lives here; all
 * durable data lives in Dexie. This deliberate split is the antidote to the
 * "five competing state systems" that sank the prior attempt.
 */
type Theme = "light" | "dark";
export type ReadingLayout = "lines" | "flowing";

interface UIState {
  theme: Theme;
  toggleTheme: () => void;

  // current Bible location
  ho: string;
  chapter: number;
  goTo: (ho: string, chapter: number) => void;

  translation: string;
  setTranslation: (id: string) => void;

  // right study rail (commentary)
  railOpen: boolean;
  toggleRail: () => void;

  commentarySource: string;
  setCommentarySource: (id: string) => void;

  fontScale: number; // scripture font multiplier
  setFontScale: (n: number) => void;

  readingLayout: ReadingLayout;
  setReadingLayout: (l: ReadingLayout) => void;

  // verse currently selected for study (Strong's / cross-refs in the rail)
  selectedVerse: number | null;
  selectVerse: (n: number | null) => void;

  railTab: "commentary" | "xref" | "strongs";
  setRailTab: (t: "commentary" | "xref" | "strongs") => void;

  activePlanId: string | null;
  setActivePlan: (id: string | null) => void;
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      theme: "light",
      toggleTheme: () => set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),

      ho: "JHN",
      chapter: 1,
      goTo: (ho, chapter) => set({ ho, chapter }),

      translation: "BSB",
      setTranslation: (id) => set({ translation: id }),

      railOpen: true,
      toggleRail: () => set((s) => ({ railOpen: !s.railOpen })),

      commentarySource: "matthew-henry",
      setCommentarySource: (id) => set({ commentarySource: id }),

      fontScale: 1,
      setFontScale: (n) => set({ fontScale: Math.min(1.5, Math.max(0.85, n)) }),

      readingLayout: "lines",
      setReadingLayout: (l) => set({ readingLayout: l }),

      selectedVerse: null,
      selectVerse: (n) => set({ selectedVerse: n }),

      railTab: "commentary",
      setRailTab: (t) => set({ railTab: t }),

      activePlanId: null,
      setActivePlan: (id) => set({ activePlanId: id }),
    }),
    { name: "bol-ui" },
  ),
);
