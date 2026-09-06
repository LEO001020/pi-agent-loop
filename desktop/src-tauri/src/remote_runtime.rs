use futures_util::SinkExt;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

use crate::store::RemoteRuntimeSettings;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRuntimeProbe {
    pub ok: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

const REMOTE_TOKEN_SERVICE: &str = "dev.pi.app.remote-rpc";
const REMOTE_TOKEN_ACCOUNT: &str = "bearer-token";
const DIRECT_CONNECT_TIMEOUT: Duration = Duration::from_secs(12);
const DIRECT_CONNECT_RETRIES: usize = 3;

fn safe_account_part(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':'))
}

pub fn validate(settings: &RemoteRuntimeSettings) -> Result<(), String> {
    if settings.transport == "direct" {
        return validate_direct(settings);
    }
    if !safe_account_part(settings.host.trim()) {
        return Err("REMOTE_HOST_INVALID".into());
    }
    if !safe_account_part(settings.user.trim()) {
        return Err("REMOTE_USER_INVALID".into());
    }
    if settings.port == 0 {
        return Err("REMOTE_PORT_INVALID".into());
    }
    for value in [&settings.pi_path, &settings.cwd, &settings.identity_file] {
        if value.contains(['\n', '\r', '\0']) {
            return Err("REMOTE_VALUE_INVALID".into());
        }
    }
    if settings.pi_path.trim().is_empty() || settings.cwd.trim().is_empty() {
        return Err("REMOTE_VALUE_INVALID".into());
    }
    Ok(())
}

pub fn validate_direct(settings: &RemoteRuntimeSettings) -> Result<(), String> {
    if settings.cwd.trim().is_empty() || settings.cwd.contains(['\n', '\r', '\0']) {
        return Err("REMOTE_VALUE_INVALID".into());
    }
    let url = url::Url::parse(settings.direct_url.trim()).map_err(|_| "REMOTE_URL_INVALID")?;
    if url.scheme() != "wss" {
        return Err("REMOTE_TLS_REQUIRED".into());
    }
    if url.host_str().is_none() || url.username() != "" || url.password().is_some() {
        return Err("REMOTE_URL_INVALID".into());
    }
    Ok(())
}

pub fn remote_token() -> Result<String, String> {
    let entry = keyring::Entry::new(REMOTE_TOKEN_SERVICE, REMOTE_TOKEN_ACCOUNT)
        .map_err(|error| format!("REMOTE_KEYCHAIN_FAILED: {error}"))?;
    entry
        .get_password()
        .map_err(|error| format!("REMOTE_TOKEN_MISSING: {error}"))
}

fn save_remote_token(value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(REMOTE_TOKEN_SERVICE, REMOTE_TOKEN_ACCOUNT)
        .map_err(|error| format!("REMOTE_KEYCHAIN_FAILED: {error}"))?;
    if value.trim().is_empty() {
        return entry
            .delete_credential()
            .map_err(|error| format!("REMOTE_KEYCHAIN_FAILED: {error}"));
    }
    entry
        .set_password(value.trim())
        .map_err(|error| format!("REMOTE_KEYCHAIN_FAILED: {error}"))
}

pub async fn connect_websocket(
    settings: &RemoteRuntimeSettings,
    token: &str,
) -> Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    String,
> {
    validate_direct(settings)?;
    if token.trim().is_empty() {
        return Err("REMOTE_TOKEN_MISSING".into());
    }
    let bearer = HeaderValue::from_str(&format!("Bearer {}", token.trim()))
        .map_err(|_| "REMOTE_TOKEN_INVALID")?;
    let mut last_error = String::from("REMOTE_CONNECT_FAILED");
    for attempt in 0..DIRECT_CONNECT_RETRIES {
        let mut request = settings
            .direct_url
            .trim()
            .into_client_request()
            .map_err(|error| format!("REMOTE_URL_INVALID: {error}"))?;
        request
            .headers_mut()
            .insert("Authorization", bearer.clone());
        match tokio::time::timeout(
            DIRECT_CONNECT_TIMEOUT,
            tokio_tungstenite::connect_async(request),
        )
        .await
        {
            Ok(Ok((socket, _))) => return Ok(socket),
            Ok(Err(error)) => last_error = format!("REMOTE_CONNECT_FAILED: {error}"),
            Err(_) => last_error = "REMOTE_CONNECT_TIMEOUT".into(),
        }
        if attempt + 1 < DIRECT_CONNECT_RETRIES {
            tokio::time::sleep(Duration::from_millis(250 * (attempt as u64 + 1))).await;
        }
    }
    Err(last_error)
}

pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

pub fn remote_path(value: &str) -> String {
    if value == "~" {
        return "\"$HOME\"".into();
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return format!("\"$HOME\"/{}", shell_quote(rest));
    }
    shell_quote(value)
}

