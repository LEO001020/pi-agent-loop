//! Install the official Pi coding-agent package.
//!
//! Pi is distributed through npm. The desktop app delegates installation to the
//! user's Node package manager and then probes the resulting executable instead
//! of maintaining a second binary download/update channel.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::cli_probe;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallProgress {
    pub phase: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_downloaded: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mirror: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallResult {
    pub ok: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub mirror_used: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum_verified: Option<bool>,
}

fn emit_progress(
    app: &AppHandle,
    phase: &str,
    message: &str,
    percent: f64,
    version: Option<String>,
) {
    let _ = app.emit(
        "setup://cli-install-progress",
        CliInstallProgress {
            phase: phase.into(),
            message: message.into(),
            percent: Some(percent),
            bytes_downloaded: None,
            total_bytes: None,
            mirror: Some("npm".into()),
            version,
            sha256: None,
        },
    );
}

/// Install the current Pi package globally, then locate the resulting binary.
pub async fn install_cli_latest(app: AppHandle) -> Result<CliInstallResult, String> {
    emit_progress(
        &app,
        "installing",
        "Installing the official Pi package…",
        10.0,
        None,
    );

    let mut cmd = tokio::process::Command::new(if cfg!(target_os = "windows") {
        "npm.cmd"
    } else {
        "npm"
    });
    cmd.args([
        "install",
        "--global",
        "@earendil-works/pi-coding-agent@latest",
    ]);
    crate::process_util::apply_no_window_tokio(&mut cmd);
    if let Some(path) = crate::process_util::enriched_path_env() {
        cmd.env("PATH", path);
    }
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Could not start npm: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!("npm install failed: {detail}"));
    }

    emit_progress(&app, "verifying", "Verifying Pi…", 90.0, None);
    let probe = cli_probe::probe_cli(None);
    if !probe.found {
        return Err(
            "Pi was installed, but its global npm bin directory is not on PATH. Set the Pi path manually in Settings."
                .into(),
        );
    }

    emit_progress(&app, "done", "Pi is ready", 100.0, probe.version.clone());
    Ok(CliInstallResult {
        ok: true,
        path: probe.path,
        version: probe.version,
        mirror_used: Some("npm".into()),
        message: "Pi installed".into(),
        sha256: None,
        checksum_verified: None,
    })
}

/// Copy-paste fallback shown when automatic installation cannot start.
pub fn install_commands() -> serde_json::Value {
    serde_json::json!({
        "primary": "npm install --global @earendil-works/pi-coding-agent@latest",
        "shell": if cfg!(target_os = "windows") { "powershell" } else { "bash" },
        "docsUrl": "https://pi.dev/docs/latest",
        "mirrors": [],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_uses_the_official_pi_package() {
        let commands = install_commands();
        assert_eq!(
            commands["primary"],
            "npm install --global @earendil-works/pi-coding-agent@latest"
        );
        assert_eq!(commands["docsUrl"], "https://pi.dev/docs/latest");
        assert_eq!(commands["mirrors"], serde_json::json!([]));
    }
}
