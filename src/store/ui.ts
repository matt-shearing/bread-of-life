import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * The ONE UI-state store. Everything transient/navigational lives here; all
 * durable data lives in Dexie. This deliberate split is the antidote to the
 * "five competing state systems" that sank the prior attempt.
 */
type Theme = "light" | "dark";
export type ReadingLayout = "lines" | "flowing";
export type DashboardBg = "plain" | "still" | "animated";

interface UIState {
  theme: Theme;
  toggleTheme: () => void;

  // current Bible location
  ho: string;
  chapter: number;
  goTo: (ho: string, chapter: number) => void;

  translation: string;
  setTranslation: (id: string) => void;

  parallel: string | null; // second translation shown side-by-side, or null
  setParallel: (id: string | null) => void;

  // right study rail (commentary)
  railOpen: boolean;
  toggleRail: () => void;
  setRailOpen: (open: boolean) => void;

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

  notifyPrayers: boolean;
  setNotifyPrayers: (v: boolean) => void;

  devotionalId: string;
  setDevotionalId: (id: string) => void;

  // devotional reminder
  notifyDevotion: boolean;
  devotionTime: string; // "HH:MM"
  setNotifyDevotion: (v: boolean) => void;
  setDevotionTime: (t: string) => void;

  dashboardBg: DashboardBg;
  setDashboardBg: (b: DashboardBg) => void;

  // first-run onboarding + the unobtrusive dashboard sync nudge
  hasOnboarded: boolean;
  setHasOnboarded: (v: boolean) => void;
  syncPromptDismissed: boolean;
  dismissSyncPrompt: () => void;

  // AI study companion
  ai: AIConfig;
  setAI: (patch: Partial<AIConfig>) => void;
  companionSeed: string | null; // a question to auto-send when the companion opens
  setCompanionSeed: (q: string | null) => void;
}

export type AIProvider = "anthropic" | "openai" | "xai" | "google" | "deepseek" | "ollama" | "custom";
export interface AIConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseUrl: string; // for ollama / custom OpenAI-compatible
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

      parallel: null,
      setParallel: (id) => set({ parallel: id }),

      railOpen: false,
      toggleRail: () => set((s) => ({ railOpen: !s.railOpen })),
      setRailOpen: (open) => set({ railOpen: open }),

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

      notifyPrayers: false,
      setNotifyPrayers: (v) => set({ notifyPrayers: v }),

      devotionalId: "spurgeon-morning-evening",
      setDevotionalId: (id) => set({ devotionalId: id }),

      notifyDevotion: false,
      devotionTime: "07:00",
      setNotifyDevotion: (v) => set({ notifyDevotion: v }),
      setDevotionTime: (t) => set({ devotionTime: t }),

      dashboardBg: "still",
      setDashboardBg: (b) => set({ dashboardBg: b }),

      hasOnboarded: false,
      setHasOnboarded: (v) => set({ hasOnboarded: v }),
      syncPromptDismissed: false,
      dismissSyncPrompt: () => set({ syncPromptDismissed: true }),

      ai: { provider: "anthropic", model: "claude-opus-4-8", apiKey: "", baseUrl: "" },
      setAI: (patch) => set((s) => ({ ai: { ...s.ai, ...patch } })),
      companionSeed: null,
      setCompanionSeed: (q) => set({ companionSeed: q }),
    }),
    { name: "bol-ui" },
  ),
);
