import {
  BookHeart,
  BookMarked,
  BookOpen,
  Brain,
  CalendarCheck,
  HandHeart,
  History,
  Home,
  NotebookPen,
  Search,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match the path exactly (only Home, so it isn't "active" everywhere). */
  end?: boolean;
  /** Extra words the Ctrl+K palette matches on. */
  keywords?: string;
  /** In the phone's bottom bar; everything else sits under More. */
  mobilePrimary?: boolean;
}

/**
 * Every place in the app, once, with one label each. The sidebar, the phone's bottom
 * bar and its More sheet, and the Ctrl+K palette all read this list, so a page
 * is named the same wherever you meet it. Settings is last: the sidebar shows it in
 * its footer rather than the main list.
 */
export const NAV: NavItem[] = [
  { to: "/", label: "Home", icon: Home, end: true, keywords: "dashboard today", mobilePrimary: true },
  { to: "/bible", label: "Bible", icon: BookOpen, keywords: "read reader scripture", mobilePrimary: true },
  { to: "/commentary", label: "Commentary", icon: BookMarked },
  { to: "/search", label: "Search", icon: Search, keywords: "find" },
  { to: "/plans", label: "Reading plans", icon: CalendarCheck, keywords: "plan" },
  { to: "/devotional", label: "Devotional", icon: BookHeart, keywords: "spurgeon morning evening", mobilePrimary: true },
  { to: "/memory", label: "Memory Lane", icon: Brain, keywords: "memorise memorize review" },
  { to: "/prayers", label: "Prayers", icon: HandHeart, keywords: "pray", mobilePrimary: true },
  { to: "/journal", label: "Journal", icon: NotebookPen },
  { to: "/history", label: "Reading history", icon: History, keywords: "streak calendar on this day log" },
  { to: "/companion", label: "Companion", icon: Sparkles, keywords: "ai ask" },
  { to: "/settings", label: "Settings", icon: Settings, keywords: "preferences sync theme reminders" },
];

export const SETTINGS_NAV = NAV[NAV.length - 1];
/** The sidebar's main list (Settings lives in its footer). */
export const SIDEBAR_NAV = NAV.filter((n) => n !== SETTINGS_NAV);
