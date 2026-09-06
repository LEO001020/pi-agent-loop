//! Cross-platform process / path helpers (Windows GUI spawn, home dir, PATH).

use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;

/// User home directory.
///
/// - **Windows:** prefer `USERPROFILE` (matches PowerShell / install.ps1).  
///   Fall back to `HOME` only if USERPROFILE is missing (Git Bash sometimes sets HOME).
/// - **Unix/macOS:** `HOME`.
pub fn user_home() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(h) = std::env::var("USERPROFILE") {
            if !h.is_empty() {
                return PathBuf::from(h);
            }
        }
        if let Ok(h) = std::env::var("HOME") {
            if !h.is_empty() {
                return PathBuf::from(h);
            }
        }
        return PathBuf::from(".");
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(h) = std::env::var("HOME") {
            if !h.is_empty() {
                return PathBuf::from(h);
            }
        }
        // Rare fallback
        if let Ok(h) = std::env::var("USERPROFILE") {
            if !h.is_empty() {
                return PathBuf::from(h);
            }
        }
        PathBuf::from(".")
    }
}

/// PATH list separator for the current OS.
pub fn path_list_separator() -> char {
    #[cfg(target_os = "windows")]
    {
        ';'
    }
    #[cfg(not(target_os = "windows"))]
    {
        ':'
    }
}

/// Hide console window when spawning CLI tools from a GUI app (Windows).
pub fn apply_no_window_std(cmd: &mut StdCommand) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd;
}

/// Same as [`apply_no_window_std`] for `tokio::process::Command`.
pub fn apply_no_window_tokio(cmd: &mut tokio::process::Command) {
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x0800_0000);
    }
    let _ = cmd;
}

/// Whether a path looks runnable as a CLI binary on this OS.
///
/// Follows symlinks (`is_file` / metadata). On Windows accepts `.exe`/`.cmd`/`.bat`/`.com`
/// and extension-less files (MSYS installs). On Unix requires any execute bit.
pub fn looks_runnable(path: &Path) -> bool {
    // `is_file` follows symlinks; also accept symlink-to-file that metadata sees as file.
    if !path.is_file() {
        // Windows: broken symlink or reparse point still listed — try metadata
        if path.symlink_metadata().is_err() {
            return false;
        }
        // Symlink that does not resolve: not runnable
        if !std::fs::metadata(path)
            .map(|m| m.is_file())
            .unwrap_or(false)
        {
            return false;
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            return meta.permissions().mode() & 0o111 != 0;
        }
        false
    }
    #[cfg(not(unix))]
    {
        // Windows: .exe / .cmd / .bat / no extension (some installers / shims).
        match path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase())
            .as_deref()
        {
            Some("exe") | Some("cmd") | Some("bat") | Some("com") => true,
            None => true,
            Some(_) => false,
        }
    }
}

/// Directories a Node version manager may hold the global npm bin in.
///
/// The app installs Pi with `npm install --global`, so the binary lands in
/// npm's global prefix — which nvm, fnm, volta, hermes and friends each move
/// somewhere different. Hard-coding `~/.local/bin` finds none of them.
///
/// Split out from [`enriched_path_env`] so it can be unit-tested without a
/// real npm on PATH.
pub fn node_manager_bin_dirs(home: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![
        home.join(".volta/bin"),
        home.join(".bun/bin"),
        home.join(".npm-global/bin"),
        home.join(".npm-packages/bin"),
        home.join("Library/pnpm"),
        home.join(".local/share/pnpm"),
    ];
    // Version managers keep one bin dir per installed runtime; include each so
    // a probe still works when the user has several.
    for base in [home.join(".nvm/versions/node"), home.join(".hermes")] {
        if let Ok(entries) = std::fs::read_dir(&base) {
            for e in entries.flatten() {
                let bin = e.path().join("bin");
                if bin.is_dir() {
                    dirs.push(bin);
                }
            }
        }
    }
    dirs
}

/// Ask npm where its global prefix is; `<prefix>/bin` holds globally installed
/// binaries. Authoritative for anything the app installed itself.
///
/// Returns `None` when npm is absent or slow to answer — callers fall back to
/// the static directory list.
pub fn npm_global_bin_dir() -> Option<PathBuf> {
    let out = std::process::Command::new("npm")
        .arg("prefix")
        .arg("-g")
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let prefix = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if prefix.is_empty() {
        return None;
    }
    let bin = PathBuf::from(prefix).join("bin");
    bin.is_dir().then_some(bin)
}

