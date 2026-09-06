//! Probe the Pi CLI on PATH and common package-manager locations.
//!
//! Cross-platform notes:
//! - macOS/Windows GUI apps often inherit a sparse PATH (Dock / Explorer), so we
//!   always scan common global package-manager dirs and an enriched PATH.
//! - Windows: `.exe` / `.cmd` / `.bat`, PATHEXT, `USERPROFILE`, WinGet/Scoop.
//! - macOS/Linux: npm, pnpm, bun, Homebrew and `~/.local/bin`.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::process_util::{self, user_home};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProbeResult {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub source: String,
    pub candidates_tried: Vec<String>,
    /// Pi auth material present at ~/.pi/agent/auth.json.
    pub cli_auth_present: bool,
}

pub fn cli_auth_json_present() -> bool {
    user_home()
        .join(".pi")
        .join("agent")
        .join("auth.json")
        .is_file()
}

/// Expand `~` / `%USERPROFILE%` / `%HOME%` so manual paths work on both OSes.
pub fn expand_user_path(raw: &str) -> PathBuf {
    let s = raw.trim();
    if s.is_empty() {
        return PathBuf::new();
    }

    // Unix-style home prefix
    if s == "~" {
        return user_home();
    }
    if let Some(rest) = s.strip_prefix("~/").or_else(|| s.strip_prefix("~\\")) {
        return user_home().join(rest);
    }

    // Windows-style env vars (common when pasting paths)
    let mut out = s.to_string();
    for (key, val) in [
        ("%USERPROFILE%", std::env::var("USERPROFILE").ok()),
        (
            "%HOME%",
            std::env::var("HOME")
                .ok()
                .or_else(|| std::env::var("USERPROFILE").ok()),
        ),
        ("%LOCALAPPDATA%", std::env::var("LOCALAPPDATA").ok()),
        ("%APPDATA%", std::env::var("APPDATA").ok()),
    ] {
        if let Some(v) = val {
            // case-insensitive replace for %VAR%
            let lower = out.to_ascii_lowercase();
            let key_l = key.to_ascii_lowercase();
            if let Some(idx) = lower.find(&key_l) {
                let mut next = String::new();
                next.push_str(&out[..idx]);
                next.push_str(&v);
                next.push_str(&out[idx + key.len()..]);
                out = next;
            }
        }
    }

    PathBuf::from(out)
}

/// Binary basenames to look for (Windows includes extension variants).
fn binary_names() -> &'static [&'static str] {
    #[cfg(target_os = "windows")]
    {
        &["pi.exe", "pi.cmd", "pi.bat", "pi"]
    }
    #[cfg(not(target_os = "windows"))]
    {
        &["pi"]
    }
}

fn push_unique(out: &mut Vec<PathBuf>, seen: &mut std::collections::HashSet<String>, p: PathBuf) {
    if p.as_os_str().is_empty() {
        return;
    }
    // Normalize for dedupe (Windows is case-insensitive)
    let key = {
        #[cfg(target_os = "windows")]
        {
            p.to_string_lossy().to_ascii_lowercase()
        }
        #[cfg(not(target_os = "windows"))]
        {
            p.to_string_lossy().to_string()
        }
    };
    if seen.insert(key) {
        out.push(p);
    }
}

fn push_bin_in_dir(
    out: &mut Vec<PathBuf>,
    seen: &mut std::collections::HashSet<String>,
    dir: PathBuf,
) {
    if dir.as_os_str().is_empty() {
        return;
    }
    for name in binary_names() {
        push_unique(out, seen, dir.join(name));
    }
}

/// Resolve `which` using the process PATH and, if needed, an enriched PATH
/// (GUI apps often miss `~/.pi/bin` / Homebrew / WinGet).
fn which_pi_variants() -> Vec<PathBuf> {
    let mut found = Vec::new();
    let names = binary_names();

    for name in names {
        if let Ok(p) = which::which(name) {
            found.push(p);
        }
    }

    // Search enriched PATH directories explicitly (does not mutate process env).
    if let Some(enriched) = process_util::enriched_path_env() {
        let sep = process_util::path_list_separator();
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        for name in names {
            if let Ok(p) = which::which_in(name, Some(&enriched), &cwd) {
                found.push(p);
            }
        }
        // Also brute-force join (covers dirs that exist but which_in misses).
        for dir in enriched.split(sep).filter(|d| !d.is_empty()) {
            for name in names {
                let p = PathBuf::from(dir).join(name);
                if p.is_file() {
                    found.push(p);
                }
            }
        }
    }

    found
}

