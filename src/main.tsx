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
import { DevotionalPage } from "@/pages/DevotionalPage";
import { CompanionPage } from "@/pages/CompanionPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { startSync } from "@/db/sync";

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
      { path: "devotional", element: <DevotionalPage /> },
      { path: "companion", element: <CompanionPage /> },
      { path: "prayers", element: <PrayersPage /> },
      { path: "journal", element: <JournalPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
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
}, 0);
