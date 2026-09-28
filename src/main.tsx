import React, { lazy, Suspense, type ComponentType } from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import { AppShell } from "@/components/layout/AppShell";
import { RouteFallback } from "@/components/layout/RouteFallback";
import { startSync } from "@/db/sync";
import { startPrefSync } from "@/store/syncedPrefs";
import { startKeySync } from "@/store/keySync";
import { ensureAndroidDropFolder } from "@/data/missler";
import { ensureReadingLogBackfill } from "@/db/readingLog";

// Safety net: if something throws before React mounts, show it instead of a
// blank window (much easier to diagnose than a white screen).
window.addEventListener("error", (e) => {
  const el = document.getElementById("root");
  if (el && !el.childElementCount)
    el.innerHTML = `<pre style="color:#b00;padding:16px;white-space:pre-wrap;font:12px monospace">Startup error: ${e.message}\n${e.filename}:${e.lineno}\n${e.error?.stack ?? ""}</pre>`;
});

// Every page is its own chunk, loaded when first visited, so opening the app
// doesn't parse code (the journal editor, the AI companion…) for pages you
// never open. Pages use named exports; lazyPage adapts them for React.lazy and
// wraps each in its own Suspense so the app shell stays put while one loads.
function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  const Page = lazy<ComponentType>(() => load().then((m) => ({ default: m[name] })));
  return function LazyPage() {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Page />
      </Suspense>
    );
  };
}
const DashboardPage = lazyPage(() => import("@/pages/DashboardPage"), "DashboardPage");
const BiblePage = lazyPage(() => import("@/pages/BiblePage"), "BiblePage");
const PrayersPage = lazyPage(() => import("@/pages/PrayersPage"), "PrayersPage");
const JournalPage = lazyPage(() => import("@/pages/JournalPage"), "JournalPage");
const SearchPage = lazyPage(() => import("@/pages/SearchPage"), "SearchPage");
const PlansPage = lazyPage(() => import("@/pages/PlansPage"), "PlansPage");
const GuidedReaderPage = lazyPage(() => import("@/pages/GuidedReaderPage"), "GuidedReaderPage");
const DevotionalPage = lazyPage(() => import("@/pages/DevotionalPage"), "DevotionalPage");
const CompanionPage = lazyPage(() => import("@/pages/CompanionPage"), "CompanionPage");
const MemoryLanePage = lazyPage(() => import("@/pages/MemoryLanePage"), "MemoryLanePage");
const SettingsPage = lazyPage(() => import("@/pages/SettingsPage"), "SettingsPage");
const CommentaryPage = lazyPage(() => import("@/pages/CommentaryPage"), "CommentaryPage");
const ReadTodayPage = lazyPage(() => import("@/pages/ReadTodayPage"), "ReadTodayPage");
const HistoryPage = lazyPage(() => import("@/pages/HistoryPage"), "HistoryPage");
const FaithfulnessPage = lazyPage(() => import("@/pages/FaithfulnessPage"), "FaithfulnessPage");

// HashRouter: works identically under Vite dev and Tauri's file:// asset loading.
const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "bible", element: <BiblePage /> },
      { path: "search", element: <SearchPage /> },
      { path: "plans", element: <PlansPage /> },
      { path: "guided/:planId/:day", element: <GuidedReaderPage /> },
      { path: "read-today", element: <ReadTodayPage /> },
      { path: "commentary", element: <CommentaryPage /> },
      { path: "devotional", element: <DevotionalPage /> },
      { path: "companion", element: <CompanionPage /> },
      { path: "memory", element: <MemoryLanePage /> },
      { path: "prayers", element: <PrayersPage /> },
      { path: "journal", element: <JournalPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "history", element: <HistoryPage /> },
    ],
  },
  // Standalone (outside the app shell) so it prints cleanly to PDF.
  { path: "/faithfulness", element: <FaithfulnessPage /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);

// Kick off sync AFTER render, guarded — it must never block the UI.
setTimeout(() => {
  try {
    // Before the first round, so the round that catches up can share the user's keys.
    startKeySync();
    startSync();
    // Mirror account-level prefs (the active reading plan & friends) into the
    // synced `settings` table so they follow you between devices.
    startPrefSync();
  } catch (e) {
    console.error("sync init failed", e);
  }
  // Best-effort: ensure the permission-free Android/media Missler drop folder exists
  // so users have a file-manager-writable place to drop the library (no adb, no
  // all-files-access). Never blocks render.
  void ensureAndroidDropFolder();
  // Once per device: seed the reading log from reading done before it existed.
  void ensureReadingLogBackfill();
}, 0);
