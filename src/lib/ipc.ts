// IPC helpers — keep all Tauri interactions behind a typed facade so the UI
// layer doesn't import `@tauri-apps/api` directly. This is also the file you
// mock out in Storybook / tests.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type IpatoolInfo = {
  found_via: "sidecar" | "path" | "runtime-download" | "missing" | string;
  path: string;
  version: string;
};

export type Settings = {
  download_dir: string;
  country: string;
  email: string;
  keep_history: boolean;
  notify_on_finish: boolean;
  theme: string;
};

export type AuthLoginResult = {
  exit_code: number;
  stdout: string;
  stderr: string;
  needs_2fa: boolean;
};

export type DownloadProgress = {
  token: number;
  percent: number | null;
  message: string;
  bundle_id?: string;
  bundleId?: string;
};

export type DownloadFinish = {
  token: number;
  code: number;
  error: string | null;
};

export const ipc = {
  ipatoolPath: () => invoke<IpatoolInfo>("ipatool_path"),
  ipatoolVersion: () => invoke<string>("ipatool_version"),
  ipatoolEnsure: (releaseTag?: string) =>
    invoke<IpatoolInfo>("ipatool_ensure", { releaseTag: releaseTag ?? null }),

  authLogin: (email: string, password: string, country: string) =>
    invoke<AuthLoginResult>("auth_login", { email, password, country }),
  auth2fa: (email: string, password: string, country: string, code: string) =>
    invoke<AuthLoginResult>("auth_2fa", { email, password, country, code }),
  authAccount: () => invoke<unknown>("auth_account"),
  authLogout: () => invoke<unknown>("auth_logout"),

  searchApp: (query: string, country?: string) =>
    invoke<unknown>("search_app", { query, country: country ?? null }),
  appLookup: (bundleId: string, country?: string) =>
    invoke<unknown>("app_lookup", { bundleId, country: country ?? null }),

  downloadStart: (bundleId: string, country?: string, downloadDir?: string) =>
    invoke<number>("download_start", {
      bundleId,
      country: country ?? null,
      downloadDir: downloadDir ?? null,
    }),
  downloadCancel: () => invoke<boolean>("download_cancel"),

  listDownloaded: () => invoke<unknown>("list_downloaded"),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  revealInFinder: (path: string) => invoke<void>("reveal_in_finder", { path }),

  getSettings: () => invoke<Settings>("get_settings"),
  setSettings: (settings: Settings) => invoke<void>("set_settings", { settings }),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
};

export const ipcEvents = {
  onDownloadProgress: (handler: (e: DownloadProgress) => void): Promise<UnlistenFn> =>
    listen<DownloadProgress>("ipatool://download-progress", (e) => handler(e.payload)),
  onDownloadFinish: (handler: (e: DownloadFinish) => void): Promise<UnlistenFn> =>
    listen<DownloadFinish>("ipatool://download-finish", (e) => handler(e.payload)),
  onAuthStdout: (handler: (s: string) => void): Promise<UnlistenFn> =>
    listen<string>("ipatool://auth-stdout", (e) => handler(e.payload)),
  onAuthStderr: (handler: (s: string) => void): Promise<UnlistenFn> =>
    listen<string>("ipatool://auth-stderr", (e) => handler(e.payload)),
};
