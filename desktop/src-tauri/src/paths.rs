//! App data roots for Pi App.

use std::fs;
use std::path::{Path, PathBuf};

use directories::ProjectDirs;

const DEFAULT_AGENT_INSTRUCTIONS: &str = r#"# Pi App

Keep Pi's core small. When the user asks to add a capability:

1. Inspect installed Pi packages and skills, then search https://pi.dev/packages for an existing focused solution.
2. Before installing anything, show the exact pinned source and version, what it can access, any provider cost, and how it fits the request.
3. Wait for explicit approval before running `pi install` or changing configuration.
4. If no suitable package exists, create and test the smallest local Pi extension or skill. Do not add optional capability directly to the app core.

Prefer real Pi CLI and RPC behavior. Never expose credentials or copy them into project files.
"#;

fn ensure_default_agent_instructions(agent_home: &Path) -> std::io::Result<()> {
    let target = agent_home.join("AGENTS.md");
    if target.exists() {
        return Ok(());
    }
    use std::io::Write;
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
    {
        Ok(mut file) => file.write_all(DEFAULT_AGENT_INSTRUCTIONS.as_bytes()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error),
    }
}

pub fn app_data_root() -> PathBuf {
    if let Ok(custom) = std::env::var("PI_APP_HOME").or_else(|_| std::env::var("PI_APP_HOME")) {
        return PathBuf::from(custom);
    }
    if let Some(proj) = ProjectDirs::from("dev", "pi", "pi-app") {
        return proj.data_dir().to_path_buf();
    }
    // Fallback
    dirs_fallback()
}

fn dirs_fallback() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join("pi-app");
        }
    }
    crate::process_util::user_home().join(".pi-app")
}

pub fn ensure_app_dirs() -> std::io::Result<PathBuf> {
    let root = app_data_root();
    std::fs::create_dir_all(root.join("projects"))?;
    std::fs::create_dir_all(root.join("sessions"))?;
    std::fs::create_dir_all(root.join("logs"))?;
    // Agent profile (config.toml / optional auth) when session_data_mode=independent.
    let agent_home = root.join("agent-home");
    std::fs::create_dir_all(&agent_home)?;
    ensure_default_agent_instructions(&agent_home)?;
    // Clipboard paste / picker-written attachment files.
    std::fs::create_dir_all(root.join("attachments").join("paste"))?;
    // Multi-account auth snapshots.
    std::fs::create_dir_all(root.join("accounts"))?;
    Ok(root)
}

/// Directory for pasted / saved composer attachments (absolute paths for `@path` refs).
pub fn attachments_paste_dir() -> PathBuf {
    let dir = app_data_root().join("attachments").join("paste");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// PI_AGENT_HOME for independent mode: App-owned agent profile (providers, config).
pub fn agent_home_dir() -> PathBuf {
    app_data_root().join("agent-home")
}

pub fn agent_config_toml() -> PathBuf {
    agent_home_dir().join("config.toml")
}

/// Resolve PI_AGENT_HOME for a spawned agent process.
pub fn resolve_agent_pi_home(session_data_mode: &str) -> PathBuf {
    if session_data_mode == "shared" {
        return crate::process_util::user_home().join(".pi");
    }
    let _ = ensure_app_dirs();
    agent_home_dir()
}

pub fn projects_file() -> PathBuf {
    app_data_root().join("projects.json")
}

pub fn sessions_index_file() -> PathBuf {
    app_data_root().join("sessions_index.json")
}

pub fn settings_file() -> PathBuf {
    app_data_root().join("settings.json")
}

/// Append-only measured usage rows, one JSON object per completed turn.
pub fn usage_ledger_file() -> PathBuf {
    app_data_root().join("usage-ledger.jsonl")
}

/// Local-only crash/error records. Never uploaded by the app.
pub fn crash_reports_file() -> PathBuf {
    app_data_root().join("crash-reports.jsonl")
}

/// Loopback endpoint and bearer token used by the optional external MCP bridge.
/// The file is short-lived and is replaced on every desktop start.
pub fn mcp_endpoint_file() -> PathBuf {
    app_data_root().join("mcp-endpoint.json")
}

/// Runtime revocation marker for the currently active local MCP token.
pub fn mcp_revocation_file() -> PathBuf {
    app_data_root().join("mcp-revoked.json")
}

/// Redacted, append-only audit trail for external MCP actions.
pub fn mcp_audit_file() -> PathBuf {
    app_data_root().join("mcp-audit.jsonl")
}

/// Durable request-id journal for external MCP task starts.
pub fn mcp_requests_file() -> PathBuf {
    app_data_root().join("mcp-requests.json")
}

/// On-disk secrets metadata (+ API-key fallback when OS keychain is unavailable).
/// Sensitive keys prefer the OS keychain; see [`crate::secrets`].
pub fn secrets_file() -> PathBuf {
    app_data_root().join("secrets.json")
}

pub fn session_dir(session_id: &str) -> PathBuf {
    app_data_root().join("sessions").join(session_id)
}

/// Host-side scheduled automations (shell list; execution via agent sessions).
pub fn automations_file() -> PathBuf {
    app_data_root().join("automations.json")
}

/// Append-only lifecycle ledger for scheduled automation runs.
pub fn automation_runs_file() -> PathBuf {
    app_data_root().join("automation-runs.jsonl")
}

/// Cross-process claim target used by the desktop scheduler and the optional
/// headless automation service. The id is reduced to a filename-safe token so
/// an automation can never influence the lock path.
pub fn automation_claim_file(automation_id: &str) -> PathBuf {
    let safe = automation_id
        .chars()
        .filter(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
        .take(96)
        .collect::<String>();
    let name = if safe.is_empty() { "unknown" } else { &safe };
    app_data_root()
        .join("logs")
        .join(format!("automation-{name}.claim"))
}

/// App MCP/Skills enable prefs (`extensions.json`).
pub fn extensions_file() -> PathBuf {
    app_data_root().join("extensions.json")
}

/// Versioned metadata index for requirements, designs, plans and generated outputs.
pub fn artifacts_v1_file() -> PathBuf {
    app_data_root().join("artifacts-v1.json")
}

/// Durable idempotency journal for host-side mutating operations.
pub fn operations_v1_file() -> PathBuf {
    app_data_root().join("operations-v1.json")
}

/// Git-backed before/after snapshots captured around agent turns.
pub fn checkpoints_v1_file() -> PathBuf {
    app_data_root().join("checkpoints-v1.json")
}

/// Digest-bound approvals for repository-owned MCP, skills and scripts.
pub fn repository_trust_v1_file() -> PathBuf {
    app_data_root().join("repository-trust-v1.json")
}

/// Percent-encode a path the way Pi CLI names session folders under
/// `PI_AGENT_HOME/sessions/` (encodeURIComponent of the absolute cwd).
pub fn percent_encode_path_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for &b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push(char::from(b"0123456789ABCDEF"[(b >> 4) as usize]));
                out.push(char::from(b"0123456789ABCDEF"[(b & 0xf) as usize]));
            }
        }
    }
    out
}

