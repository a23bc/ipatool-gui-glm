// One row in the search results list. Encapsulates icon + meta + the
// download button + per-app progress UI.
import { useState } from "react";
import { Download, CheckCircle2, XCircle, Loader2, ExternalLink, Clock } from "lucide-react";
import { ipc, type Settings } from "@/lib/ipc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAppStore, useDownloadStore } from "@/stores/app";
import { useToast } from "@/components/ui/toaster";
import { cn, formatBytes, formatRelativeTime } from "@/lib/utils";

export type AppInfo = {
  bundleIdentifier?: string;
  trackId?: number | string;
  name?: string;
  trackName?: string;
  artistName?: string;
  sellerName?: string;
  version?: string;
  currentVersionReleaseDate?: string | number;
  fileSizeBytes?: string | number;
  minimumOsVersion?: string;
  artworkUrl100?: string;
  artworkUrl512?: string;
  iconUrl?: string;
  screenshotUrls?: string[];
  trackViewUrl?: string;
  trackContentRating?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  price?: number | string;
  formattedPrice?: string;
  description?: string;
};

export function AppRow({ app }: { app: AppInfo }) {
  const settings = useAppStore((s) => s.settings) as Settings | null;
  const authed = useAppStore((s) => s.authed);
  const upsert = useDownloadStore((s) => s.upsert);
  const patch = useDownloadStore((s) => s.patch);
  const download = useDownloadStore((s) => s.downloads[app.bundleIdentifier ?? ""]);
  const toast = useToast().toast;
  const [submitting, setSubmitting] = useState(false);

  const bundleId = app.bundleIdentifier ?? "";
  const name = app.name ?? app.trackName ?? "(unknown)";
  const artist = app.artistName ?? app.sellerName ?? "";
  const version = app.version ?? "";
  const size = formatBytes(Number(app.fileSizeBytes ?? 0) || 0);
  const released = app.currentVersionReleaseDate
    ? formatRelativeTime(app.currentVersionReleaseDate)
    : "";
  const icon = app.artworkUrl512 ?? app.artworkUrl100 ?? app.iconUrl ?? "";
  const trackUrl = app.trackViewUrl;

  async function onDownload() {
    if (!bundleId) {
      toast({
        title: "Cannot download",
        description: "This result has no bundle identifier.",
        variant: "destructive",
      });
      return;
    }
    if (!authed) {
      toast({
        title: "Not signed in",
        description: "Go to Account to sign in first.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const token = await ipc.downloadStart(
        bundleId,
        settings?.country ?? "us",
        settings?.download_dir || undefined,
      );
      upsert({
        bundleId,
        token,
        percent: 0,
        message: "",
        startedAt: Date.now(),
        status: "running",
      });
    } catch (e) {
      toast({
        title: "Download failed to start",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function onCancel() {
    await ipc.downloadCancel();
    patch(bundleId, { status: "cancelled" });
  }

  const status = download?.status;
  const percent = download?.percent ?? 0;

  return (
    <div className="glass-card group flex items-start gap-4 p-3 transition-all hover:border-primary/30">
      <div className="relative shrink-0">
        {icon ? (
          <img
            src={icon}
            alt={name}
            loading="lazy"
            className="h-16 w-16 rounded-xl border border-border object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
            ?
          </div>
        )}
        <div className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-card bg-background/80 backdrop-blur-md">
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-[10px]"> </span>
          </div>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-medium">{name}</h3>
          {app.formattedPrice && app.formattedPrice !== "0" && (
            <Badge variant="secondary">{app.formattedPrice}</Badge>
          )}
          {app.formattedPrice === "0" && <Badge variant="success">Free</Badge>}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{artist || "—"}</div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="font-mono">{bundleId}</span>
          </span>
          {version && <span>v{version}</span>}
          <span>{size}</span>
          {released && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {released}
            </span>
          )}
          {typeof app.averageUserRating === "number" && app.averageUserRating > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-400">
              <span>★</span> {app.averageUserRating.toFixed(1)}
              <span className="text-muted-foreground">
                ({Intl.NumberFormat("en", { notation: "compact" }).format(app.userRatingCount ?? 0)})
              </span>
            </span>
          )}
          {trackUrl && (
            <a
              href={trackUrl}
              onClick={(e) => {
                e.preventDefault();
                ipc.openExternal(trackUrl);
              }}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> App Store
            </a>
          )}
        </div>

        {status === "running" && (
          <div className="mt-2 flex items-center gap-2">
            <Progress value={percent} className="h-1.5 flex-1" />
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
              {percent ?? 0}%
            </span>
            <Button size="sm" variant="outline" onClick={onCancel} className="h-7 px-2">
              Cancel
            </Button>
          </div>
        )}
        {status === "done" && (
          <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-700/20 px-2 py-0.5 text-xs text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> Downloaded
          </div>
        )}
        {status === "error" && (
          <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-destructive/20 px-2 py-0.5 text-xs text-destructive">
            <XCircle className="h-3 w-3" /> Failed — see Downloads
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        {status === "running" ? (
          <Button size="sm" variant="ghost" disabled>
            <Loader2 className="h-4 w-4 animate-spin" />
          </Button>
        ) : (
          <Button size="sm" onClick={onDownload} disabled={submitting || !authed}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download
          </Button>
        )}
      </div>
    </div>
  );
}
