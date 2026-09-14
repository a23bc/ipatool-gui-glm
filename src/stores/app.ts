// Central app state: settings + ipatool info + download queue. We split
// frequently-changing state (download progress) into a separate store to
// avoid rerendering settings-heavy subscribers on every progress tick.
import { create } from "zustand";
import type { IpatoolInfo, Settings } from "@/lib/ipc";

type AppState = {
  ipatool: IpatoolInfo | null;
  settings: Settings | null;
  authed: boolean;
  setIpatool: (info: IpatoolInfo) => void;
  setSettings: (s: Settings) => void;
  setAuthed: (v: boolean) => void;
};

export const useAppStore = create<AppState>((set) => ({
  ipatool: null,
  settings: null,
  authed: false,
  setIpatool: (info) => set({ ipatool: info }),
  setSettings: (s) => set({ settings: s }),
  setAuthed: (v) => set({ authed: v }),
}));

// ---- Download store (high-frequency updates) ----

export type DownloadState = {
  bundleId: string;
  token: number;
  percent: number | null;
  message: string;
  startedAt: number;
  status: "running" | "done" | "error" | "cancelled";
};

type DownloadStore = {
  downloads: Record<string, DownloadState>;
  upsert: (d: DownloadState) => void;
  patch: (bundleId: string, patch: Partial<DownloadState>) => void;
  remove: (bundleId: string) => void;
  clearFinished: () => void;
};

export const useDownloadStore = create<DownloadStore>((set) => ({
  downloads: {},
  upsert: (d) =>
    set((s) => ({ downloads: { ...s.downloads, [d.bundleId]: d } })),
  patch: (bundleId, patch) =>
    set((s) => {
      const cur = s.downloads[bundleId];
      if (!cur) return s;
      return { downloads: { ...s.downloads, [bundleId]: { ...cur, ...patch } } };
    }),
  remove: (bundleId) =>
    set((s) => {
      const next = { ...s.downloads };
      delete next[bundleId];
      return { downloads: next };
    }),
  clearFinished: () =>
    set((s) => {
      const next: Record<string, DownloadState> = {};
      for (const [k, v] of Object.entries(s.downloads)) {
        if (v.status === "running") next[k] = v;
      }
      return { downloads: next };
    }),
}));
