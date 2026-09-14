//! Tauri commands exposed to the frontend.
//!
//! All ipatool invocations go through the shell plugin, which chooses PATH →
//! sidecar → runtime-download in that order. We always pass `--non-interactive`
//! and `--format json` for one-shot commands (auth/info, search, list-purchases,
//! auth revoke). For `download` we run in *interactive* mode so the progress bar
//! streams to stdout (then we parse the % out of it); the final result is text,
//! but the exit code tells us success/failure.

use crate::ipatool::{self, ipatool_version_string};
use crate::settings::Settings;
use crate::sidecar::{self, Release};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{Command as ShellCommand, CommandEvent};
use tauri_plugin_shell::ShellExt;

static DOWNLOAD_CANCEL_TOKEN: AtomicU64 = AtomicU64::new(0);
static LAST_CANCEL_TOKEN: Mutex<u64> = Mutex::new(0);

#[derive(Debug, Serialize, Clone)]
pub struct IpatoolInfo {
    pub found_via: String, // "path" | "sidecar" | "runtime-download" | "missing"
    pub path: String,
    pub version: String,
}

/// Locate ipatool and return version info. Used by the frontend on app boot
/// to decide what to show in Settings.
#[tauri::command]
pub fn ipatool_path(app: AppHandle) -> IpatoolInfo {
    if let Ok(p) = which::which("ipatool") {
        let version = ipatool_version_string(&app).unwrap_or_else(|_| "unknown".into());
        return IpatoolInfo {
            found_via: "path".into(),
            path: p.to_string_lossy().to_string(),
            version,
        };
    }
    if app.shell().sidecar("ipatool").is_ok() {
        let version = ipatool_version_string(&app).unwrap_or_else(|_| "unknown".into());
        return IpatoolInfo {
            found_via: "sidecar".into(),
            path: "(bundled sidecar)".into(),
            version,
        };
    }
    if sidecar::is_installed_locally(&app) {
        let version = ipatool_version_string(&app).unwrap_or_else(|_| "unknown".into());
        return IpatoolInfo {
            found_via: "runtime-download".into(),
            path: sidecar::bin_path(&app).to_string_lossy().to_string(),
            version,
        };
    }
    IpatoolInfo {
        found_via: "missing".into(),
        path: "".into(),
        version: "".into(),
    }
}

#[tauri::command]
pub fn ipatool_version(app: AppHandle) -> Result<String, String> {
    ipatool_version_string(&app)
}

/// Ensure ipatool is available — install it from GitHub releases if not.
/// Returns the new IpatoolInfo. Optional `release_tag` to pin a version.
///
/// We only consider ipatool "present" if it's actually on PATH or has been
/// downloaded into the app's local data dir. Just having the sidecar
/// configured in tauri.conf.json does NOT count — in dev mode the sidecar
/// binary may not be bundled.
#[tauri::command]
pub async fn ipatool_ensure(app: AppHandle, release_tag: Option<String>) -> Result<IpatoolInfo, String> {
    let on_path = which::which("ipatool").is_ok();
    let locally_downloaded = sidecar::is_installed_locally(&app);
    if on_path || locally_downloaded {
        return Ok(ipatool_path(app));
    }
    let release = if let Some(tag) = release_tag {
        fetch_release_by_tag(&tag)?
    } else {
        sidecar::fetch_latest_release()?
    };
    let app2 = app.clone();
    tokio::task::spawn_blocking(move || sidecar::install_release(&app2, &release))
        .await
        .map_err(|e| e.to_string())??;
    Ok(ipatool_path(app))
}

fn fetch_release_by_tag(tag: &str) -> Result<Release, String> {
    let url = format!(
        "https://api.github.com/repos/{}/releases/tags/{}",
        sidecar::IPATOOL_REPO,
        tag
    );
    let agent = reqwest::blocking::Client::builder()
        .user_agent(concat!("ipatool-gui/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = agent
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("GitHub API error: {}", resp.status()));
    }
    resp.json::<Release>().map_err(|e| e.to_string())
}

