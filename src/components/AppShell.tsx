import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Search, Download, History, Settings as SettingsIcon, Apple, ShieldCheck, CircleAlert } from "lucide-react";
import { useAppStore } from "@/stores/app";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const NAV = [
  { to: "/search", label: "Search", icon: Search },
  { to: "/downloads", label: "Downloads", icon: Download },
  { to: "/history", label: "History", icon: History },
  { to: "/auth", label: "Account", icon: ShieldCheck },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export function AppShell() {
  const location = useLocation();
  const authed = useAppStore((s) => s.authed);
  const ipatool = useAppStore((s) => s.ipatool);

  // Smooth-scroll the main area when route changes for a touch of polish.
  useEffect(() => {
    const el = document.getElementById("main-scroll");
    if (el) el.scrollTo({ top: 0, behavior: "smooth" });
  }, [location.pathname]);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-16 shrink-0 border-r border-border bg-card/40 backdrop-blur-md flex flex-col items-center py-4 gap-2">
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-blue-500 shadow-md shadow-primary/30">
          <Apple className="h-5 w-5 text-white" />
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "group relative flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-muted hover:text-foreground",
                  isActive && "bg-primary/15 text-primary"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className="h-5 w-5" />
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
                  )}
                  <span className="pointer-events-none absolute left-full ml-2 hidden whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-foreground shadow-md group-hover:block">
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-1">
          <div
            className={cn(
              "h-2 w-2 rounded-full",
              authed ? "bg-emerald-500" : "bg-amber-500"
            )}
            title={authed ? "Signed in" : "Not signed in"}
          />
          <span className="text-[10px] text-muted-foreground">{ipatool?.version || ""}</span>
        </div>
      </aside>

      {/* Main content */}
      <main id="main-scroll" className="relative flex-1 overflow-y-auto overflow-x-hidden">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-md">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Apple className="h-3.5 w-3.5" />
            <span className="font-medium text-foreground">ipatool-gui</span>
            <Badge variant="outline" className="ml-1">
              {authed ? "Signed in" : "Guest"}
            </Badge>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {ipatool?.found_via === "missing" && (
              <span className="flex items-center gap-1 text-destructive">
                <CircleAlert className="h-3.5 w-3.5" />
                ipatool not found
              </span>
            )}
          </div>
        </header>

        <div className="mx-auto w-full max-w-6xl px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
