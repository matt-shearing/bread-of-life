import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardPage } from "@/pages/DashboardPage";
import { BiblePage } from "@/pages/BiblePage";
import { PrayersPage } from "@/pages/PrayersPage";
import { JournalPage } from "@/pages/JournalPage";
import { SettingsPage } from "@/pages/SettingsPage";

// HashRouter: works identically under Vite dev and Tauri's file:// asset loading.
const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "bible", element: <BiblePage /> },
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