fn candidate_paths(manual: Option<&str>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // 1) Manual path (settings / file picker) — highest priority
    if let Some(m) = manual {
        if !m.trim().is_empty() {
            let expanded = expand_user_path(m);
            push_unique(&mut out, &mut seen, expanded.clone());
            // Windows: user may omit .exe
            #[cfg(target_os = "windows")]
            {
                if expanded.extension().is_none() {
                    push_unique(&mut out, &mut seen, expanded.with_extension("exe"));
                }
            }
        }
    }

    // 2) Common global package-manager layouts.
    let home = user_home();
    #[cfg(target_os = "windows")]
    {
        push_bin_in_dir(&mut out, &mut seen, home.join(r".local\bin"));
        push_bin_in_dir(&mut out, &mut seen, home.join(r".bun\bin"));
        push_bin_in_dir(&mut out, &mut seen, home.join(r"AppData\Roaming\npm"));
        push_bin_in_dir(&mut out, &mut seen, home.join(r"AppData\Local\pnpm"));
        // Scoop shims
        push_bin_in_dir(&mut out, &mut seen, home.join(r"scoop\shims"));
        // WinGet / Local programs
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            push_bin_in_dir(&mut out, &mut seen, local.join(r"Microsoft\WinGet\Links"));
            push_bin_in_dir(&mut out, &mut seen, local.join(r"Programs\nodejs"));
        }
        if let Ok(pf) = std::env::var("ProgramFiles") {
            push_bin_in_dir(&mut out, &mut seen, PathBuf::from(pf).join("nodejs"));
        }
        // Chocolatey
        push_bin_in_dir(
            &mut out,
            &mut seen,
            PathBuf::from(r"C:\ProgramData\chocolatey\bin"),
        );
    }
    #[cfg(not(target_os = "windows"))]
    {
        push_bin_in_dir(&mut out, &mut seen, home.join(".local/bin"));
        push_bin_in_dir(&mut out, &mut seen, home.join(".bun/bin"));
        push_bin_in_dir(&mut out, &mut seen, home.join(".npm-global/bin"));
        push_bin_in_dir(&mut out, &mut seen, home.join(".local/share/pnpm"));
        push_bin_in_dir(&mut out, &mut seen, PathBuf::from("/opt/homebrew/bin"));
        push_bin_in_dir(&mut out, &mut seen, PathBuf::from("/usr/local/bin"));
        push_bin_in_dir(&mut out, &mut seen, PathBuf::from("/usr/bin"));
    }

    // 3) PATH / which (process + enriched)
    for p in which_pi_variants() {
        push_unique(&mut out, &mut seen, p);
    }

    out
}

fn is_executable(path: &Path) -> bool {
    process_util::looks_runnable(path)
}

fn read_version(path: &Path) -> Option<String> {
    let mut cmd = Command::new(path);
    cmd.arg("--version");
    process_util::apply_no_window_std(&mut cmd);
    // GUI-spawned probes: give the child the same enriched PATH used for agents
    // so sibling tools / DLL lookup behave like a real shell session.
    if let Some(path_env) = process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }
    let out = cmd.output().ok()?;
    if !out.status.success() {
        // Some builds print version on stderr
        let err = String::from_utf8_lossy(&out.stderr);
        let line = err.lines().next()?.trim().to_string();
        if !line.is_empty() {
            return Some(line);
        }
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    let line = s.lines().next()?.trim().to_string();
    if line.is_empty() {
        None
    } else {
        Some(line)
    }
}

fn classify_source(path: &Path, manual_first: bool) -> String {
    if manual_first {
        return "manual".into();
    }
    let s = path.to_string_lossy();
    let lower = s.to_ascii_lowercase();
    if lower.contains(".pi") || lower.contains("npm") || lower.contains("pnpm") {
        "common_path".into()
    } else {
        "path".into()
    }
}

