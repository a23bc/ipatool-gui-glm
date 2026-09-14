import { createHashRouter, Navigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { AuthPage } from "@/pages/AuthPage";
import { SearchPage } from "@/pages/SearchPage";
import { DownloadsPage } from "@/pages/DownloadsPage";
import { HistoryPage } from "@/pages/HistoryPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { IpatoolMissingPage } from "@/pages/IpatoolMissingPage";
import { useAppStore } from "@/stores/app";

// The "missing ipatool" gate is implemented as a wrapper element that
// redirects to /setup when ipatool is not available, otherwise renders the
// inner route.
function Gate() {
  const ipatool = useAppStore((s) => s.ipatool);
  if (!ipatool) return null; // still booting
  if (ipatool.found_via === "missing") return <IpatoolMissingPage />;
  return <AppShell />;
}

export const router = createHashRouter([
  {
    path: "/",
    element: <Gate />,
    children: [
      { index: true, element: <Navigate to="/search" replace /> },
      { path: "auth", element: <AuthPage /> },
      { path: "search", element: <SearchPage /> },
      { path: "downloads", element: <DownloadsPage /> },
      { path: "history", element: <HistoryPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);
