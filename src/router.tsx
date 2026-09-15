import { createHashRouter, Navigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { AuthPage } from "@/pages/AuthPage";
import { SearchPage } from "@/pages/SearchPage";
import { DownloadsPage } from "@/pages/DownloadsPage";
import { HistoryPage } from "@/pages/HistoryPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { IpatoolMissingPage } from "@/pages/IpatoolMissingPage";
import { useAppStore } from "@/stores/app";
import { useAppBootstrap } from "@/hooks/useAppBootstrap";
import { BootSplash } from "@/components/BootSplash";

// Gate runs the bootstrap ON ENTRY — regardless of whether ipatool is
// known yet — so the store gets populated. Previously the bootstrap lived
// inside AppShell, which only rendered once ipatool was non-null, causing
// a deadlock where the bootstrap never ran and the screen stayed blank.
function Gate() {
  useAppBootstrap();
  const ipatool = useAppStore((s) => s.ipatool);
  if (!ipatool) return <BootSplash />;
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
