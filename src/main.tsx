import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardPage } from "@/pages/DashboardPage";
import { BiblePage } from "@/pages/BiblePage";
import { PrayersPage } from "@/pages/PrayersPage";
import { JournalPage } from "@/pages/JournalPage";
import { SearchPage } from "@/pages/SearchPage";
import { PlansPage } from "@/pages/PlansPage";
import { GuidedReaderPage } from "@/pages/GuidedReaderPage";
import { DevotionalPage } from "@/pages/DevotionalPage";
import { CompanionPage } from "@/pages/CompanionPage";
import { MemoryLanePage } from "@/pages/MemoryLanePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { CommentaryPage } from "@/pages/CommentaryPage";
import { ReadTodayPage } from "@/pages/ReadTodayPage";
import { FaithfulnessPage } from "@/pages/FaithfulnessPage";
import { startSync } from "@/db/sync";
import { ensureAndroidDropFolder } from "@/data/missler";

// Safety net: if something throws before React mounts, show it instead of a
// blank window (much easier to diagnose than a white screen).
window.addEventListener("error", (e) => {
  const el = document.getElementById("root");
  if (el && !el.childElementCount)
    el.innerHTML = `<pre style="color:#b00;padding:16px;white-space:pre-wrap;font:12px monospace">Startup error: ${e.message}\n${e.filename}:${e.lineno}\n${e.error?.stack ?? ""}</pre>`;
});

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
    startSync();
  } catch (e) {
    console.error("sync init failed", e);
  }
  // Best-effort: ensure the permission-free Android/media Missler drop folder exists
  // so users have a file-manager-writable place to drop the library (no adb, no
  // all-files-access). Never blocks render.
  void ensureAndroidDropFolder();
}, 0);
