pub mod commands;
pub mod ipatool;
pub mod settings;
pub mod sidecar;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            // Ensure settings dir + file exist on first launch.
            let _ = settings::Settings::load(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ipatool runtime
            commands::ipatool_path,
            commands::ipatool_version,
            commands::ipatool_ensure,
            // auth
            commands::auth_login,
            commands::auth_account,
            commands::auth_logout,
            commands::auth_2fa,
            // search
            commands::search_app,
            commands::app_lookup,
            // download
            commands::download_start,
            commands::download_cancel,
            // history / files
            commands::list_downloaded,
            commands::open_path,
            commands::reveal_in_finder,
            // settings
            commands::get_settings,
            commands::set_settings,
            // misc
            commands::open_external,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ipatool-gui");
}
