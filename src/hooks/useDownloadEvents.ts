// Subscribe to download progress & finish events. Returns an unlisten fn
// (caller owns lifecycle; in practice we mount this once at the app root).
import { useEffect } from "react";
import { ipcEvents } from "@/lib/ipc";
import { useDownloadStore } from "@/stores/app";
import { useToast } from "@/components/ui/toaster";

export function useDownloadEvents() {
  const upsert = useDownloadStore((s) => s.upsert);
  const patch = useDownloadStore((s) => s.patch);
  const toast = useToast().toast;

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenFinish: (() => void) | undefined;

    (async () => {
      unlistenProgress = await ipcEvents.onDownloadProgress((e) => {
        const bid = e.bundleId ?? e.bundle_id;
        if (!bid) return;
        patch(bid, { percent: e.percent, message: e.message });
      });
      unlistenFinish = await ipcEvents.onDownloadFinish((e) => {
        // We don't carry bundleId in the finish payload — find by token.
        const store = useDownloadStore.getState();
        const entry = Object.values(store.downloads).find((d) => d.token === e.token);
        if (!entry) return;
        const status: "done" | "error" | "cancelled" =
          e.code === 0 ? "done" : e.error === "cancelled" ? "cancelled" : "error";
        patch(entry.bundleId, { status });
        const variant =
          status === "done" ? "success" : status === "cancelled" ? "default" : "destructive";
        toast({
          title:
            status === "done"
              ? "Download complete"
              : status === "cancelled"
              ? "Download cancelled"
              : "Download failed",
          description:
            status === "done"
              ? entry.bundleId
              : status === "cancelled"
              ? entry.bundleId
              : e.error ?? "Unknown error",
          variant,
        });
      });
    })();

    return () => {
      unlistenProgress?.();
      unlistenFinish?.();
    };
  }, [patch, toast]);
}
