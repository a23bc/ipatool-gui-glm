// Boot the app: load ipatool info + settings on first mount; subscribe to
// download events.
import { useEffect } from "react";
import { ipc, type Settings, type IpatoolInfo } from "@/lib/ipc";
import { useAppStore } from "@/stores/app";
import { useDownloadEvents } from "@/hooks/useDownloadEvents";

export function useAppBootstrap() {
  const setIpatool = useAppStore((s) => s.setIpatool);
  const setSettings = useAppStore((s) => s.setSettings);
  const setAuthed = useAppStore((s) => s.setAuthed);
  useDownloadEvents();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [info, settings] = await Promise.all([
        ipc.ipatoolPath().catch((e): IpatoolInfo => ({
          found_via: "missing",
          path: "",
          version: String(e),
        })),
        ipc.getSettings().catch((): Settings => ({
          download_dir: "",
          country: "us",
          email: "",
          keep_history: true,
          notify_on_finish: true,
          theme: "",
        })),
      ]);
      if (cancelled) return;
      setIpatool(info);
      setSettings(settings as Settings);
      // Probe auth — account command returns error if not logged in.
      try {
        await ipc.authAccount();
        if (!cancelled) setAuthed(true);
      } catch {
        if (!cancelled) setAuthed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setIpatool, setSettings, setAuthed]);
}