/// Locate the on-disk agent session directory for a given agent session id.
/// Layout: `{PI_AGENT_HOME}/sessions/{percent-encoded-cwd}/{agent_session_id}/`
///
/// `cwd_hint` (project path) avoids a directory scan when known.
pub fn find_agent_session_dir(
    agent_session_id: &str,
    cwd_hint: Option<&str>,
    session_data_mode: &str,
) -> Option<PathBuf> {
    if agent_session_id.is_empty() {
        return None;
    }
    // Pi RPC exposes the absolute JSONL session file as its durable session id.
    let pi_session = PathBuf::from(agent_session_id);
    if pi_session.is_file() {
        return pi_session.parent().map(Path::to_path_buf);
    }
    let home = resolve_agent_pi_home(session_data_mode);
    let sessions = home.join("sessions");
    if !sessions.is_dir() {
        return None;
    }

    if let Some(cwd) = cwd_hint.filter(|s| !s.is_empty()) {
        let encoded = percent_encode_path_component(cwd);
        let candidate = sessions.join(encoded).join(agent_session_id);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }

    // Fallback: scan cwd folders for this agent session id
    let Ok(entries) = fs::read_dir(&sessions) else {
        return None;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let candidate = path.join(agent_session_id);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    None
}

/// Join agent session root + relative path like `images/1.jpg`.
/// Rejects `..` segments. Returns None if the resolved file is missing.
pub fn resolve_session_relative_media(session_root: &Path, relative: &str) -> Option<PathBuf> {
    let rel = relative.trim().trim_start_matches("./");
    if rel.is_empty() {
        return None;
    }
    if Path::new(rel).is_absolute() {
        return None;
    }
    let mut clean = PathBuf::new();
    for comp in Path::new(rel).components() {
        use std::path::Component;
        match comp {
            Component::Normal(s) => clean.push(s),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return None;
            }
        }
    }
    if clean.as_os_str().is_empty() {
        return None;
    }
    let full = session_root.join(clean);
    if full.is_file() {
        Some(full)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_data_root_is_absolute_or_relative_path() {
        let p = app_data_root();
        assert!(!p.as_os_str().is_empty());
    }

    #[test]
    fn percent_encode_matches_encode_uri_component_style() {
        let cwd = "/Users/me/Downloads/5 天 course";
        let enc = percent_encode_path_component(cwd);
        assert!(enc.starts_with("%2FUsers%2Fme%2FDownloads%2F5%20"));
        assert!(enc.contains("%E5%A4%A9") || enc.contains("%"));
        assert!(!enc.contains('/'));
    }

    #[test]
    fn resolve_session_relative_rejects_parent() {
        let root = PathBuf::from("/tmp/session");
        assert!(resolve_session_relative_media(&root, "../etc/passwd").is_none());
        assert!(resolve_session_relative_media(&root, "/etc/passwd").is_none());
    }

    #[test]
    fn default_agent_instructions_never_overwrite_user_content() {
        let home =
            std::env::temp_dir().join(format!("pi-app-default-agents-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).unwrap();

        ensure_default_agent_instructions(&home).unwrap();
        let target = home.join("AGENTS.md");
        assert!(fs::read_to_string(&target)
            .unwrap()
            .contains("https://pi.dev/packages"));

        fs::write(&target, "my instructions").unwrap();
        ensure_default_agent_instructions(&home).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "my instructions");
        let _ = fs::remove_dir_all(&home);
    }
}
