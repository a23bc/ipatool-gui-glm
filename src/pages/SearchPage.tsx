import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon, Loader2, AlertCircle } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/stores/app";
import { AppRow, type AppInfo } from "@/components/AppRow";

export function SearchPage() {
  const settings = useAppStore((s) => s.settings);
  const authed = useAppStore((s) => s.authed);
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState("");

  const search = useQuery({
    queryKey: ["search", committed, settings?.country],
    queryFn: () => ipc.searchApp(committed, settings?.country ?? "us"),
    enabled: committed.length > 0,
    staleTime: 60_000,
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setCommitted(q);
  }

  const results: AppInfo[] = useMemo(() => {
    if (!search.data) return [];
    // ipatool search returns either a top-level array, an array under "results",
    // or a single object. We normalize.
    const data = search.data as { results?: AppInfo[]; apps?: AppInfo[]; [k: string]: unknown };
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.apps)) return data.apps;
    if (Array.isArray(search.data)) return search.data as AppInfo[];
    // Single object — wrap.
    if (search.data && typeof search.data === "object") {
      return [search.data as AppInfo];
    }
    return [];
  }, [search.data]);

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground">
          Find apps on the App Store by name, bundle ID, or App Store URL.
        </p>
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Telegram, com.telegram.messenger, or an App Store URL"
            className="pl-9"
            autoFocus
          />
        </div>
        <Button type="submit" disabled={search.isFetching}>
          {search.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
          Search
        </Button>
      </form>

      {!authed && (
        <div className="flex items-center gap-2 rounded-md border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
          <AlertCircle className="h-4 w-4" />
          You are not signed in. Head to <span className="font-medium">Account</span> to log in before downloading.
        </div>
      )}

      {search.isFetching && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {!search.isFetching && committed && search.isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Search failed: {String((search.error as Error)?.message ?? search.error)}
        </div>
      )}

      {!search.isFetching && !search.isFetching && committed && results.length === 0 && !search.isError && (
        <div className="rounded-md border border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          No results found for <span className="font-medium text-foreground">{committed}</span>.
        </div>
      )}

      {!search.isFetching && results.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{results.length} result{results.length > 1 ? "s" : ""}</span>
            <span>Country: {settings?.country?.toUpperCase()}</span>
          </div>
          {results.map((app) => (
            <AppRow key={app.bundleIdentifier ?? app.trackId ?? JSON.stringify(app)} app={app} />
          ))}
        </div>
      )}

      {!committed && (
        <EmptyState />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border p-12 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <SearchIcon className="h-6 w-6 text-primary" />
      </div>
      <h3 className="text-base font-medium">Search the App Store</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Search for any app by name, bundle ID, or paste an App Store URL.
        Results include icon, size, version, and a one-click download button.
      </p>
    </div>
  );
}
