import { useMemo } from "react";
import { useDownloadStore } from "@/stores/app";
import { Download as DownloadIcon, CheckCircle2, XCircle, Loader2, Trash2, FolderOpen } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ipc } from "@/lib/ipc";
import { formatRelativeTime } from "@/lib/utils";

export function DownloadsPage() {
  const downloads = useDownloadStore((s) => s.downloads);
  const clearFinished = useDownloadStore((s) => s.clearFinished);
  const remove = useDownloadStore((s) => s.remove);
  const patch = useDownloadStore((s) => s.patch);

  const items = useMemo(
    () => Object.values(downloads).sort((a, b) => b.startedAt - a.startedAt),
    [downloads]
  );

  async function cancel(bundleId: string) {
    await ipc.downloadCancel();
    patch(bundleId, { status: "cancelled" });
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Downloads</h1>
          <p className="text-sm text-muted-foreground">
            Active downloads and recently finished jobs in this session.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={clearFinished} disabled={!items.some((d) => d.status !== "running")}>
          <Trash2 className="h-4 w-4" /> Clear finished
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <DownloadIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-medium">No downloads yet</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Search for an app and hit Download. Active progress will appear here
            in real time.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((d) => {
            const running = d.status === "running";
            return (
              <div key={d.bundleId} className="glass-card flex items-center gap-3 p-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {running ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : d.status === "done" ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <div className="truncate font-mono text-sm">{d.bundleId}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatRelativeTime(d.startedAt)}
                    </div>
                  </div>
                  {running ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <Progress value={d.percent ?? 0} className="h-1.5 flex-1" />
                      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                        {d.percent ?? 0}%
                      </span>
                    </div>
                  ) : (
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {d.message?.split("\n").pop() || (d.status === "done" ? "Completed." : d.status)}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {running ? (
                    <Button variant="outline" size="sm" onClick={() => cancel(d.bundleId)}>
                      Cancel
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(d.bundleId)}
                        title="Remove from list"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