// ------------------------------ Auth ---------------------------------------

#[derive(Debug, Serialize)]
pub struct AuthLoginResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    /// Set when ipatool emitted the "2FA code is required" message (which
    /// happens with exit_code 0 — ipatool treats 2FA-required as success).
    pub needs_2fa: bool,
}

/// Spawn ipatool with the `IPATOOL_COUNTRY_CODE` env var set so all
/// subcommands honour the configured country (ipatool v2 reads country from
/// this env var rather than from a CLI flag).
fn spawn_with_country(app: &AppHandle, args: &[&str], country: &str) -> Result<ShellCommand, String> {
    let mut cmd = ipatool::spawn(app, args)?;
    if !country.is_empty() {
        cmd = cmd.env("IPATOOL_COUNTRY_CODE", country);
    }
    Ok(cmd)
}

#[tauri::command]
pub async fn auth_login(
    app: AppHandle,
    email: String,
    password: String,
    country: String,
) -> Result<AuthLoginResult, String> {
    let settings = Settings::load(&app);
    let country = if country.is_empty() { settings.country } else { country };
    let args: Vec<&str> = vec![
        "auth", "login",
        "--email", &email,
        "--password", &password,
        "--format", "json",
        "--non-interactive",
    ];
    let cmd = spawn_with_country(&app, &args, &country)?;
    let (mut rx) = cmd.spawn().map_err(|e| e.to_string())?;
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code = -1i32;
    while let Some(ev) = rx.recv().await {
        match ev {
            CommandEvent::Stdout(bytes) => {
                stdout.push_str(&String::from_utf8_lossy(&bytes));
                let _ = app.emit("ipatool://auth-stdout", &stdout);
            }
            CommandEvent::Stderr(bytes) => {
                stderr.push_str(&String::from_utf8_lossy(&bytes));
                let _ = app.emit("ipatool://auth-stderr", &stderr);
            }
            CommandEvent::Terminated(p) => {
                code = p.code.unwrap_or(-1);
                break;
            }
            CommandEvent::Error(err) => {
                stderr.push_str(&err);
                let _ = app.emit("ipatool://auth-stderr", &stderr);
            }
            _ => {}
        }
    }
    // ipatool exits 0 even when 2FA is required — we have to inspect the
    // stdout JSON for the well-known message string.
    let combined = format!("{} {}", stdout, stderr).to_lowercase();
    let needs_2fa = combined.contains("2fa code is required")
        || combined.contains("auth code is required")
        || combined.contains("verification code")
        || (code == 0 && !combined.contains("\"success\":true") && combined.contains("code"));
    Ok(AuthLoginResult {
        exit_code: code,
        stdout,
        stderr,
        needs_2fa,
    })
}

#[tauri::command]
pub async fn auth_2fa(
    app: AppHandle,
    email: String,
    password: String,
    country: String,
    code: String,
) -> Result<AuthLoginResult, String> {
    let settings = Settings::load(&app);
    let country = if country.is_empty() { settings.country } else { country };
    let args: Vec<&str> = vec![
        "auth", "login",
        "--email", &email,
        "--password", &password,
        "--auth-code", &code,
        "--format", "json",
        "--non-interactive",
    ];
    let cmd = spawn_with_country(&app, &args, &country)?;
    let (mut rx) = cmd.spawn().map_err(|e| e.to_string())?;
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code_exit = -1i32;
    while let Some(ev) = rx.recv().await {
        match ev {
            CommandEvent::Stdout(b) => stdout.push_str(&String::from_utf8_lossy(&b)),
            CommandEvent::Stderr(b) => stderr.push_str(&String::from_utf8_lossy(&b)),
            CommandEvent::Terminated(p) => {
                code_exit = p.code.unwrap_or(-1);
                break;
            }
            _ => {}
        }
    }
    Ok(AuthLoginResult {
        exit_code: code_exit,
        stdout,
        stderr,
        needs_2fa: false,
    })
}

