//! ipatool discovery & invocation.
//!
//! ipatool can be either:
//!   1. Pre-installed on PATH (user-managed)
//!   2. Bundled as a Tauri "externalBin" sidecar (placed in src-tauri/binaries/
//!      with target-triple suffix and declared in tauri.conf.json)
//!   3. Installed on first run by [`ensure_installed`] (downloads a release)
//!
//! We try (2) first (sidecar), then (1) (PATH). (3) is exposed as an explicit
//! "ensure" command the frontend can call from the Settings page.

use std::path::PathBuf;
use std::process::Command;
use tauri::AppHandle;
use tauri_plugin_shell::process::{Command as ShellCommand, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Return the OS name & arch in the format ipatool's release assets use.
pub fn target_triple() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    { "darwin-arm64" }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    { "darwin-amd64" }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    { "linux-amd64" }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    { "windows-amd64" }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64")
    )))]
    { "unknown" }
}

/// Decide where ipatool lives. Priority:
///   1. PATH (`which ipatool`) — useful for devs running from source.
///   2. Bundled sidecar (configured in tauri.conf.json `externalBin`).
///   3. Runtime-downloaded copy in app local data dir.
pub fn resolve_binary(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(p) = which::which("ipatool") {
        return Ok(p);
    }
    // Sidecar construction succeeds whenever externalBin is configured, but
    // the binary may not exist at runtime in dev mode. We still return a
    // marker — the actual presence check happens at spawn time.
    if app.shell().sidecar("ipatool").is_ok() {
        return Ok(PathBuf::from("__sidecar__"));
    }
    let local = crate::sidecar::bin_path(app);
    if local.exists() {
        return Ok(local);
    }
    Err("ipatool not found. Install it or click 'Install ipatool' in Settings.".into())
}

/// Spawn ipatool, choosing PATH → sidecar → runtime-download in that order.
pub fn spawn(app: &AppHandle, args: &[&str]) -> Result<ShellCommand, String> {
    if let Ok(_) = which::which("ipatool") {
        let mut cmd = app.shell().command("ipatool");
        for a in args {
            cmd = cmd.args([*a]);
        }
        return Ok(cmd);
    }
    if app.shell().sidecar("ipatool").is_ok() {
        let mut cmd = app.shell().sidecar("ipatool").map_err(|e| e.to_string())?;
        for a in args {
            cmd = cmd.args([*a]);
        }
        return Ok(cmd);
    }
    let local = crate::sidecar::bin_path(app);
    if local.exists() {
        let mut cmd = app.shell().command(local.to_string_lossy().to_string());
        for a in args {
            cmd = cmd.args([*a]);
        }
        return Ok(cmd);
    }
    Err("ipatool not found. Install it from the Settings page.".into())
}

/// Run ipatool in JSON mode and capture the full stdout as a `serde_json::Value`.
/// Use this for one-shot commands like `search`, `auth account`, `list-downloaded`.
pub fn run_json(app: &AppHandle, args: &[&str]) -> Result<serde_json::Value, String> {
    let mut full_args: Vec<&str> = Vec::with_capacity(args.len() + 2);
    full_args.extend_from_slice(args);
    // ipatool >= 0.1.0 supports --output json; older versions print JSON to stdout
    // only when --non-interactive is set. We add both safely — unknown flags error,
    // so we sniff the version first.
    let has_json_flag = ipatool_supports_json_flag(app).unwrap_or(false);
    if has_json_flag {
        full_args.push("--output");
        full_args.push("json");
    }
    full_args.push("--non-interactive");

    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    let cmd = spawn(app, &full_args)?;
    let (mut rx_events, _child) = cmd.spawn().map_err(|e| e.to_string())?;
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

/// Best-effort JSON parse. ipatool prints JSON to stdout when --output json is
/// used; otherwise stdout may be plain text. We try json first, then return the
/// raw text wrapped in an object so the frontend can render it.
fn parse_json(out: &str) -> Result<serde_json::Value, String> {
    let trimmed = out.trim();
    if trimmed.is_empty() {
        return Ok(serde_json::Value::Null);
    }
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Ok(v);
    }
    // ipatool may emit interleaved log lines + JSON. Try to extract the last
    // JSON-looking chunk.
    if let Some(idx) = trimmed.rfind('{') {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&trimmed[idx..]) {
            return Ok(v);
        }
    }
    Ok(serde_json::json!({ "raw": trimmed }))
}

/// Quick version sniff to decide whether --output json is supported.
fn ipatool_supports_json_flag(app: &AppHandle) -> Result<bool, String> {
    let v = ipatool_version_string(app)?;
    // ipatool >= 0.1.0 supports --output. Parse Major.Minor.
    if let Some(stripped) = v.strip_prefix('v') {
        if let Ok(parsed) = semver::Version::parse(stripped) {
            return Ok(parsed.major > 0 || parsed.minor >= 1);
        }
    }
    Ok(true)
}

pub fn ipatool_version_string(app: &AppHandle) -> Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    let cmd = spawn(app, &["--version"])?;
    let (mut rx_events, _child) = cmd.spawn().map_err(|e| e.to_string())?;
    let tx2 = tx.clone();
    let mut buf = String::new();
    std::thread::spawn(move || {
        while let Some(ev) = rx_events.blocking_recv() {
            match ev {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    buf.push_str(&String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Error(err) => {
                    let _ = tx2.send(Err(err.to_string()));
                    return;
                }
                CommandEvent::Terminated(_) => {
                    let _ = tx2.send(Ok(buf.trim().to_string()));
                    return;
                }
                _ => {}
            }
        }
        let _ = tx.send(Ok(buf.trim().to_string()));
    });
    rx.recv().map_err(|e| e.to_string())?
}

/// Plain command without streaming — returns combined stdout as string.
pub fn run_plain(app: &AppHandle, args: &[&str]) -> Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    let cmd = spawn(app, args)?;
    let (mut rx_events, _child) = cmd.spawn().map_err(|e| e.to_string())?;
    let tx2 = tx.clone();
    let mut buf = String::new();
    std::thread::spawn(move || {
        while let Some(ev) = rx_events.blocking_recv() {
            match ev {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    buf.push_str(&String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Error(err) => {
                    let _ = tx2.send(Err(err.to_string()));
                    return;
                }
                CommandEvent::Terminated(p) => {
                    if p.code != Some(0) {
                        let _ = tx2.send(Err(buf.clone()));
                    } else {
                        let _ = tx2.send(Ok(buf.clone()));
                    }
                    return;
                }
                _ => {}
            }
        }
        let _ = tx.send(Ok(buf.clone()));
    });
    rx.recv().map_err(|e| e.to_string())?
}

/// Spawn a *raw* `std::process::Command` (used by ensure_installed to download
/// the sidecar binary). This bypasses the shell plugin so it works even when
/// ipatool is not yet on PATH / not yet declared as sidecar.
pub fn raw_command(args: &[&str]) -> Result<std::process::Output, String> {
    let mut cmd = Command::new("ipatool");
    cmd.args(args);
    cmd.output().map_err(|e| e.to_string())
}
