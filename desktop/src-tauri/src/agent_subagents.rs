//! Subagent spawning — spawn flags, env, config.
//!
//! CLI: `--no-subagents`, `PI_SUBAGENTS`, `[subagents] enabled`.
//! Enabled by default; when App setting is off, force-disable at spawn.

use std::fs;

use crate::paths::{agent_config_toml, ensure_app_dirs};

/// Upsert `[subagents] enabled = bool` in a TOML-ish text blob.
pub fn set_subagents_enabled_in_toml(text: &str, enabled: bool) -> String {
    set_table_bool(text, "subagents", "enabled", enabled)
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

/// Write `[subagents] enabled` into App agent-home (independent PI_AGENT_HOME only).
pub fn sync_subagents_to_agent_profile(
    session_data_mode: &str,
    subagents_enabled: bool,
) -> Result<(), String> {
    if session_data_mode == "shared" {
        // Never rewrite the user's personal ~/.pi/config.toml from the App.
        return Ok(());
    }
    let _ = ensure_app_dirs();
    let path = agent_config_toml();
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let next = set_subagents_enabled_in_toml(&existing, subagents_enabled);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, next).map_err(|e| e.to_string())?;
    tracing::info!(
        "agent_subagents: synced [subagents] enabled={} → {}",
        subagents_enabled,
        path.display()
    );
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upserts_subagents_table() {
        let t = set_subagents_enabled_in_toml("", false);
        assert!(t.contains("[subagents]"));
        assert!(t.contains("enabled = false"));
        let t2 = set_subagents_enabled_in_toml(&t, true);
        assert!(t2.contains("enabled = true"));
        assert_eq!(t2.matches("enabled").count(), 1);

        let existing = "[ui]\nyolo = false\n\n[subagents]\nenabled = true\n";
        let next = set_subagents_enabled_in_toml(existing, false);
        assert!(next.contains("[subagents]"));
        assert!(next.contains("enabled = false"));
        assert!(next.contains("[ui]"));
    }
}
