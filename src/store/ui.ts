import { create } from "zustand";
import { persist } from "zustand/middleware";
import { localDayKey, yesterdayKey } from "@/lib/day";

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
  // The guided reader can scope the reader to a verse range (Soul Food Classic
  // "part of a psalm"). Only honoured where a portion is explicitly wanted;
  // any plain goTo clears it.
  portion: { ho: string; chapter: number; start: number; end: number } | null;
  goToPortion: (ho: string, chapter: number, start: number, end: number) => void;

  translation: string;
  setTranslation: (id: string) => void;

  parallel: string | null; // second translation shown side-by-side, or null
  setParallel: (id: string | null) => void;

  // right study rail (commentary)
  railOpen: boolean;
  toggleRail: () => void;
  setRailOpen: (open: boolean) => void;

  railWidth: number; // desktop study-rail width in px (clamped)
  setRailWidth: (px: number) => void;

  // Discovery: has the study rail EVER been opened, and how many times the Bible
  // page has been opened — used to coach commentary on touch tablets/folds (where
  // the rail no longer auto-opens) without nagging people who already found it.
  railEverOpened: boolean;
  bibleOpens: number;
  noteBibleOpen: () => number; // increment + return the new count

  // left nav (Spotify-style collapse to icons-only on desktop)
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  commentarySource: string;
  setCommentarySource: (id: string) => void;

  fontScale: number; // scripture font multiplier
  setFontScale: (n: number) => void;

  readingLayout: ReadingLayout;
  setReadingLayout: (l: ReadingLayout) => void;

  // verse currently selected for study (Strong's / cross-refs in the rail)
  selectedVerse: number | null;
  selectVerse: (n: number | null) => void;

  railTab: "commentary" | "xref" | "strongs" | "references";
  setRailTab: (t: "commentary" | "xref" | "strongs" | "references") => void;

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

  // reading-plan daily reminder (defaults ON when a plan is enrolled)
  notifyPlan: boolean;
  setNotifyPlan: (v: boolean) => void;
  // shared clock time for the memory / prayers / plan daily reminders
  reminderTime: string; // "HH:MM"
  setReminderTime: (t: string) => void;

  // memory verses ("Memory Lane")
  notifyMemory: boolean; // opt-in daily "verse to hide in your heart" nudge
  setNotifyMemory: (v: boolean) => void;
  memoryStreak: number; // consecutive days with a completed review
  memoryLastReviewDay: string | null; // YYYY-MM-DD of the last review
  recordMemoryReview: () => void; // call once when a review session is done

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
      portion: null,
      goTo: (ho, chapter) => set({ ho, chapter, portion: null }),
      goToPortion: (ho, chapter, start, end) =>
        set({ ho, chapter, portion: { ho, chapter, start, end } }),

      translation: "BSB",
      setTranslation: (id) => set({ translation: id }),

      parallel: null,
      setParallel: (id) => set({ parallel: id }),

      railOpen: false,
      toggleRail: () => set((s) => ({ railOpen: !s.railOpen, railEverOpened: s.railEverOpened || !s.railOpen })),
      setRailOpen: (open) => set((s) => ({ railOpen: open, railEverOpened: s.railEverOpened || open })),

      railWidth: 360,
      setRailWidth: (px) => set({ railWidth: Math.min(640, Math.max(280, Math.round(px))) }),

      railEverOpened: false,
      bibleOpens: 0,
      noteBibleOpen: () => {
        let n = 0;
        set((s) => {
          n = s.bibleOpens + 1;
          return { bibleOpens: n };
        });
        return n;
      },

      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

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
      // Enrolling in a plan turns its daily reminder on by default (the user can
      // switch it off in Settings). Un-enrolling leaves the toggle as-is.
      setActivePlan: (id) => set(id ? { activePlanId: id, notifyPlan: true } : { activePlanId: id }),

      notifyPrayers: false,
      setNotifyPrayers: (v) => set({ notifyPrayers: v }),

      devotionalId: "spurgeon-morning-evening",
      setDevotionalId: (id) => set({ devotionalId: id }),

      notifyDevotion: false,
      devotionTime: "07:00",
      setNotifyDevotion: (v) => set({ notifyDevotion: v }),
      setDevotionTime: (t) => set({ devotionTime: t }),

      notifyPlan: false,
      setNotifyPlan: (v) => set({ notifyPlan: v }),
      reminderTime: "08:00",
      setReminderTime: (t) => set({ reminderTime: t }),

      notifyMemory: false,
      setNotifyMemory: (v) => set({ notifyMemory: v }),
      memoryStreak: 0,
      memoryLastReviewDay: null,
      recordMemoryReview: () =>
        set((s) => {
          const today = localDayKey();
          if (s.memoryLastReviewDay === today) return s; // already counted today
          const streak = s.memoryLastReviewDay === yesterdayKey() ? s.memoryStreak + 1 : 1;
          return { memoryStreak: streak, memoryLastReviewDay: today };
        }),

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