pub fn ssh_executable() -> Option<PathBuf> {
    which::which("ssh").ok().or({
        #[cfg(target_os = "windows")]
        {
            let root = std::env::var_os("WINDIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
            let candidate = root.join("System32").join("OpenSSH").join("ssh.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        None
    })
}

pub fn configure_ssh_command(
    command: &mut Command,
    settings: &RemoteRuntimeSettings,
    remote_command: &str,
) -> Result<(), String> {
    validate(settings)?;
    command.args([
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "ConnectTimeout=12",
    ]);
    command.arg("-p").arg(settings.port.to_string());
    let identity = settings.identity_file.trim();
    if !identity.is_empty() {
        let expanded = crate::cli_probe::expand_user_path(identity);
        if !Path::new(&expanded).is_file() {
            return Err("REMOTE_IDENTITY_NOT_FOUND".into());
        }
        command.arg("-i").arg(expanded);
    }
    command
        .arg(format!("{}@{}", settings.user.trim(), settings.host.trim()))
        .arg("--")
        .arg(remote_command);
    Ok(())
}

pub fn pi_rpc_command(settings: &RemoteRuntimeSettings, extra_args: &[String]) -> String {
    let mut parts = [
        format!("cd {}", remote_path(settings.cwd.trim())),
        format!(
            "exec {} --mode rpc --approve",
            shell_quote(settings.pi_path.trim())
        ),
    ];
    if !extra_args.is_empty() {
        parts[1].push(' ');
        parts[1].push_str(
            &extra_args
                .iter()
                .map(|value| shell_quote(value))
                .collect::<Vec<_>>()
                .join(" "),
        );
    }
    parts.join(" && ")
}

#[tauri::command]
pub async fn remote_runtime_test(
    settings: RemoteRuntimeSettings,
) -> Result<RemoteRuntimeProbe, String> {
    validate(&settings)?;
    let ssh = ssh_executable().ok_or("REMOTE_SSH_MISSING")?;
    let check = format!(
        "cd {} && {} --version",
        remote_path(settings.cwd.trim()),
        shell_quote(settings.pi_path.trim())
    );
    let mut command = Command::new(ssh);
    configure_ssh_command(&mut command, &settings, &check)?;
    command.kill_on_drop(true);
    crate::process_util::apply_no_window_tokio(&mut command);
    let output = command
        .output()
        .await
        .map_err(|error| format!("REMOTE_CONNECT_FAILED: {error}"))?;
    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok(RemoteRuntimeProbe {
            ok: true,
            version: (!version.is_empty()).then_some(version),
            error: None,
        });
    }
    let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok(RemoteRuntimeProbe {
        ok: false,
        version: None,
        error: Some(if error.is_empty() {
            "REMOTE_CONNECT_FAILED".into()
        } else {
            error
        }),
    })
}

#[tauri::command]
pub async fn remote_direct_test(
    settings: RemoteRuntimeSettings,
    token: String,
) -> Result<RemoteRuntimeProbe, String> {
    let effective_token = if token.trim().is_empty() {
        remote_token()?
    } else {
        token
    };
    let mut socket = connect_websocket(&settings, &effective_token).await?;
    let _ = socket.send(Message::Ping(Vec::new().into())).await;
    let _ = socket.close(None).await;
    Ok(RemoteRuntimeProbe {
        ok: true,
        version: Some("Pi Direct RPC".into()),
        error: None,
    })
}

#[tauri::command]
pub async fn remote_runtime_token_set(token: String) -> Result<(), String> {
    save_remote_token(&token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_posix_values_without_command_injection() {
        assert_eq!(shell_quote("/work/pi app"), "'/work/pi app'");
        assert_eq!(shell_quote("a'b"), "'a'\"'\"'b'");
        assert_eq!(remote_path("~"), "\"$HOME\"");
        assert_eq!(remote_path("~/work tree"), "\"$HOME\"/'work tree'");
    }

    #[test]
    fn rejects_option_and_control_character_injection() {
        let mut settings = RemoteRuntimeSettings {
            host: "-oProxyCommand=bad".into(),
            user: "dev".into(),
            ..Default::default()
        };
        assert!(validate(&settings).is_err());
        settings.host = "server.example".into();
        settings.cwd = "/work\nbad".into();
        assert!(validate(&settings).is_err());
    }

    #[test]
    fn direct_rpc_requires_wss_without_embedded_credentials() {
        let mut settings = RemoteRuntimeSettings {
            transport: "direct".into(),
            direct_url: "ws://server.example/rpc".into(),
            ..Default::default()
        };
        assert_eq!(
            validate_direct(&settings),
            Err("REMOTE_TLS_REQUIRED".into())
        );
        settings.direct_url = "wss://user:pass@server.example/rpc".into();
        assert_eq!(validate_direct(&settings), Err("REMOTE_URL_INVALID".into()));
        settings.direct_url = "wss://server.example/rpc".into();
        assert!(validate_direct(&settings).is_ok());
        settings.cwd = "\n".into();
        assert_eq!(
            validate_direct(&settings),
            Err("REMOTE_VALUE_INVALID".into())
        );
    }
}