/// Build PATH suitable for GUI-spawned agent processes.
pub fn enriched_path_env() -> Option<String> {
    let sep = path_list_separator();
    let mut parts: Vec<String> = Vec::new();
    let push = |parts: &mut Vec<String>, p: &str| {
        if p.is_empty() {
            return;
        }
        if !parts.iter().any(|x| x == p) {
            parts.push(p.to_string());
        }
    };

    if let Ok(cur) = std::env::var("PATH") {
        for p in cur.split(sep) {
            push(&mut parts, p);
        }
    }

    let home = user_home();
    let home_s = home.to_string_lossy();
    #[cfg(target_os = "windows")]
    {
        push(&mut parts, &format!(r"{home_s}\.pi\bin"));
        push(&mut parts, &format!(r"{home_s}\.local\bin"));
        push(&mut parts, &format!(r"{home_s}\.cargo\bin"));
        push(&mut parts, &format!(r"{home_s}\AppData\Local\pnpm"));
        push(&mut parts, &format!(r"{home_s}\AppData\Roaming\npm"));
        // Same reasoning as POSIX: ask npm, then cover version managers.
        if let Some(bin) = npm_global_bin_dir() {
            push(&mut parts, &bin.to_string_lossy());
        }
        for dir in node_manager_bin_dirs(&home) {
            push(&mut parts, &dir.to_string_lossy());
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            push(&mut parts, &format!(r"{local}\Programs"));
            push(&mut parts, &format!(r"{local}\Microsoft\WinGet\Links"));
        }
        push(&mut parts, r"C:\Program Files\nodejs");
        push(&mut parts, r"C:\Program Files\Git\cmd");
        push(&mut parts, r"C:\Program Files\Git\bin");
    }
    #[cfg(not(target_os = "windows"))]
    {
        push(&mut parts, &format!("{home_s}/.pi/bin"));
        push(&mut parts, &format!("{home_s}/.local/bin"));
        push(&mut parts, &format!("{home_s}/.cargo/bin"));
        // npm's own answer first: the app installs Pi with `npm install -g`,
        // so this is where its binary actually is under any Node manager.
        if let Some(bin) = npm_global_bin_dir() {
            push(&mut parts, &bin.to_string_lossy());
        }
        for dir in node_manager_bin_dirs(&home) {
            push(&mut parts, &dir.to_string_lossy());
        }
        push(&mut parts, "/opt/homebrew/bin");
        push(&mut parts, "/usr/local/bin");
        push(&mut parts, "/usr/bin");
        push(&mut parts, "/bin");
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(&sep.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_home_nonempty() {
        assert!(!user_home().as_os_str().is_empty());
    }

    #[test]
    fn node_manager_dirs_cover_the_common_installers() {
        let home = PathBuf::from("/home/u");
        let dirs = node_manager_bin_dirs(&home);
        for expected in [
            "/home/u/.volta/bin",
            "/home/u/.bun/bin",
            "/home/u/.npm-global/bin",
            "/home/u/Library/pnpm",
        ] {
            assert!(
                dirs.iter().any(|d| d == &PathBuf::from(expected)),
                "missing {expected}"
            );
        }
    }

    /// A home with no version manager installed must not invent directories.
    #[test]
    fn node_manager_dirs_skip_absent_version_managers() {
        let dirs = node_manager_bin_dirs(&PathBuf::from("/nonexistent-home"));
        assert!(dirs.iter().all(|d| !d.to_string_lossy().contains(".nvm")));
        assert!(dirs
            .iter()
            .all(|d| !d.to_string_lossy().contains(".hermes")));
    }

    /// Regression: Pi installed through a Node version manager was invisible to
    /// the probe, so setup kept offering "Install Pi" to users who had it.
    #[test]
    fn enriched_path_includes_the_npm_global_bin_when_npm_exists() {
        let Some(bin) = npm_global_bin_dir() else {
            eprintln!("skip: no npm on PATH");
            return;
        };
        let path = enriched_path_env().expect("enriched path");
        assert!(
            path.split(path_list_separator())
                .any(|p| Path::new(p) == bin.as_path()),
            "enriched PATH is missing npm global bin {}",
            bin.display()
        );
    }

    /// The GUI PATH is sparse enough that `npm` itself is unreachable, so the
    /// static scan — not `npm prefix -g` — has to be what finds the binary.
    #[test]
    fn static_scan_finds_the_real_pi_without_npm() {
        let home = user_home();
        let dirs = node_manager_bin_dirs(&home);
        let found = dirs.iter().any(|d| looks_runnable(&d.join("pi")));
        if !found {
            eprintln!("skip: no version-manager pi in {}", home.display());
            return;
        }
        assert!(found, "static scan must locate pi without consulting npm");
    }

    #[test]
    fn enriched_path_has_separator() {
        if let Some(p) = enriched_path_env() {
            assert!(!p.is_empty());
            #[cfg(target_os = "windows")]
            assert!(p.contains(';') || !p.contains(':'));
        }
    }
}
