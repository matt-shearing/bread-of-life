//! The XENEON Edge deck card's files (see src/lib/deckBridge.ts and scripts/bol-deck.py).
//!
//! The webview builds both documents; this only puts them in
//! `${XDG_STATE_HOME:-~/.local/state}/bread-of-life/`: `deck-source.json` first, then
//! `deck.json`, each written to a temporary file and renamed into place (mode 0600, in a
//! 0700 directory), so a reader never sees half a file. The paths are fixed here; the
//! webview cannot choose where to write.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// A source is a few weeks of verses plus memory due times: tens of KiB. Anything far
/// larger is a bug, refused rather than written.
const MAX_BYTES: usize = 1024 * 1024;

fn state_dir() -> PathBuf {
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/state")))
        .unwrap_or_else(std::env::temp_dir);
    base.join("bread-of-life")
}

fn atomic_write(dir: &Path, name: &str, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = dir.join(format!(".{name}.{}.tmp", std::process::id()));
    let result = (|| {
        let mut f = fs::File::create(&tmp)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            f.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, dir.join(name))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

fn check(name: &str, body: &str) -> Result<(), String> {
    if body.len() > MAX_BYTES {
        return Err(format!("{name} is {} bytes, over the {MAX_BYTES}-byte limit", body.len()));
    }
    serde_json::from_str::<serde_json::Value>(body)
        .map(|_| ())
        .map_err(|e| format!("{name} is not JSON: {e}"))
}

/// Write the deck card's source and its rendered view. Either may be empty to leave it as is.
#[tauri::command]
pub fn write_deck_snapshot(source: String, deck: String) -> Result<(), String> {
    if !source.is_empty() {
        check("deck-source.json", &source)?;
    }
    if !deck.is_empty() {
        check("deck.json", &deck)?;
    }
    let dir = state_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    if !source.is_empty() {
        atomic_write(&dir, "deck-source.json", source.as_bytes()).map_err(|e| format!("deck-source.json: {e}"))?;
    }
    if !deck.is_empty() {
        atomic_write(&dir, "deck.json", deck.as_bytes()).map_err(|e| format!("deck.json: {e}"))?;
    }
    Ok(())
}