#[tauri::command]
pub fn auth_account(app: AppHandle, country: Option<String>) -> Result<serde_json::Value, String> {
    let settings = Settings::load(&app);
    let country = country.unwrap_or(settings.country);
    // `auth info` (renamed from `auth account` in ipatool v2)
    let args: Vec<&str> = vec!["auth", "info", "--format", "json", "--non-interactive"];
    let cmd = spawn_with_country(&app, &args, &country)?;
    run_command_to_json(cmd)
}

#[tauri::command]
pub fn auth_logout(app: AppHandle, country: Option<String>) -> Result<serde_json::Value, String> {
    let settings = Settings::load(&app);
    let country = country.unwrap_or(settings.country);
    // `auth revoke` (renamed from `auth logout` in ipatool v2)
    let args: Vec<&str> = vec!["auth", "revoke", "--format", "json", "--non-interactive"];
    let cmd = spawn_with_country(&app, &args, &country)?;
    run_command_to_json(cmd)
}

// ------------------------------ Search -------------------------------------

#[tauri::command]
pub fn search_app(app: AppHandle, query: String, country: Option<String>) -> Result<serde_json::Value, String> {
    let settings = Settings::load(&app);
    let country = country.unwrap_or(settings.country);
    // ipatool search takes a *positional* arg, not a flag.
    let args: Vec<&str> = vec![
        "search", &query,
        "--limit", "25",
        "--format", "json",
        "--non-interactive",
    ];
    let cmd = spawn_with_country(&app, &args, &country)?;
    run_command_to_json(cmd)
}

