pub mod commands;
pub mod ipatool;
pub mod settings;
pub mod sidecar;

use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Where to write the diagnostic log. Lives in the user's temp directory
/// so it's always writable regardless of install location. The user can
/// find it at %TEMP%\ipatool-gui-startup.log (e.g.
/// C:\Users\<user>\AppData\Local\Temp\ipatool-gui-startup.log).
fn log_path() -> std::path::PathBuf {
    let mut p = std::env::temp_dir();
    p.push("ipatool-gui-startup.log");
    p
}

/// Append a single line to the startup log. Captures both diagnostic
/// breadcrumbs AND panic messages (which would otherwise be completely
/// silent on Windows due to `windows_subsystem = "windows"` — no stderr,
/// no Event Viewer entry, no dialog).
fn log_line(msg: &str) {
    let path = log_path();
    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let ts = timestamp();
        let _ = writeln!(f, "[{ts}] {msg}");
    }
}

/// Lightweight UTC timestamp without pulling in chrono.
fn timestamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86400) as i64;
    let secs_today = secs % 86400;
    let h = secs_today / 3600;
    let m = (secs_today % 3600) / 60;
    let s = secs_today % 60;
    let (y, mo, d) = days_to_ymd(days);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

/// Howard Hinnant's date algorithm — convert days since 1970-01-01 to Y/M/D.
fn days_to_ymd(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Install a panic hook that writes panic info to the startup log file.
fn install_panic_hook() {
    static INSTALLED: Mutex<bool> = Mutex::new(false);
    let mut guard = INSTALLED.lock().unwrap();
    if *guard {
        return;
    }
    *guard = true;
    drop(guard);

    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "<unknown>".to_string());
        let msg = info.to_string();
        let bt = std::backtrace::Backtrace::force_capture();
        log_line(&format!(
            "PANIC at {location}: {msg}\nBacktrace:\n{bt}"
        ));
        default_hook(info);
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_hook();

    // Truncate the previous log on each launch so we don't get an endlessly
    // growing file. (OpenOptions::truncate would do this, but we use append
    // mode in log_line for cheap writes — so reset explicitly here.)
    let _ = std::fs::write(log_path(), ""); // truncate

    log_line("=== ipatool-gui starting ===");
    log_line(&format!(
        "exe = {}",
        std::env::current_exe()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|e| format!("<current_exe failed: {e}>"))
    ));
    log_line(&format!(
        "cwd = {}",
        std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|e| format!("<current_dir failed: {e}>"))
    ));
    log_line(&format!("args = {:?}", std::env::args().collect::<Vec<_>>()));

    // Configure the log plugin to ALSO forward records to our log file.
    // (By default tauri_plugin_log writes to stderr, which is invisible
    // on Windows due to windows_subsystem = "windows".)
    let log_plugin = tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Info)
        .destination(|msg: &log::Record| {
            log_line(&format!("[{}] {}: {}", msg.target(), msg.level(), msg.args()));
        })
        .build();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(log_plugin)
        .setup(|app| {
            log_line("setup: entered");
            let s = settings::Settings::load(app.handle());
            log_line(&format!(
                "setup: settings loaded (country={}, download_dir='{}')",
                s.country, s.download_dir
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ipatool_path,
            commands::ipatool_version,
            commands::ipatool_ensure,
            commands::auth_login,
            commands::auth_account,
            commands::auth_logout,
            commands::auth_2fa,
            commands::search_app,
            commands::app_lookup,
            commands::download_start,
            commands::download_cancel,
            commands::list_downloaded,
            commands::open_path,
            commands::reveal_in_finder,
            commands::get_settings,
            commands::set_settings,
            commands::open_external,
        ]);

    log_line("calling Builder::run()");
    match builder.run(tauri::generate_context!()) {
        Ok(()) => log_line("Builder::run() returned Ok — app exited cleanly"),
        Err(e) => {
            log_line(&format!("Builder::run() returned Err: {e:?}"));
            // Surface the error in a dialog so the user sees something.
            let _ = show_error_dialog(&format!("{e:?}"));
        }
    }
}

/// On Windows, show a native message box. Falls back to console print on
/// other platforms.
fn show_error_dialog(msg: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::CString;
        use std::ptr;
        extern "system" {
            fn MessageBoxA(
                hWnd: *const u8,
                lpText: *const u8,
                lpCaption: *const u8,
                uType: u32,
            ) -> i32;
        }
        let text = CString::new(msg).map_err(|e| e.to_string())?;
        let caption = CString::new("ipatool-gui failed to start").map_err(|e| e.to_string())?;
        unsafe {
            MessageBoxA(ptr::null(), text.as_ptr() as *const u8, caption.as_ptr() as *const u8, 0x10);
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        eprintln!("ipatool-gui failed to start: {msg}");
        Ok(())
    }
}
