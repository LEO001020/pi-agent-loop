//! Cross-session memory (Pi CLI experimental) — spawn flags, env, config.
//!
//! CLI: `--experimental-memory` / `--no-memory`, `PI_MEMORY`, `[memory] enabled`,
//! `pi memory clear`.

use std::fs;
use std::path::Path;
use std::process::Command;

use crate::cli_probe;
use crate::paths::{agent_config_toml, ensure_app_dirs, resolve_agent_pi_home};
use crate::process_util;

/// Upsert `[memory] enabled = bool` in a TOML-ish text blob.
pub fn set_memory_enabled_in_toml(text: &str, enabled: bool) -> String {
    set_table_bool(text, "memory", "enabled", enabled)
}

fn set_table_bool(text: &str, table: &str, key: &str, value: bool) -> String {
    let header = format!("[{table}]");
    let line_val = format!("{key} = {value}");
    let mut lines: Vec<String> = text.lines().map(|s| s.to_string()).collect();
    let mut in_table = false;
    let mut table_start: Option<usize> = None;
    for i in 0..lines.len() {
        let trimmed = lines[i].trim().to_string();
        if trimmed.starts_with('[') {
            if trimmed == header {
                in_table = true;
                table_start = Some(i);
            } else if in_table {
                lines.insert(i, line_val);
                return lines.join("\n") + "\n";
            } else {
                in_table = false;
            }
            continue;
        }
        if in_table {
            let key_part = trimmed.split('=').next().map(str::trim).unwrap_or("");
            if key_part == key {
                lines[i] = line_val;
                return lines.join("\n") + "\n";
            }
        }
    }
    if let Some(start) = table_start {
        lines.insert(start + 1, line_val);
        return lines.join("\n") + "\n";
    }
    let block = format!("\n{header}\n{line_val}\n");
    let base = text.trim_end();
    if base.is_empty() {
        format!("{header}\n{line_val}\n")
    } else {
        format!("{base}{block}")
    }
}

/// Write `[memory] enabled` into App agent-home (independent PI_AGENT_HOME only).
pub fn sync_memory_to_agent_profile(
    session_data_mode: &str,
    experimental_memory: bool,
) -> Result<(), String> {
    if session_data_mode == "shared" {
        // Never rewrite the user's personal ~/.pi/config.toml from the App.
        return Ok(());
    }
    let _ = ensure_app_dirs();
    let path = agent_config_toml();
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let next = set_memory_enabled_in_toml(&existing, experimental_memory);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, next).map_err(|e| e.to_string())?;
    tracing::info!(
        "agent_memory: synced [memory] enabled={} → {}",
        experimental_memory,
        path.display()
    );
    Ok(())
}

/// Args for `pi memory clear` (workspace scope = product default).
pub fn memory_clear_cli_args(scope: &str) -> Vec<&'static str> {
    match scope.trim().to_ascii_lowercase().as_str() {
        "global" => vec!["memory", "clear", "-y", "--global"],
        "all" => vec!["memory", "clear", "-y", "--all"],
        _ => vec!["memory", "clear", "-y", "--workspace"],
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryClearResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub cwd: String,
}

/// Run `pi memory clear` scoped to `cwd` (project path when available).
pub fn clear_workspace_memory(
    cwd: Option<&Path>,
    session_data_mode: &str,
    manual_cli_path: Option<&str>,
    scope: &str,
) -> Result<MemoryClearResult, String> {
    let probe = cli_probe::probe_cli(manual_cli_path);
    let cli_path = probe
        .path
        .filter(|_| probe.found)
        .ok_or_else(|| "Pi CLI CLI not found".to_string())?;

    let work_dir = cwd
        .map(Path::to_path_buf)
        .filter(|p| p.is_dir())
        .unwrap_or_else(process_util::user_home);

    let pi_home = resolve_agent_pi_home(session_data_mode);
    let args = memory_clear_cli_args(scope);

    let mut cmd = Command::new(&cli_path);
    cmd.args(&args)
        .current_dir(&work_dir)
        .env("PI_AGENT_HOME", &pi_home);
    if let Some(path) = process_util::enriched_path_env() {
        cmd.env("PATH", path);
    }
    process_util::apply_no_window_std(&mut cmd);

    let output = cmd
        .output()
        .map_err(|e| format!("failed to run pi memory clear: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let ok = output.status.success();

    if !ok {
        let detail = if !stderr.is_empty() {
            stderr.clone()
        } else if !stdout.is_empty() {
            stdout.clone()
        } else {
            format!("exit {}", output.status)
        };
        return Err(format!("pi memory clear failed: {detail}"));
    }

    Ok(MemoryClearResult {
        ok: true,
        stdout,
        stderr,
        cwd: work_dir.display().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upserts_memory_table() {
        let t = set_memory_enabled_in_toml("", true);
        assert!(t.contains("[memory]"));
        assert!(t.contains("enabled = true"));
        let t2 = set_memory_enabled_in_toml(&t, false);
        assert!(t2.contains("enabled = false"));
        assert_eq!(t2.matches("enabled").count(), 1);

        let existing = "[ui]\nyolo = false\n\n[memory]\nenabled = true\n";
        let next = set_memory_enabled_in_toml(existing, false);
        assert!(next.contains("[memory]"));
        assert!(next.contains("enabled = false"));
        assert!(next.contains("[ui]"));
    }

    #[test]
    fn clear_args() {
        assert_eq!(
            memory_clear_cli_args("workspace"),
            vec!["memory", "clear", "-y", "--workspace"]
        );
        assert_eq!(
            memory_clear_cli_args("global"),
            vec!["memory", "clear", "-y", "--global"]
        );
        assert_eq!(
            memory_clear_cli_args("all"),
            vec!["memory", "clear", "-y", "--all"]
        );
        assert_eq!(
            memory_clear_cli_args(""),
            vec!["memory", "clear", "-y", "--workspace"]
        );
    }
}