pub fn probe_cli(manual_path: Option<&str>) -> CliProbeResult {
    let candidates = candidate_paths(manual_path);
    let tried: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
    let cli_auth_present = cli_auth_json_present();
    let manual_set = manual_path.map(|m| !m.trim().is_empty()).unwrap_or(false);

    // Prefer a candidate that both looks runnable AND answers --version.
    let mut fallback: Option<(PathBuf, String)> = None;

    for (i, path) in candidates.iter().enumerate() {
        if !is_executable(path) {
            continue;
        }
        let source = classify_source(path, manual_set && i == 0);
        if let Some(version) = read_version(path) {
            return CliProbeResult {
                found: true,
                path: Some(path.display().to_string()),
                version: Some(version),
                source,
                candidates_tried: tried,
                cli_auth_present,
            };
        }
        if fallback.is_none() {
            fallback = Some((path.clone(), source));
        }
    }

    // Runnable file that failed --version still counts as "found" so the user
    // can try connecting; UI can show missing version.
    if let Some((path, source)) = fallback {
        return CliProbeResult {
            found: true,
            path: Some(path.display().to_string()),
            version: None,
            source,
            candidates_tried: tried,
            cli_auth_present,
        };
    }

    CliProbeResult {
        found: false,
        path: None,
        version: None,
        source: "not_found".into(),
        candidates_tried: tried,
        cli_auth_present,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression: an installed Pi must be found wherever npm put it.
    ///
    /// The setup gate turns `found == false` straight into the "Install Pi"
    /// screen, so a probe miss is indistinguishable from a missing install —
    /// which is exactly what happened when a Node version manager owned the
    /// global bin.
    #[test]
    fn probe_finds_pi_installed_under_a_node_manager() {
        let home = crate::process_util::user_home();
        let installed = crate::process_util::node_manager_bin_dirs(&home)
            .iter()
            .any(|d| crate::process_util::looks_runnable(&d.join("pi")));
        if !installed {
            eprintln!("skip: no version-manager pi on this machine");
            return;
        }
        let r = probe_cli(None);
        assert!(
            r.found,
            "pi is installed under a Node manager but the probe missed it; tried: {:?}",
            r.candidates_tried
        );
    }

    #[test]
    fn probe_returns_structure() {
        let r = probe_cli(None);
        assert!(!r.candidates_tried.is_empty() || r.found);
        if r.found {
            assert!(r.path.is_some());
            assert!(r
                .version
                .as_ref()
                .map(|v| v.contains("pi") || !v.is_empty())
                .unwrap_or(true));
        }
    }

    #[test]
    fn probe_finds_local_pi_when_installed() {
        let r = probe_cli(None);
        // Soft if CI lacks Pi.
        let home = user_home();
        let likely_installed = which::which("pi").is_ok()
            || home.join(".local/bin/pi").exists()
            || home.join(r".local\bin\pi.exe").exists()
            || which::which("pi.exe").is_ok();
        if likely_installed {
            assert!(r.found, "expected local Pi, tried {:?}", r.candidates_tried);
            assert!(r.path.is_some());
        }
    }

    #[test]
    fn auth_path_uses_user_home() {
        // Just ensure we don't panic; presence is machine-dependent.
        let _ = cli_auth_json_present();
    }

    #[test]
    fn expand_user_path_tilde() {
        let p = expand_user_path("~/foo/bar");
        assert!(p.starts_with(user_home()));
        assert!(
            p.ends_with(Path::new("foo").join("bar"))
                || p.to_string_lossy().ends_with("foo/bar")
                || p.to_string_lossy().ends_with(r"foo\bar")
        );
    }

    #[test]
    fn expand_user_path_empty() {
        assert!(expand_user_path("  ").as_os_str().is_empty());
    }

    #[test]
    fn candidates_include_platform_defaults() {
        let c = candidate_paths(None);
        let joined = c
            .iter()
            .map(|p| p.to_string_lossy().to_ascii_lowercase())
            .collect::<Vec<_>>()
            .join("\n");
        // Pi is distributed through Node package managers, so candidates must
        // include at least one common user-level executable location.
        assert!(
            joined.contains("/pi")
                || joined.contains(r"\pi.exe")
                || joined.contains(".local")
                || joined.contains("pnpm")
                || joined.contains("npm"),
            "candidates missing Pi executable layouts: {c:?}"
        );
    }

    #[test]
    fn manual_path_is_first_candidate() {
        let fake = if cfg!(target_os = "windows") {
            r"C:\custom\pi.exe"
        } else {
            "/custom/pi"
        };
        let c = candidate_paths(Some(fake));
        assert!(!c.is_empty());
        assert_eq!(c[0], PathBuf::from(fake));
    }
}
