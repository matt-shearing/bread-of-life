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

// Install sync hooks + kick off cross-device sync (no-op until signed in).
startSync();

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