#[tauri::command]
pub fn app_lookup(app: AppHandle, bundle_id: String, country: Option<String>) -> Result<serde_json::Value, String> {
    // ipatool doesn't expose a `lookup` subcommand; we simulate by searching
    // the bundle ID and filtering client-side.
    let settings = Settings::load(&app);
    let country = country.unwrap_or(settings.country);
    let args: Vec<&str> = vec![
        "search", &bundle_id,
        "--limit", "25",
        "--format", "json",
        "--non-interactive",
    ];
    let cmd = spawn_with_country(&app, &args, &country)?;
    let json = run_command_to_json(cmd)?;
    if let Some(apps) = json.get("apps").and_then(|v| v.as_array()) {
        let filtered: Vec<&serde_json::Value> = apps
            .iter()
            .filter(|a| {
                a.get("bundleID")
                    .or_else(|| a.get("bundle_id"))
                    .or_else(|| a.get("bundleIdentifier"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.eq_ignore_ascii_case(&bundle_id))
                    .unwrap_or(false)
            })
            .collect();
        return Ok(serde_json::json!({
            "count": filtered.len(),
            "apps": filtered,
        }));
    }
    Ok(json)
}

// ------------------------------ Download -----------------------------------

#[tauri::command]
pub async fn download_start(
    app: AppHandle,
    bundle_id: String,
    country: Option<String>,
    download_dir: Option<String>,
) -> Result<u64, String> {
    let token = DOWNLOAD_CANCEL_TOKEN.fetch_add(1, Ordering::SeqCst) + 1;
    *LAST_CANCEL_TOKEN.lock().unwrap() = token;

    let settings = Settings::load(&app);
    let country = country.unwrap_or(settings.country);
    // We deliberately do NOT pass --non-interactive here: in interactive mode
    // ipatool streams a progress bar to stdout, which we parse for %.
    let mut args: Vec<String> = vec![
        "download".into(),
        "-b".into(),
        bundle_id.clone(),
    ];
    if let Some(dir) = download_dir.filter(|s| !s.is_empty()) {
        args.push("--output".into());
        args.push(dir);
    } else if !settings.download_dir.is_empty() {
        args.push("--output".into());
        args.push(settings.download_dir.clone());
    }

    let app_for_emit = app.clone();
    let token_for_task = token;
    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let cmd = spawn_with_country(&app, &args_refs, &country)?;
    let (mut rx) = cmd.spawn().map_err(|e| e.to_string())?;

    tokio::spawn(async move {
        let mut buf = String::new();
        while let Some(ev) = rx.recv().await {
            if *LAST_CANCEL_TOKEN.lock().unwrap() != token_for_task {
                let _ = app_for_emit.emit(
                    "ipatool://download-finish",
                    serde_json::json!({
                        "token": token_for_task,
                        "code": -1,
                        "error": "cancelled",
                    }),
                );
                return;
            }
            match ev {
                CommandEvent::Stdout(bytes) => {
                    let s = String::from_utf8_lossy(&bytes).to_string();
                    buf.push_str(&s);
                    let pct = parse_progress(&buf);
                    let _ = app_for_emit.emit(
                        "ipatool://download-progress",
                        serde_json::json!({
                            "token": token_for_task,
                            "percent": pct,
                            "message": s,
                            "bundleId": bundle_id,
                        }),
                    );
                }
                CommandEvent::Stderr(bytes) => {
                    let s = String::from_utf8_lossy(&bytes).to_string();
                    buf.push_str(&s);
                    let _ = app_for_emit.emit(
                        "ipatool://download-progress",
                        serde_json::json!({
                            "token": token_for_task,
                            "percent": parse_progress(&buf),
                            "message": s,
                            "bundleId": bundle_id,
                        }),
                    );
                }
                CommandEvent::Terminated(p) => {
                    let code = p.code.unwrap_or(-1);
                    if code == 0 && Settings::load(&app_for_emit).notify_on_finish {
                        use tauri_plugin_notification::NotificationExt;
                        let _ = app_for_emit
                            .notification()
                            .builder()
                            .title("ipatool-gui")
                            .body(format!("Download finished: {}", bundle_id))
                            .show();
                    }
                    let _ = app_for_emit.emit(
                        "ipatool://download-finish",
                        serde_json::json!({
                            "token": token_for_task,
                            "code": code,
                            "error": if code == 0 { null } else { buf.clone() },
                        }),
                    );
                    return;
                }
                _ => {}
            }
        }
    });

    Ok(token)
}

/// ipatool prints a progressbar-style line to stdout in interactive mode:
///   `downloading  42% |████████     | (12/26 MB, 1.2 MB/s) [9s elapsed]`
/// We walk back from the last `%` to extract the most recent percent value.
fn parse_progress(buf: &str) -> Option<u32> {
    let mut last: Option<u32> = None;
    for line in buf.split('\r') {
        let l = line.trim();
        if let Some(idx) = l.rfind('%') {
            let mut start = idx;
            while start > 0 && (l.as_bytes()[start - 1] as char).is_ascii_digit() {
                start -= 1;
            }
            if let Ok(n) = l[start..idx].parse::<u32>() {
                last = Some(n.clamp(0, 100));
            }
        }
        // progressbar also reports byte counters like "(12/26 MB)" — we
        // could compute % from those if no explicit % was found.
        if last.is_none() {
            if let Some(idx) = l.rfind('(') {
                if let Some(close) = l[idx..].find(')') {
                    let inner = &l[idx + 1..idx + close];
                    // Format: "12/26 MB"
                    if let Some(slash) = inner.find('/') {
                        if let (Ok(a), Ok(b)) = (
                            inner[..slash].trim().parse::<f64>(),
                            inner[slash + 1..].split_whitespace().next().unwrap_or("1").parse::<f64>(),
                        ) {
                            if b > 0.0 {
                                last = Some(((a / b) * 100.0).clamp(0.0, 100.0) as u32);
                            }
                        }
                    }
                }
            }
        }
    }
    last
}

#[tauri::command]
pub fn download_cancel() -> bool {
    *LAST_CANCEL_TOKEN.lock().unwrap() = 0;
    true
}

// ------------------------------ History / Files ---------------------------

#[tauri::command]
pub fn list_downloaded(app: AppHandle, country: Option<String>) -> Result<serde_json::Value, String> {
    let settings = Settings::load(&app);
    let country = country.unwrap_or(settings.country);
    // `list-purchases` (renamed from `list-downloaded` in ipatool v2)
    let args: Vec<&str> = vec![
        "list-purchases",
        "--max-results", "100",
        "--format", "json",
        "--non-interactive",
    ];
    let cmd = spawn_with_country(&app, &args, &country)?;
    run_command_to_json(cmd)
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg({
                let p = std::path::PathBuf::from(&path);
                if p.is_file() {
                    p.parent().unwrap_or(&p).to_string_lossy().to_string()
                } else {
                    path
                }
            })
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        open::that(&path).map_err(|e| e.to_string())
    }
}

