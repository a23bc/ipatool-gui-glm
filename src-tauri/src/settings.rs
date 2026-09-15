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
    /// Auto-generated keychain passphrase for ipatool. ipatool v2.6.0+
    /// requires `--keychain-passphrase` whenever `--non-interactive` is
    /// used (it can't prompt the user for one in this mode). We generate
    /// a 32-byte random passphrase on first launch and reuse it forever
    /// so the user's saved keychain stays decryptable across runs. If this
    /// field is empty, we'll mint a new one and persist it on next save.
    #[serde(default)]
    pub keychain_passphrase: String,
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
            keychain_passphrase: String::new(),
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
            Ok(s) => {
                let mut s: Settings = serde_json::from_str(&s).unwrap_or_default();
                // If no passphrase yet (first launch after this upgrade),
                // mint one now and persist immediately so all subsequent
                // ipatool invocations have it.
                if s.keychain_passphrase.is_empty() {
                    s.keychain_passphrase = generate_passphrase();
                    let _ = s.save(app);
                }
                s
            }
            Err(_) => {
                let mut s = Settings::default();
                s.keychain_passphrase = generate_passphrase();
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

/// Generate a 32-byte random hex-encoded passphrase.
///
/// On Unix we read directly from /dev/urandom (kernel CSPRNG). On Windows
/// and other platforms we don't have a stable stdlib CSPRNG without pulling
/// in the `rand` crate, so we seed an xorshift64* with a mix of high-
/// resolution timestamps and the process id. The result is NOT
/// cryptographically secure, but it's good enough for our purpose: an
/// attacker who already has filesystem access to read settings.json can
/// trivially read the keychain file itself too, so the passphrase only
/// defends against casual file snooping, not a determined attacker.
fn generate_passphrase() -> String {
    let mut bytes = [0u8; 32];

    #[cfg(unix)]
    {
        use std::io::Read;
        let mut f = std::fs::File::open("/dev/urandom").expect("open /dev/urandom");
        f.read_exact(&mut bytes).expect("read urandom");
    }

    #[cfg(not(unix))]
    {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::time::{SystemTime, UNIX_EPOCH};
        static COUNTER: AtomicU64 = AtomicU64::new(0);

        let t = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0xdead_beef_cafe_babe);
        let pid = std::process::id() as u64;
        let cnt = COUNTER.fetch_add(1, Ordering::Relaxed);

        // Mix 64 bits of entropy via a splitmix64 (D. Lemire's version of
        // Sebastiano Vigna's algorithm).
        let mut z = t ^ pid.rotate_left(13) ^ cnt.rotate_left(29);
        let mut state = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
        for b in bytes.iter_mut() {
            // xorshift64* — fast, portable, good distribution.
            state ^= state >> 12;
            state ^= state << 25;
            state ^= state >> 27;
            z = state.wrapping_mul(0x2545_F491_4F6C_DD1D);
            *b = (z & 0xff) as u8;
        }
    }

    hex::encode(bytes)
}
