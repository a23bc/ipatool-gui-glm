//! Settings persistence. Stored as a JSON file in the per-app config dir.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    /// Default download directory. Empty → use ipatool's default.
    #[serde(default)]
    pub download_dir: String,
    /// Apple ID region / country code, e.g. "us", "cn".
    #[serde(default = "default_country")]
    pub country: String,
    /// Last used email (convenience only).
    #[serde(default)]
    pub email: String,
    /// Whether to keep a copy in the app's data dir in addition to download_dir.
    #[serde(default = "default_true")]
    pub keep_history: bool,
    /// Whether to send a desktop notification when a download finishes.
    #[serde(default = "default_true")]
    pub notify_on_finish: bool,
    /// Theme override. Empty → follow system.
    #[serde(default)]
    pub theme: String,
}

fn default_country() -> String { "us".into() }
fn default_true() -> bool { true }

impl Default for Settings {
    fn default() -> Self {
        Self {
            download_dir: String::new(),
            country: default_country(),
            email: String::new(),
            keep_history: true,
            notify_on_finish: true,
            theme: String::new(),
        }
    }
}

impl Settings {
    fn path(app: &AppHandle) -> PathBuf {
        let dir = app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from("."));
        let _ = fs::create_dir_all(&dir);
        dir.join("settings.json")
    }

    pub fn load(app: &AppHandle) -> Self {
        let p = Self::path(app);
        match fs::read_to_string(&p) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
            Err(_) => {
                let s = Settings::default();
                let _ = s.save(app);
                s
            }
        }
    }

    pub fn save(&self, app: &AppHandle) -> Result<(), String> {
        let p = Self::path(app);
        let s = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(&p, s).map_err(|e| e.to_string())
    }
}
