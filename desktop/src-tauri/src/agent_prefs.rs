//! Sync App composer prefs into the agent process environment.
//!
//! Independent mode (`PI_AGENT_HOME` = app agent-home): write `[ui]` permission keys so
//! Pi CLI enforces dontAsk / acceptEdits / YOLO at the agent layer (not only Host).
//! Shared mode leaves `~/.pi/config.toml` alone — Host policy + spawn flags only.

use std::fs;
use std::path::PathBuf;

use crate::paths::{agent_config_toml, agent_home_dir, ensure_app_dirs, resolve_agent_pi_home};
use crate::permission::PermissionPolicy;

/// Map App policy → `[ui] permission_mode` values used by Pi CLI config.toml.
pub fn ui_permission_mode(policy: &str) -> &'static str {
    match PermissionPolicy::parse(policy) {
        PermissionPolicy::AcceptEdits => "acceptEdits",
        PermissionPolicy::DontAsk => "dontAsk",
        PermissionPolicy::AlwaysApprove => "always-approve",
        PermissionPolicy::AllowForSession
        | PermissionPolicy::AllowOnce
        | PermissionPolicy::Deny
        | PermissionPolicy::Ask => "default",
    }
}

/// Claude Code-compatible `defaultMode` for `.claude/settings.json`.
pub fn claude_default_mode(policy: &str) -> &'static str {
    match PermissionPolicy::parse(policy) {
        PermissionPolicy::AcceptEdits => "acceptEdits",
        PermissionPolicy::DontAsk => "dontAsk",
        PermissionPolicy::AlwaysApprove => "bypassPermissions",
        _ => "default",
    }
}

fn set_ui_bool(text: &str, key: &str, value: bool) -> String {
    set_table_key(text, "ui", key, &value.to_string(), false)
}

fn set_ui_string(text: &str, key: &str, value: &str) -> String {
    set_table_key(text, "ui", key, value, true)
}

/// Upsert `key = value` under `[table]` in a TOML-ish text file.
fn set_table_key(text: &str, table: &str, key: &str, value: &str, quoted: bool) -> String {
    let header = format!("[{table}]");
    let line_val = if quoted {
        format!("{key} = \"{value}\"")
    } else {
        format!("{key} = {value}")
    };
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
        if in_table && trimmed.starts_with(key) && trimmed.contains('=') {
            lines[i] = line_val;
            return lines.join("\n") + "\n";
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

/// Write permission prefs into App agent-home (independent PI_AGENT_HOME only).
pub fn sync_permission_to_agent_profile(
    session_data_mode: &str,
    permission_policy: &str,
) -> Result<(), String> {
    if session_data_mode == "shared" {
        // Never rewrite the user's personal ~/.pi/config.toml from the App.
        return Ok(());
    }
    let _ = ensure_app_dirs();
    let path = agent_config_toml();
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let mode = ui_permission_mode(permission_policy);
    let yolo = matches!(
        PermissionPolicy::parse(permission_policy),
        PermissionPolicy::AlwaysApprove
    );
    let mut next = set_ui_string(&existing, "permission_mode", mode);
    next = set_ui_bool(&next, "yolo", yolo);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, next).map_err(|e| e.to_string())?;

    // Belt-and-suspenders: Claude-compatible defaultMode (agent reads when present).
    let claude_dir = agent_home_dir().join(".claude");
    let _ = fs::create_dir_all(&claude_dir);
    let settings = serde_json::json!({
        "permissions": {
            "defaultMode": claude_default_mode(permission_policy)
        }
    });
    fs::write(
        claude_dir.join("settings.json"),
        serde_json::to_string_pretty(&settings).unwrap_or_else(|_| "{}".into()),
    )
    .map_err(|e| e.to_string())?;

    tracing::info!(
        "agent_prefs: synced permission_mode={mode} yolo={yolo} → {}",
        path.display()
    );
    Ok(())
}

/// Map product session mode → ACP `session/set_mode` modeId candidates (first wins).
pub fn product_mode_candidates(mode: &str) -> Vec<&'static str> {
    match mode.trim().to_ascii_lowercase().as_str() {
        "plan" => vec!["plan", "Plan"],
        "ask" => vec!["ask", "Ask"],
        // Agent / default coding mode
        _ => vec!["agent", "default", "code", "normal", "Agent"],
    }
}

/// PI_AGENT_HOME path for logging / tests.
#[allow(dead_code)]
pub fn agent_pi_home(session_data_mode: &str) -> PathBuf {
    resolve_agent_pi_home(session_data_mode)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_policies() {
        assert_eq!(ui_permission_mode("ask"), "default");
        assert_eq!(ui_permission_mode("accept_edits"), "acceptEdits");
        assert_eq!(ui_permission_mode("dont_ask"), "dontAsk");
        assert_eq!(ui_permission_mode("always_approve"), "always-approve");
        assert_eq!(claude_default_mode("always_approve"), "bypassPermissions");
    }

    #[test]
    fn upserts_ui_table() {
        let t = set_ui_string("", "permission_mode", "default");
        assert!(t.contains("[ui]"));
        assert!(t.contains("permission_mode = \"default\""));
        let t2 = set_ui_bool(&t, "yolo", false);
        assert!(t2.contains("yolo = false"));
        let t3 = set_ui_string(&t2, "permission_mode", "dontAsk");
        assert!(t3.contains("permission_mode = \"dontAsk\""));
        assert_eq!(t3.matches("permission_mode").count(), 1);
    }
}
