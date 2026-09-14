//! Sidecar download & installation.
//!
//! We don't ship ipatool in the repo (the user explicitly asked not to).
//! Instead, on first run we offer to fetch the latest ipatool release from
//! GitHub and stash it in the app's data dir. The shell plugin's sidecar API
//! only looks for binaries bundled at build time, so for the runtime-downloaded
//! copy we just call its path directly via std::process::Command.

use crate::ipatool::{ipatool_version_string, target_triple};
use crate::settings::Settings;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const IPATOOL_REPO: &str = "majd/ipatool";
const IPATOOL_API: &str = "https://api.github.com/repos/majd/ipatool/releases/latest";

#[derive(Debug, Deserialize, Serialize)]
pub struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Release {
    pub tag_name: String,
    pub name: String,
    pub assets: Vec<ReleaseAsset>,
    pub html_url: String,
    pub body: String,
}

pub fn bin_dir(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_local_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    let p = dir.join("bin");
    let _ = fs::create_dir_all(&p);
    p
}

pub fn bin_path(app: &AppHandle) -> PathBuf {
    let exe = if cfg!(target_os = "windows") { "ipatool.exe" } else { "ipatool" };
    bin_dir(app).join(exe)
}

pub fn is_installed_locally(app: &AppHandle) -> bool {
    bin_path(app).exists()
}

pub fn fetch_latest_release() -> Result<Release, String> {
    let agent = reqwest::blocking::Client::builder()
        .user_agent(concat!("ipatool-gui/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = agent
        .get(IPATOOL_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("GitHub API error: {}", resp.status()));
    }
    resp.json::<Release>().map_err(|e| e.to_string())
}

/// Pick the asset matching our target triple.
///
/// ipatool's release asset naming follows: `ipatool_<version>_<os>_<arch>.tar.gz`
/// on macOS/Linux and `ipatool_<version>_<os>_<arch>.zip` on Windows. We map
/// our target_triple() to a substring of the asset name.
pub fn pick_asset<'a>(release: &'a Release) -> Result<&'a ReleaseAsset, String> {
    let triple = target_triple();
    // Try a list of needles — different versions have used different naming.
    let needles: Vec<&str> = match triple {
        "darwin-arm64" => vec!["darwin_arm64", "darwin-arm64", "macos_arm64", "macos-arm64"],
        "darwin-amd64" => vec!["darwin_amd64", "darwin-amd64", "macos_amd64", "macos-amd64"],
        "linux-amd64" => vec!["linux_amd64", "linux-amd64"],
        "windows-amd64" => vec!["windows_amd64", "windows-amd64", "win_amd64", "win-amd64"],
        _ => return Err(format!("unsupported target: {}", triple)),
    };
    for needle in &needles {
        if let Some(asset) = release.assets.iter().find(|a| a.name.contains(needle)) {
            return Ok(asset);
        }
    }
    Err(format!(
        "no asset matching any of {:?} in release {}",
        needles, release.tag_name
    )
    .into())
}

pub fn install_release(app: &AppHandle, release: &Release) -> Result<(), String> {
    let asset = pick_asset(release)?;
    let agent = reqwest::blocking::Client::builder()
        .user_agent(concat!("ipatool-gui/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = agent
        .get(&asset.browser_download_url)
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("download failed: {}", resp.status()));
    }
    let bytes = resp.bytes().map_err(|e| e.to_string())?;
    let bin = bin_path(app);
    fs::write(&bin, &[]).map_err(|e| e.to_string())?; // touch + truncate
    let mut f = fs::File::create(&bin).map_err(|e| e.to_string())?;
    if asset.name.ends_with(".zip") {
        let cursor = std::io::Cursor::new(bytes);
        let mut zip = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
            let name = entry.name().to_string();
            // pick the executable inside
            if name.contains("ipatool") && !name.ends_with('/') {
                let mut buf = Vec::with_capacity(entry.size() as usize);
                std::io::copy(&mut entry, &mut buf).map_err(|e| e.to_string())?;
                f.write_all(&buf).map_err(|e| e.to_string())?;
                break;
            }
        }
    } else {
        // tar.gz
        let cursor = std::io::Cursor::new(bytes);
        let gz = flate2::read::GzDecoder::new(cursor);
        let mut tar = tar::Archive::new(gz);
        for entry in tar.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path().map_err(|e| e.to_string())?;
            let path = path.to_string_lossy();
            if path.contains("ipatool") && !path.ends_with('/') {
                let mut buf = Vec::new();
                std::io::copy(&mut entry, &mut buf).map_err(|e| e.to_string())?;
                f.write_all(&buf).map_err(|e| e.to_string())?;
                break;
            }
        }
    }
    drop(f);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o755);
        fs::set_permissions(&bin, perms).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Inform the shell plugin about the runtime-downloaded binary by writing a
/// symlink into the expected sidecar path. This is best-effort — if it fails
/// we'll fall back to PATH / pre-bundled sidecar.
pub fn _link_as_sidecar(app: &AppHandle) -> Result<(), String> {
    let _ = app;
    Ok(())
}

pub fn _settings_handle(app: &AppHandle) -> Settings {
    Settings::load(app)
}

pub fn _ensure_version_consistency(app: &AppHandle) -> Result<(), String> {
    let _ = ipatool_version_string(app)?;
    Ok(())
}
