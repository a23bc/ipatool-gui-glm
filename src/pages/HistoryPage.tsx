import { useQuery } from "@tanstack/react-query";
import { FolderOpen, History as HistoryIcon, Loader2, Package } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatRelativeTime } from "@/lib/utils";

type HistoryItem = {
  bundleIdentifier?: string;
  name?: string;
  version?: string;
  fileSizeBytes?: string | number;
  downloadedAt?: string | number;
  path?: string;
};

export function HistoryPage() {
  const query = useQuery({
    queryKey: ["list-downloaded"],
    queryFn: () => ipc.listDownloaded(),
    staleTime: 30_000,
  });

  const items: HistoryItem[] = (() => {
    if (!query.data) return [];
    const d = query.data as { results?: HistoryItem[]; apps?: HistoryItem[]; [k: string]: unknown };
    if (Array.isArray(d.results)) return d.results;
    if (Array.isArray(d.apps)) return d.apps;
    if (Array.isArray(query.data)) return query.data as HistoryItem[];
    if (typeof query.data === "object" && query.data) return [query.data as HistoryItem];
    return [];
  })();

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="text-sm text-muted-foreground">
            IPA files previously downloaded by <code>ipatool</code> on this machine.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          <HistoryIcon className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {query.isFetching && items.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {!query.isFetching && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Package className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-medium">No downloads yet</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Once you download an IPA, it will appear here so you can re-open
            or move the file.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item, i) => {
            const path = item.path ?? "";
            return (
              <div key={`${item.bundleIdentifier ?? i}-${path}`} className="glass-card flex items-center gap-3 p-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Package className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <div className="truncate font-medium">
                      {item.name || item.bundleIdentifier || "—"}
                    </div>
                    {item.downloadedAt && (
                      <div className="text-xs text-muted-foreground">
                        {formatRelativeTime(item.downloadedAt)}
                      </div>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {item.bundleIdentifier && (
                      <span className="font-mono">{item.bundleIdentifier}</span>
                    )}
                    {item.version && <span>v{item.version}</span>}
                    {item.fileSizeBytes && (
                      <span>{formatBytes(Number(item.fileSizeBytes))}</span>
                    )}
                    {path && (
                      <span className="truncate font-mono" title={path}>
                        {path}
                      </span>
                    )}
                  </div>
                </div>
                {path && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => ipc.revealInFinder(path)}
                    title="Reveal in file manager"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