// ------------------------------ Settings ----------------------------------

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    Settings::load(&app)
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    settings.save(&app)
}

// ------------------------------ Misc --------------------------------------

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

// ------------------------------ Helpers -----------------------------------

/// Spawn a `ShellCommand` synchronously and parse its stdout as JSON. Used
/// for one-shot commands (auth info, search, list-purchases, auth revoke).
fn run_command_to_json(cmd: ShellCommand) -> Result<serde_json::Value, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    let (mut rx_events) = cmd.spawn().map_err(|e| e.to_string())?;
    let tx2 = tx.clone();
    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();
    std::thread::spawn(move || {
        while let Some(ev) = rx_events.blocking_recv() {
            match ev {
                CommandEvent::Stdout(bytes) => {
                    stdout_buf.push_str(&String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Stderr(bytes) => {
                    stderr_buf.push_str(&String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Error(err) => {
                    let _ = tx2.send(Err(err.to_string()));
                    return;
                }
                CommandEvent::Terminated(payload) => {
                    if payload.code != Some(0) {
                        let msg = if !stderr_buf.is_empty() {
                            stderr_buf.clone()
                        } else {
                            stdout_buf.clone()
                        };
                        // Try to extract a JSON error object from stderr.
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&stderr_buf.trim()) {
                            if let Some(err_msg) = v.get("error").and_then(|e| e.as_str()) {
                                let _ = tx2.send(Err(err_msg.to_string()));
                                return;
                            }
                        }
                        let _ = tx2.send(Err(format!(
                            "ipatool exited with code {:?}: {}",
                            payload.code, msg
                        )));
                    } else {
                        let _ = tx2.send(Ok(stdout_buf.clone()));
                    }
                    return;
                }
                _ => {}
            }
        }
        let _ = tx.send(Ok(stdout_buf.clone()));
    });
    let out = rx.recv().map_err(|e| e.to_string())??;
    parse_json(&out)
}

/// Best-effort JSON parse. ipatool emits one JSON object per line (zerolog
/// JSON format). We return the last non-empty line's parsed value, or, if
/// multiple lines, wrap them in an array. As a fallback, return the raw text.
fn parse_json(out: &str) -> Result<serde_json::Value, String> {
    let trimmed = out.trim();
    if trimmed.is_empty() {
        return Ok(serde_json::Value::Null);
    }
    // Try parsing as a single JSON value first.
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Ok(v);
    }
    // zerolog JSON output is line-delimited. Pick the last JSON-parseable line.
    let mut last_json: Option<serde_json::Value> = None;
    for line in trimmed.lines() {
        let l = line.trim();
        if l.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(l) {
            last_json = Some(v);
        }
    }
    if let Some(v) = last_json {
        return Ok(v);
    }
    // Could not parse — return raw text wrapped so the UI can display it.
    Ok(serde_json::json!({ "raw": trimmed }))
}
