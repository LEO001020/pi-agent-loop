//! Pi CLI update checks and installation through its published npm package.

use std::path::Path;
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tracing::info;

use crate::cli_install::{self, CliInstallResult};
use crate::cli_probe;
use crate::process_util;

const CHECK_TIMEOUT: Duration = Duration::from_secs(45);
const PI_NPM_PACKAGE: &str = "@earendil-works/pi-coding-agent";

/// Stable update DTO consumed by the desktop UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CliUpdateCheck {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_update: Option<bool>,
    /// CLI-reported error string when present (null in healthy responses).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Resolved binary path used for the check (App-side, not from JSON).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_path: Option<String>,
}

fn versions_differ(a: &str, b: &str) -> bool {
    normalize_ver(a) != normalize_ver(b)
}

fn normalize_ver(s: &str) -> String {
    s.trim().trim_start_matches(['v', 'V']).to_ascii_lowercase()
}

/// Resolve the installed Pi CLI and compare it with the npm `latest` version.
pub fn check_cli_update(manual_path: Option<&str>) -> Result<CliUpdateCheck, String> {
    let probe = cli_probe::probe_cli(manual_path);
    let path = probe
        .path
        .filter(|_| probe.found)
        .ok_or_else(|| "Pi CLI not found. Install it or set its path under Runtime.".to_string())?;
    let current = probe
        .version
        .as_deref()
        .map(strip_pi_prefix)
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "unknown".into());
    let output = run_command_with_timeout(
        Path::new("npm"),
        &["view", PI_NPM_PACKAGE, "version", "--json"],
        CHECK_TIMEOUT,
    )?;
    let latest = serde_json::from_str::<String>(output.trim())
        .unwrap_or_else(|_| output.trim().trim_matches('"').to_string());
    if latest.is_empty() {
        return Err("npm returned no Pi version".into());
    }
    Ok(CliUpdateCheck {
        update_available: current != "unknown" && versions_differ(&current, &latest),
        current_version: current,
        latest_version: latest,
        channel: Some("latest".into()),
        installer: Some("npm-global".into()),
        auto_update: Some(false),
        error: None,
        cli_path: Some(path),
    })
}

fn strip_pi_prefix(v: &str) -> String {
    let t = v.trim();
    let lower = t.to_ascii_lowercase();
    for prefix in ["pi coding agent ", "pi "] {
        if lower.starts_with(prefix) {
            return t[prefix.len()..].trim().to_string();
        }
    }
    t.to_string()
}

/// Install the latest published Pi CLI with the same installer used by setup.
pub async fn install_cli_update(app: tauri::AppHandle) -> Result<CliInstallResult, String> {
    info!("cli_update_install: installing latest Pi package from npm");
    cli_install::install_cli_latest(app).await
}

fn run_command_with_timeout(
    bin: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let bin = bin.to_path_buf();
    let args_owned: Vec<String> = args.iter().map(|s| (*s).to_string()).collect();
    let args_label = args_owned.join(" ");
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut cmd = Command::new(&bin);
        cmd.args(&args_owned);
        process_util::apply_no_window_std(&mut cmd);
        if let Some(path_env) = process_util::enriched_path_env() {
            cmd.env("PATH", path_env);
        }
        let result = cmd.output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if !output.status.success() {
                let err = stderr.trim();
                let out = stdout.trim();
                // Some failures still emit JSON on stdout (e.g. network error payload).
                if out.starts_with('{') {
                    return Ok(stdout);
                }
                let msg = if !err.is_empty() {
                    err.chars().take(400).collect()
                } else if !out.is_empty() {
                    out.chars().take(400).collect()
                } else {
                    format!("command {args_label} exited with {}", output.status)
                };
                return Err(msg);
            }
            if stdout.trim().is_empty() && !stderr.trim().is_empty() {
                // Rare: JSON on stderr
                return Ok(stderr);
            }
            Ok(stdout)
        }
        Ok(Err(e)) => Err(format!("failed to run command {args_label}: {e}")),
        Err(_) => Err(format!(
            "command {args_label} timed out after {}s",
            timeout.as_secs()
        )),
    }
}
