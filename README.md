# ipatool-gui

A cross-platform desktop GUI for the [`ipatool`](https://github.com/majd/ipatool) command-line tool — search the App Store, manage your Apple ID auth session, and download IPA packages, all without leaving a native app.

Built with **Tauri 2** + **React 18** + **TypeScript** + **Tailwind CSS**. The Rust backend spawns the `ipatool` binary as a sidecar (or via PATH), streams progress events to the frontend, and never bundles the `ipatool` binary inside the repository itself — instead, GitHub Actions fetches the matching release at build time.

> ⚠️ **Disclaimer:** This project is an unofficial GUI wrapper and is not affiliated with Apple Inc. or the `ipatool` project. Use only with Apple IDs you own, and only to download apps you have legitimately acquired. Downloading IPAs you have not purchased may violate Apple's terms of service.

---

## Features

- 🔐 **Account management** — sign in with Apple ID, handle 2FA, view account info, revoke credentials.
- 🔎 **App Store search** — by name, bundle ID, or App Store URL.
- ⬇️ **Download with live progress** — percentage parsing from `ipatool`'s interactive progress bar.
- 📜 **Purchase history** — list apps owned by your Apple ID (`list-purchases`).
- 🛠️ **Auto-install `ipatool`** — if `ipatool` isn't on PATH or bundled as a sidecar, click one button to fetch the latest release from GitHub into the app's data directory.
- ⚙️ **Settings** — download directory, country code, notifications, history.
- 🌗 **Dark theme** out of the box; designed for fast keyboard-driven navigation.
- 📦 **No binary in the repo** — CI downloads the right `ipatool` release per platform at build time, so this repo stays tiny and license-clean.

## Screenshots

> _Add screenshots after the first release._

---

## Installation

Pre-built binaries are produced by GitHub Actions for **macOS (Intel & Apple Silicon)**, **Windows**, and **Linux**. Once a release is published, grab the artifact matching your platform from the [Releases page](../../releases).

| Platform | File |
|---|---|
| macOS Apple Silicon | `ipatool-gui_*_aarch64.dmg` |
| macOS Intel | `ipatool-gui_*_x64.dmg` |
| Windows | `ipatool-gui_*_x64-setup.exe` / `ipatool-gui_*_x64_en-US.msi` |
| Linux | `ipatool-gui_*_amd64.deb` / `.AppImage` / `.rpm` |

### Bundled `ipatool` vs. your own

The packaged app **ships with `ipatool` as a sidecar binary**, so it works out of the box. If you already have `ipatool` installed on your `PATH`, the app will detect it and prefer it (useful for developers).

If you ever run a portable build that doesn't include the sidecar, open **Settings → ipatool runtime → Install ipatool** to download the latest release automatically.

---

## Building from source

### Prerequisites

- **Rust** stable (1.77+) — `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Node.js** 20+ and **pnpm** 9+ — `npm install -g pnpm`
- Platform-specific:
  - **Linux:** `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libssl-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev`
  - **macOS:** Xcode command-line tools
  - **Windows:** WebView2 runtime (preinstalled on Win11; downloadable on Win10)

### Local dev

```bash
pnpm install
# Fetch the matching ipatool binary into src-tauri/binaries/
python scripts/fetch_ipatool.py --target "$(rustc -vV | sed -n 's|host: ||p')" \
  --pattern "$(python scripts/detect_pattern.py)" --ext tar.gz
pnpm tauri dev
```

### Production build

```bash
pnpm install
python scripts/fetch_ipatool.py --target <triple> --pattern <pattern> --ext <tar.gz|zip>
pnpm tauri build
# Output: src-tauri/target/release/bundle/
```

### CI build (this is the recommended path)

Push a tag like `v0.1.0` and GitHub Actions will:

1. Fetch the latest `ipatool` release binaries for all four Rust target triples.
2. Build `ipatool-gui` for each platform with `tauri-action`.
3. Upload artifacts per platform.
4. Draft a GitHub release with all binaries attached.

The `Build & Release` workflow is at [`.github/workflows/build.yml`](.github/workflows/build.yml).

---

## How it works

```
┌─────────────────────────────────────────────────────────────────┐
│                       ipatool-gui (this repo)                   │
│                                                                 │
│  ┌───────────────────────┐        ┌────────────────────────┐    │
│  │  React + Tailwind UI  │ ←────→ │  Rust (Tauri 2) shell  │    │
│  │  - Search page        │  IPC   │  - Spawns ipatool via   │    │
│  │  - Download page      │        │    sidecar / PATH       │    │
│  │  - Settings page      │        │  - Streams stdout/stderr│    │
│  │  - History page       │        │    as Tauri events      │    │
│  │  - Auth page          │        │  - Parses progress %   │    │
│  └───────────────────────┘        └─────────┬──────────────┘    │
│                                             │                   │
└─────────────────────────────────────────────┼───────────────────┘
                                              │ spawn
                                              ▼
                                  ┌────────────────────────┐
                                  │  ipatool (sidecar)     │  ← fetched by CI
                                  │  - auth login / info   │     or runtime
                                  │  - search <term>      │     auto-install
                                  │  - download -b <id>    │
                                  │  - list-purchases     │
                                  └────────────────────────┘
```

Key design choices:

- **No `ipatool` binary in the repo.** The CI workflow's `fetch-ipatool` job downloads the latest release from `majd/ipatool` and uploads it as an artifact. The `build` job then downloads all four target artifacts and copies the matching one into `src-tauri/binaries/` before running `tauri build`. Tauri's `externalBin` mechanism bundles these binaries into the final `.app` / `.exe` / `.AppImage`.
- **Fallback to PATH.** If you have `ipatool` installed via Homebrew / Scoop / Go, the app will detect and prefer it — useful for development.
- **Runtime auto-install.** If both sidecar and PATH lookups fail, the Settings page offers a one-click install that fetches the latest `majd/ipatool` release into the app's local data directory.
- **Streaming progress.** `ipatool download` writes a progressbar-format line to stdout in interactive mode. The Rust backend parses the percentage out of the running stream and emits it to the frontend via Tauri events.
- **2FA handling.** `ipatool auth login` exits with code 0 even when a 2FA code is required (it treats this as success and writes a JSON message asking the caller to re-run with `--auth-code`). The Rust backend inspects the JSON output and surfaces a `needs_2fa: true` flag, which the frontend uses to pop a 2FA dialog.
- **Country code.** `ipatool` reads the country from the `IPATOOL_COUNTRY_CODE` environment variable. The Rust backend sets this per-invocation based on the value chosen in Settings.

## Project structure

```
.
├── .github/workflows/build.yml   # Multi-platform CI: fetch ipatool + tauri build + release
├── scripts/
│   ├── fetch_ipatool.py          # CI helper: download + extract + rename ipatool release asset
│   └── generate_icons.py         # Render the icon set (PNG/ICO/ICNS) procedurally
├── src-tauri/
│   ├── Cargo.toml                # Rust manifest
│   ├── tauri.conf.json           # Tauri config (externalBin = bin/ipatool)
│   ├── capabilities/main.json    # Permissions for the main window
│   ├── icons/                    # Generated by scripts/generate_icons.py
│   └── src/
│       ├── main.rs               # Entry point
│       ├── lib.rs                # Plugin registration + command handler list
│       ├── ipatool.rs            # ipatool discovery + spawn + version sniff
│       ├── sidecar.rs            # Runtime download + install of majd/ipatool releases
│       ├── commands.rs           # All Tauri commands (auth, search, download, ...)
│       └── settings.rs           # JSON settings persistence
└── src/                          # React + Tailwind frontend
    ├── main.tsx                  # React root
    ├── router.tsx                # Hash router with ipatool-missing gate
    ├── pages/                    # Auth, Search, Downloads, History, Settings, IpatoolMissing
    ├── components/               # AppShell sidebar + UI primitives (button, input, etc.)
    ├── stores/                   # Zustand stores (app state + download state)
    ├── hooks/                    # Bootstrap + download-event subscription
    └── lib/                      # IPC facade + utilities
```

## Contributing

PRs are welcome. For local development, you do **not** need to run `tauri build` — `pnpm tauri dev` will hot-reload the frontend and rebuild the Rust backend on changes. To avoid fetching `ipatool` for every dev run, install it on your PATH (`brew install ipatool` or `go install`) and the app will use it automatically.

## License

MIT — see [`LICENSE`](LICENSE).
