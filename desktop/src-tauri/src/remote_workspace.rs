//! Remote workspace primitives for the existing Files / Changes surfaces.
//!
//! Pi's ACP connection can be remote while the desktop process remains local.
//! This module gives the already-shipped resource pane the same bounded
//! operations over SSH, using the existing DTO shapes at the command boundary.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::json;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::remote_runtime;
use crate::store::RemoteRuntimeSettings;

const MAX_REMOTE_READ_BYTES: u64 = 40 * 1024 * 1024;
const MAX_REMOTE_TEXT_BYTES: usize = 2 * 1024 * 1024;
const REMOTE_COMMAND_TIMEOUT: Duration = Duration::from_secs(120);

struct RemoteOutput {
    stdout: String,
    stderr: String,
}

fn clean_detail(value: impl AsRef<str>) -> String {
    value
        .as_ref()
        .replace('\0', "")
        .trim()
        .chars()
        .take(500)
        .collect()
}

fn validate_workspace(settings: &RemoteRuntimeSettings) -> Result<(), String> {
    if !settings.enabled {
        return Err("REMOTE_WORKSPACE_DISABLED".into());
    }
    if settings.transport != "ssh" {
        return Err("REMOTE_WORKSPACE_DIRECT_UNSUPPORTED".into());
    }
    remote_runtime::validate(settings)
}

fn safe_relative(value: &str) -> Result<String, String> {
    let value = value.trim().replace('\\', "/");
    if value.is_empty() || value == "." {
        return Ok(String::new());
    }
    if value.starts_with('/') || value.contains(['\n', '\r', '\0']) {
        return Err("REMOTE_PATH_INVALID".into());
    }
    let mut parts = Vec::new();
    for part in value.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." || part.contains(['\n', '\r', '\0']) {
            return Err("REMOTE_PATH_ESCAPES_WORKSPACE".into());
        }
        parts.push(part);
    }
    Ok(parts.join("/"))
}

/// Accept either a repo-relative path or the workspace-qualified path emitted
/// by the remote status bridge. The latter is still lexical: it never resolves
/// through the local filesystem and cannot escape the configured remote root.
fn workspace_relative(project_path: &str, value: &str) -> Result<String, String> {
    let project = project_path.trim().trim_end_matches('/').replace('\\', "/");
    let candidate = value.trim().replace('\\', "/");
    if !project.is_empty()
        && (candidate == project || candidate.starts_with(&format!("{project}/")))
    {
        return safe_relative(candidate.strip_prefix(&format!("{project}/")).unwrap_or(""));
    }
    safe_relative(&candidate)
}

fn project_expr(settings: &RemoteRuntimeSettings, project_path: &str) -> Result<String, String> {
    validate_workspace(settings)?;
    let path = if project_path.trim().is_empty() {
        settings.cwd.trim()
    } else {
        project_path.trim()
    };
    if path.is_empty() || path.contains(['\n', '\r', '\0']) || path.starts_with('-') {
        return Err("REMOTE_PATH_INVALID".into());
    }
    Ok(remote_runtime::remote_path(path))
}

fn script_for_project(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    script: &str,
) -> Result<String, String> {
    Ok(format!(
        "cd {} && {}",
        project_expr(settings, project_path)?,
        script
    ))
}

async fn run_remote(
    settings: &RemoteRuntimeSettings,
    script: String,
    input: Option<Vec<u8>>,
) -> Result<RemoteOutput, String> {
    validate_workspace(settings)?;
    let ssh = remote_runtime::ssh_executable().ok_or("REMOTE_SSH_MISSING")?;
    let remote_command = format!("sh -c {}", remote_runtime::shell_quote(&script));
    let mut command = Command::new(ssh);
    remote_runtime::configure_ssh_command(&mut command, settings, &remote_command)?;
    command.kill_on_drop(true);
    crate::process_util::apply_no_window_tokio(&mut command);
    if input.is_some() {
        command.stdin(Stdio::piped());
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("REMOTE_WORKSPACE_SPAWN: {error}"))?;
    if let Some(bytes) = input {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "REMOTE_WORKSPACE_STDIN".to_string())?;
        tokio::time::timeout(REMOTE_COMMAND_TIMEOUT, stdin.write_all(&bytes))
            .await
            .map_err(|_| "REMOTE_WORKSPACE_TIMEOUT".to_string())?
            .map_err(|error| format!("REMOTE_WORKSPACE_STDIN: {error}"))?;
        stdin
            .shutdown()
            .await
            .map_err(|error| format!("REMOTE_WORKSPACE_STDIN: {error}"))?;
    }
    let output = tokio::time::timeout(REMOTE_COMMAND_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| "REMOTE_WORKSPACE_TIMEOUT".to_string())?
        .map_err(|error| format!("REMOTE_WORKSPACE_WAIT: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!(
            "REMOTE_WORKSPACE_COMMAND: {}",
            clean_detail(if stderr.trim().is_empty() {
                &stdout
            } else {
                &stderr
            })
        ));
    }
    Ok(RemoteOutput { stdout, stderr })
}

fn join_relative(parent: &str, name: &str) -> String {
    let parent = parent.trim().trim_matches('/');
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

fn ext_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase()
}

fn file_kind(ext: &str) -> &'static str {
    match ext {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif" => "image",
        "pdf" => "pdf",
        "mp4" | "webm" | "mov" | "mkv" => "video",
        "mp3" | "wav" | "ogg" | "m4a" | "flac" | "aac" => "audio",
        "json" | "jsonc" => "json",
        "md" | "mdx" | "markdown" => "markdown",
        "html" | "htm" => "html",
        "css" | "scss" | "less" => "css",
        "csv" | "tsv" => "csv",
        "xml" | "yml" | "yaml" | "toml" | "ini" | "env" | "conf" | "config" => "config",
        "docx" | "docm" | "dotx" | "dotm" => "docx",
        "xlsx" | "xlsm" | "xltx" | "xltm" => "xlsx",
        "pptx" | "pptm" | "potx" | "potm" => "pptx",
        "zip" | "tar" | "gz" | "tgz" | "bz2" | "7z" | "rar" | "xz" => "archive",
        "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "java" | "kt" | "swift" | "c" | "cc"
        | "cpp" | "h" | "hpp" | "cs" | "rb" | "php" | "sh" | "bash" | "zsh" | "sql" | "vue"
        | "svelte" | "dart" | "lua" | "r" | "scala" | "zig" | "ex" | "exs" | "clj" | "fs"
        | "fsx" | "gradle" | "dockerfile" | "makefile" | "cmake" | "mdc" | "map" => "code",
        _ => "text",
    }
}

fn mime_for(kind: &str, ext: &str) -> &'static str {
    match (kind, ext) {
        ("image", "png") => "image/png",
        ("image", "jpg" | "jpeg") => "image/jpeg",
        ("image", "gif") => "image/gif",
        ("image", "webp") => "image/webp",
        ("image", "svg") => "image/svg+xml",
        ("image", "bmp") => "image/bmp",
        ("image", "ico") => "image/x-icon",
        ("image", "avif") => "image/avif",
        ("pdf", _) => "application/pdf",
        ("video", "mp4") => "video/mp4",
        ("video", "webm") => "video/webm",
        ("video", "mov") => "video/quicktime",
        ("audio", "mp3") => "audio/mpeg",
        ("audio", "wav") => "audio/wav",
        ("audio", "ogg") => "audio/ogg",
        ("json", _) => "application/json",
        ("markdown", _) => "text/markdown",
        ("html", _) => "text/html",
        ("css", _) => "text/css",
        ("csv", "tsv") => "text/tab-separated-values",
        ("csv", _) => "text/csv",
        ("docx", _) => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ("xlsx", _) => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ("pptx", _) => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "text/plain",
    }
}

fn parse_header<'a>(stdout: &'a str, prefix: &str) -> Result<(&'a str, u64, u64), String> {
    let (header, body) = stdout
        .split_once('\n')
        .ok_or_else(|| "REMOTE_WORKSPACE_RESPONSE_INVALID".to_string())?;
    let mut parts = header.split('\t');
    if parts.next() != Some(prefix) {
        return Err("REMOTE_WORKSPACE_RESPONSE_INVALID".into());
    }
    let size = parts
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| "REMOTE_WORKSPACE_RESPONSE_INVALID".to_string())?;
    let mtime_seconds = parts
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    Ok((body.trim(), size, mtime_seconds.saturating_mul(1_000)))
}

pub async fn fs_list_dir(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    relative: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let root = project_expr(settings, project_path)?;
    let relative = safe_relative(relative)?;
    let rel = remote_runtime::shell_quote(&relative);
    let script = format!(
        "root={root}; rel={rel}; dir=\"$root\"; if [ -n \"$rel\" ]; then dir=\"$root/$rel\"; fi; [ -d \"$dir\" ] || {{ echo 'directory not found' >&2; exit 2; }}; for entry in \"$dir\"/* \"$dir\"/.[!.]* \"$dir\"/..?*; do [ -e \"$entry\" ] || [ -L \"$entry\" ] || continue; name=$(basename \"$entry\"); case \"$name\" in .git|.DS_Store|Thumbs.db) continue;; esac; size=$(wc -c < \"$entry\" 2>/dev/null | tr -d ' '); [ -n \"$size\" ] || size=0; if [ -d \"$entry\" ]; then kind=d; else kind=f; fi; printf 'PI_ENTRY\\t'; printf '%s' \"$name\" | base64 | tr -d '\\n'; printf '\\t%s\\t%s\\n' \"$kind\" \"$size\"; done | sort",
    );
    let output = run_remote(settings, script, None).await?;
    let mut rows = Vec::new();
    for line in output.stdout.lines() {
        let mut parts = line.split('\t');
        if parts.next() != Some("PI_ENTRY") {
            continue;
        }
        let encoded = parts.next().unwrap_or_default();
        let name = String::from_utf8(
            B64.decode(encoded)
                .map_err(|_| "REMOTE_WORKSPACE_RESPONSE_INVALID")?,
        )
        .map_err(|_| "REMOTE_WORKSPACE_RESPONSE_INVALID")?;
        if name.is_empty() {
            continue;
        }
        let is_dir = parts.next() == Some("d");
        let size = parts
            .next()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);
        let ext = ext_of(&name);
        rows.push(json!({
            "name": name,
            "relativePath": join_relative(&relative, &name),
            "isDir": is_dir,
            "size": size,
            "ext": ext,
        }));
    }
    Ok(rows)
}

pub async fn fs_read_file(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    relative: &str,
) -> Result<serde_json::Value, String> {
    let root = project_expr(settings, project_path)?;
    let relative = safe_relative(relative)?;
    let rel = remote_runtime::shell_quote(&relative);
    let script = format!(
        "root={root}; rel={rel}; target=\"$root\"; if [ -n \"$rel\" ]; then target=\"$root/$rel\"; fi; [ -f \"$target\" ] || {{ echo 'file not found' >&2; exit 2; }}; size=$(wc -c < \"$target\" | tr -d ' '); [ -n \"$size\" ] || size=0; [ \"$size\" -le {MAX_REMOTE_READ_BYTES} ] || {{ echo 'file too large' >&2; exit 3; }}; mtime=$(stat -c %Y \"$target\" 2>/dev/null || stat -f %m \"$target\" 2>/dev/null || printf 0); [ -n \"$mtime\" ] || mtime=0; printf 'PI_READ\\t%s\\t%s\\n' \"$size\" \"$mtime\"; base64 < \"$target\" | tr -d '\\n'; printf '\\n'",
    );
    let output = run_remote(settings, script, None).await?;
    let (encoded, size, mtime_ms) = parse_header(&output.stdout, "PI_READ")?;
    let bytes = B64
        .decode(encoded)
        .map_err(|_| "REMOTE_WORKSPACE_RESPONSE_INVALID")?;
    let name = Path::new(&relative)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&relative)
        .to_string();
    let ext = ext_of(&name);
    let kind = file_kind(&ext);
    let binary_kind = matches!(
        kind,
        "image" | "pdf" | "video" | "audio" | "archive" | "docx" | "xlsx" | "pptx"
    );
    let text = if !binary_kind && bytes.len() <= MAX_REMOTE_TEXT_BYTES {
        String::from_utf8(bytes.clone()).ok()
    } else {
        None
    };
    let encoded_data = if text.is_none() {
        Some(B64.encode(&bytes))
    } else {
        None
    };
    Ok(json!({
        "relativePath": relative,
        "name": name,
        "absolutePath": format!("{}/{}", project_path.trim_end_matches('/'), relative),
        "size": size,
        "kind": kind,
        "mime": mime_for(kind, &ext),
        "text": text,
        "base64": encoded_data,
        "stream": false,
        "truncated": false,
        "error": serde_json::Value::Null,
        "mtimeMs": mtime_ms,
    }))
}

pub async fn fs_write_file(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    relative: &str,
    content: &str,
    expected_mtime_ms: Option<u64>,
) -> Result<serde_json::Value, String> {
    let root = project_expr(settings, project_path)?;
    let relative = safe_relative(relative)?;
    let rel = remote_runtime::shell_quote(&relative);
    let expected = expected_mtime_ms
        .map(|value| (value / 1_000).to_string())
        .unwrap_or_default();
    let script = format!(
        "root={root}; rel={rel}; target=\"$root\"; if [ -n \"$rel\" ]; then target=\"$root/$rel\"; fi; current=0; if [ -f \"$target\" ]; then current=$(stat -c %Y \"$target\" 2>/dev/null || stat -f %m \"$target\" 2>/dev/null || printf 0); fi; expected={expected}; [ -z \"$expected\" ] || [ \"$current\" = \"$expected\" ] || {{ echo 'REMOTE_FS_CONFLICT' >&2; exit 4; }}; tmp=\"$target.pi-write-$$\"; if base64 -d </dev/null >/dev/null 2>&1; then base64 -d > \"$tmp\"; else base64 -D > \"$tmp\"; fi || {{ rm -f \"$tmp\"; exit 5; }}; mv -f \"$tmp\" \"$target\"; size=$(wc -c < \"$target\" | tr -d ' '); [ -n \"$size\" ] || size=0; mtime=$(stat -c %Y \"$target\" 2>/dev/null || stat -f %m \"$target\" 2>/dev/null || printf 0); [ -n \"$mtime\" ] || mtime=0; printf 'PI_WRITE\\t%s\\t%s\\n' \"$size\" \"$mtime\"",
    );
    let output = run_remote(
        settings,
        script,
        Some(B64.encode(content.as_bytes()).into_bytes()),
    )
    .await?;
    let (_, size, mtime_ms) = parse_header(&output.stdout, "PI_WRITE")?;
    Ok(json!({
        "relativePath": relative,
        "absolutePath": format!("{}/{}", project_path.trim_end_matches('/'), relative),
        "size": size,
        "mtimeMs": mtime_ms,
    }))
}

pub async fn fs_open_path(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    path: &str,
) -> Result<serde_json::Value, String> {
    let relative = workspace_relative(project_path, path)?;
    if relative.is_empty() {
        return Err("REMOTE_PATH_INVALID".into());
    }
    fs_read_file(settings, project_path, &relative).await
}

pub async fn fs_read_absolute(
    settings: &RemoteRuntimeSettings,
    path: &str,
) -> Result<serde_json::Value, String> {
    fs_open_path(settings, settings.cwd.trim(), path).await
}

pub async fn fs_write_absolute(
    settings: &RemoteRuntimeSettings,
    path: &str,
    content: &str,
    expected_mtime_ms: Option<u64>,
) -> Result<serde_json::Value, String> {
    let relative = workspace_relative(settings.cwd.trim(), path)?;
    if relative.is_empty() {
        return Err("REMOTE_PATH_INVALID".into());
    }
    fs_write_file(
        settings,
        settings.cwd.trim(),
        &relative,
        content,
        expected_mtime_ms,
    )
    .await
}

fn git_entry_kind(index: char, worktree: char) -> &'static str {
    if index == '?' && worktree == '?' {
        "untracked"
    } else if index == 'A' || worktree == 'A' {
        "added"
    } else if index == 'D' || worktree == 'D' {
        "deleted"
    } else if index == 'R' || worktree == 'R' {
        "renamed"
    } else {
        "modified"
    }
}

fn git_status_value(project_path: &str, line: &str) -> Option<serde_json::Value> {
    if line.len() < 3 {
        return None;
    }
    let bytes = line.as_bytes();
    let index = bytes[0] as char;
    let worktree = bytes[1] as char;
    let path = line[2..].trim_start().replace('\\', "/");
    if path.is_empty() {
        return None;
    }
    Some(json!({
        "path": path,
        "absolutePath": format!("{}/{}", project_path.trim_end_matches('/'), path),
        "status": format!("{index}{worktree}"),
        "indexStatus": index.to_string(),
        "worktreeStatus": worktree.to_string(),
        "kind": git_entry_kind(index, worktree),
        "name": Path::new(&path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&path),
        "originalPath": serde_json::Value::Null,
    }))
}

pub async fn git_status(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
) -> Result<serde_json::Value, String> {
    let script = script_for_project(
        settings,
        project_path,
        "branch=$(git branch --show-current 2>/dev/null || true); printf 'PI_GIT_BRANCH\\t%s\\n' \"$branch\"; git status --porcelain=v1 --untracked-files=normal",
    )?;
    let output = match run_remote(settings, script, None).await {
        Ok(output) => output,
        Err(error) => {
            return Ok(json!({
                "available": false,
                "files": [],
                "branch": serde_json::Value::Null,
                "reason": clean_detail(error)
            }))
        }
    };
    let mut branch = None;
    let mut files = Vec::new();
    for line in output.stdout.lines() {
        if let Some(value) = line.strip_prefix("PI_GIT_BRANCH\t") {
            branch = (!value.trim().is_empty()).then(|| value.trim().to_string());
        } else if let Some(row) = git_status_value(project_path, line) {
            files.push(row);
        }
    }
    Ok(json!({
        "available": true,
        "files": files,
        "branch": branch,
        "reason": serde_json::Value::Null
    }))
}

pub async fn git_numstat(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
) -> Result<serde_json::Value, String> {
    let script = script_for_project(
        settings,
        project_path,
        "git diff --numstat HEAD 2>/dev/null || true",
    )?;
    let output = match run_remote(settings, script, None).await {
        Ok(output) => output,
        Err(error) => {
            return Ok(json!({
                "available": false,
                "entries": [],
                "totalAdded": 0,
                "totalRemoved": 0,
                "reason": clean_detail(error)
            }))
        }
    };
    let mut entries = Vec::new();
    for line in output.stdout.lines() {
        let mut parts = line.splitn(3, '\t');
        let Some(added) = parts.next().and_then(|value| value.parse::<u32>().ok()) else {
            continue;
        };
        let Some(removed) = parts.next().and_then(|value| value.parse::<u32>().ok()) else {
            continue;
        };
        let Some(path) = parts.next().map(|value| value.replace('\\', "/")) else {
            continue;
        };
        if path.is_empty() {
            continue;
        }
        entries.push(json!({
            "path": path,
            "added": added,
            "removed": removed
        }));
    }
    let total_added = entries
        .iter()
        .filter_map(|row| row.get("added").and_then(|value| value.as_u64()))
        .sum::<u64>();
    let total_removed = entries
        .iter()
        .filter_map(|row| row.get("removed").and_then(|value| value.as_u64()))
        .sum::<u64>();
    Ok(json!({
        "available": true,
        "entries": entries,
        "totalAdded": total_added,
        "totalRemoved": total_removed,
        "reason": serde_json::Value::Null
    }))
}

pub async fn git_file_diff(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    path: &str,
) -> Result<serde_json::Value, String> {
    let path = workspace_relative(project_path, path)?;
    let command = format!(
        "git diff HEAD -- {} 2>/dev/null || true",
        remote_runtime::shell_quote(&path)
    );
    let script = script_for_project(settings, project_path, &command)?;
    let output = run_remote(settings, script, None).await?;
    let diff = output.stdout.trim().to_string();
    Ok(json!({
        "available": !diff.is_empty(),
        "diff": if diff.is_empty() {
            serde_json::Value::Null
        } else {
            json!(diff)
        },
        "relativePath": path,
        "reason": if diff.is_empty() {
            json!("no diff")
        } else {
            serde_json::Value::Null
        }
    }))
}

async fn git_operation(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    command: String,
) -> Result<serde_json::Value, String> {
    let script = script_for_project(settings, project_path, &command)?;
    match run_remote(settings, script, None).await {
        Ok(output) => Ok(json!({
            "ok": true,
            "output": clean_detail(if output.stdout.trim().is_empty() {
                &output.stderr
            } else {
                &output.stdout
            }),
            "reason": serde_json::Value::Null
        })),
        Err(error) => Ok(json!({
            "ok": false,
            "output": clean_detail(&error),
            "reason": clean_detail(&error)
        })),
    }
}

fn quoted_paths(paths: &[String]) -> Result<String, String> {
    if paths.is_empty() {
        return Ok(".".into());
    }
    paths
        .iter()
        .map(|path| safe_relative(path).map(|value| remote_runtime::shell_quote(&value)))
        .collect::<Result<Vec<_>, _>>()
        .map(|values| values.join(" "))
}

pub async fn git_stage(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    paths: &[String],
) -> Result<serde_json::Value, String> {
    git_operation(
        settings,
        project_path,
        format!("git add -- {}", quoted_paths(paths)?),
    )
    .await
}

pub async fn git_unstage(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    paths: &[String],
) -> Result<serde_json::Value, String> {
    git_operation(
        settings,
        project_path,
        format!("git reset -q HEAD -- {}", quoted_paths(paths)?),
    )
    .await
}

pub async fn git_commit(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    message: &str,
) -> Result<serde_json::Value, String> {
    if message.trim().is_empty() {
        return Err("empty commit message".into());
    }
    git_operation(
        settings,
        project_path,
        format!(
            "git commit -m {}",
            remote_runtime::shell_quote(message.trim())
        ),
    )
    .await
}

pub async fn git_push(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
) -> Result<serde_json::Value, String> {
    git_operation(settings, project_path, "git push".into()).await
}

pub async fn git_discard(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    tracked: &[String],
    untracked: &[String],
) -> Result<serde_json::Value, String> {
    let mut commands = Vec::new();
    if !tracked.is_empty() {
        commands.push(format!("git restore -- {}", quoted_paths(tracked)?));
    }
    if !untracked.is_empty() {
        commands.push(format!("git clean -f -- {}", quoted_paths(untracked)?));
    }
    if commands.is_empty() {
        return Ok(json!({
            "ok": true,
            "output": "",
            "reason": serde_json::Value::Null
        }));
    }
    git_operation(settings, project_path, commands.join(" && ")).await
}

pub async fn git_show_file(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    path: &str,
) -> Result<serde_json::Value, String> {
    let path = workspace_relative(project_path, path)?;
    let command = format!(
        "git show HEAD:{} 2>/dev/null | base64 | tr -d '\\n'",
        remote_runtime::shell_quote(&path)
    );
    let script = script_for_project(settings, project_path, &command)?;
    let output = match run_remote(settings, script, None).await {
        Ok(output) => output,
        Err(error) => {
            return Ok(json!({
                "available": false,
                "content": serde_json::Value::Null,
                "relativePath": path,
                "reason": clean_detail(error)
            }))
        }
    };
    let content = B64
        .decode(output.stdout.trim())
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok());
    Ok(json!({
        "available": content.is_some(),
        "content": content,
        "relativePath": path,
        "reason": if content.is_some() {
            serde_json::Value::Null
        } else {
            json!("binary or unavailable")
        }
    }))
}

// ── Git worktrees ──────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct RemoteWorktree {
    path: String,
    head: Option<String>,
    branch: Option<String>,
    detached: bool,
    is_main: bool,
    locked: bool,
    prunable: bool,
}

fn remote_worktree_path_key(value: &str) -> String {
    let mut path = value.trim().replace('\\', "/");
    while path.ends_with('/') && path.len() > 1 {
        path.pop();
    }
    path
}

fn parse_remote_worktrees(raw: &str) -> Vec<RemoteWorktree> {
    let text = raw.replace("\r\n", "\n");
    let mut out = Vec::new();
    for block in text.split("\n\n") {
        let mut path = String::new();
        let mut head = None;
        let mut branch = None;
        let mut detached = false;
        let mut locked = false;
        let mut prunable = false;
        for line in block.lines() {
            let line = line.trim_end();
            if let Some(value) = line.strip_prefix("worktree ") {
                path = remote_worktree_path_key(value);
            } else if let Some(value) = line.strip_prefix("HEAD ") {
                head = (!value.trim().is_empty()).then(|| value.trim().to_string());
            } else if let Some(value) = line.strip_prefix("branch ") {
                let value = value.trim();
                branch = if let Some(value) = value.strip_prefix("refs/heads/") {
                    (!value.is_empty()).then(|| value.to_string())
                } else {
                    (!value.is_empty()).then(|| value.to_string())
                };
            } else if line == "detached" {
                detached = true;
            } else if line.starts_with("locked") {
                locked = true;
            } else if line.starts_with("prunable") {
                prunable = true;
            }
        }
        if path.is_empty() {
            continue;
        }
        if detached {
            branch = None;
        }
        out.push(RemoteWorktree {
            path,
            head,
            branch,
            detached,
            is_main: out.is_empty(),
            locked,
            prunable,
        });
    }
    for (index, worktree) in out.iter_mut().enumerate() {
        worktree.is_main = index == 0;
    }
    out
}

fn remote_worktree_json(worktree: &RemoteWorktree) -> serde_json::Value {
    json!({
        "path": worktree.path,
        "head": worktree.head,
        "branch": worktree.branch,
        "detached": worktree.detached,
        "isMain": worktree.is_main,
        "locked": worktree.locked,
        "prunable": worktree.prunable,
    })
}

async fn remote_worktrees_strict(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
) -> Result<Vec<RemoteWorktree>, String> {
    let script = script_for_project(settings, project_path, "git worktree list --porcelain")?;
    let output = run_remote(settings, script, None).await?;
    Ok(parse_remote_worktrees(&output.stdout))
}

pub async fn git_worktrees_list(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
) -> Result<serde_json::Value, String> {
    let script = script_for_project(settings, project_path, "git worktree list --porcelain")?;
    let output = match run_remote(settings, script, None).await {
        Ok(output) => output,
        Err(error) => {
            return Ok(json!({
                "available": false,
                "worktrees": [],
                "reason": clean_detail(error),
            }))
        }
    };
    let worktrees = parse_remote_worktrees(&output.stdout)
        .iter()
        .map(remote_worktree_json)
        .collect::<Vec<_>>();
    Ok(json!({
        "available": true,
        "worktrees": worktrees,
        "reason": serde_json::Value::Null,
    }))
}

fn remote_worktree_name(raw: &str) -> Result<String, String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err("worktree name is required".into());
    }
    if name == "." || name == ".." || name.len() > 64 || name.starts_with('-') {
        return Err("invalid worktree name".into());
    }
    if name.contains(['/', '\\', '\0'])
        || !name
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-'))
    {
        return Err("invalid worktree name".into());
    }
    Ok(name.to_string())
}

fn remote_worktree_ref(raw: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.len() > 256 || value.starts_with('-') || value.contains(['\0', '\n', '\r']) {
        return Err("invalid branch / ref".into());
    }
    Ok(Some(value.to_string()))
}

fn remote_worktree_sibling_path(main_path: &str, name: &str) -> Result<String, String> {
    let main = remote_worktree_path_key(main_path);
    let main_path = Path::new(&main);
    let base = main_path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "could not resolve main worktree name".to_string())?;
    let parent = main_path
        .parent()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "could not resolve main worktree parent".to_string())?;
    let target = format!("{parent}/{base}-{name}");
    if target == main {
        return Err("resolved worktree path is invalid".into());
    }
    Ok(target)
}

pub async fn git_worktree_add(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    name: &str,
    start_point: Option<&str>,
) -> Result<serde_json::Value, String> {
    let name = remote_worktree_name(name)?;
    let start_point = remote_worktree_ref(start_point)?;
    let listed = remote_worktrees_strict(settings, project_path).await?;
    let main = listed
        .first()
        .ok_or_else(|| "could not resolve main worktree path".to_string())?;
    let target = remote_worktree_sibling_path(&main.path, &name)?;
    if listed.iter().any(|worktree| {
        remote_worktree_path_key(&worktree.path) == remote_worktree_path_key(&target)
    }) {
        return Err(format!("worktree already registered: {target}"));
    }
    let start = start_point
        .as_deref()
        .map(remote_runtime::shell_quote)
        .unwrap_or_default();
    let suffix = if start.is_empty() {
        String::new()
    } else {
        format!(" {start}")
    };
    let command = format!(
        "[ ! -e {target} ] && [ ! -L {target} ] && git worktree add -b {} {target}{suffix}",
        remote_runtime::shell_quote(&name),
        target = remote_runtime::shell_quote(&target),
        suffix = suffix,
    );
    let script = script_for_project(settings, project_path, &command)?;
    run_remote(settings, script, None).await?;
    let branch = remote_worktrees_strict(settings, project_path)
        .await?
        .into_iter()
        .find(|worktree| {
            remote_worktree_path_key(&worktree.path) == remote_worktree_path_key(&target)
        })
        .and_then(|worktree| worktree.branch)
        .or_else(|| Some(name.clone()));
    Ok(json!({
        "path": target,
        "name": name,
        "startPoint": start_point,
        "branch": branch,
    }))
}

fn remote_worktree_age(raw: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.len() > 64
        || value.starts_with('-')
        || value.contains([' ', '\0', '\n', '\r'])
        || !value
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_'))
    {
        return Err("invalid max-age".into());
    }
    Ok(Some(value.to_string()))
}

fn remote_prune_count(output: &str) -> usize {
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| {
            let line = line.to_ascii_lowercase();
            line.contains("remov") || line.contains("prun") || line.starts_with("would ")
        })
        .count()
}

pub async fn git_worktree_gc(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    dry_run: bool,
    force: bool,
    max_age: Option<&str>,
) -> Result<serde_json::Value, String> {
    let age = remote_worktree_age(max_age)?;
    let listed = remote_worktrees_strict(settings, project_path).await?;
    let prunable = listed
        .iter()
        .filter(|worktree| worktree.prunable)
        .map(|worktree| worktree.path.clone())
        .collect::<Vec<_>>();
    let expire = age.or_else(|| force.then(|| "now".to_string()));
    let mut command = String::from("git worktree prune -v");
    if dry_run {
        command.push_str(" --dry-run");
    }
    if let Some(value) = expire.as_deref() {
        command.push_str(" --expire ");
        command.push_str(&remote_runtime::shell_quote(value));
    }
    let output = run_remote(
        settings,
        script_for_project(settings, project_path, &command)?,
        None,
    )
    .await?;
    let combined = [output.stdout.trim(), output.stderr.trim()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let mut pruned_count = remote_prune_count(&combined);
    if pruned_count == 0 && !prunable.is_empty() {
        pruned_count = prunable.len();
    }
    Ok(json!({
        "dryRun": dry_run,
        "forced": force,
        "maxAge": expire,
        "output": combined.chars().take(4000).collect::<String>(),
        "prunable": prunable,
        "prunedCount": pruned_count,
    }))
}

pub async fn git_worktree_remove(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    worktree_path: &str,
    force: bool,
) -> Result<serde_json::Value, String> {
    let listed = remote_worktrees_strict(settings, project_path).await?;
    let target_key = remote_worktree_path_key(worktree_path);
    let target = listed
        .iter()
        .find(|worktree| remote_worktree_path_key(&worktree.path) == target_key)
        .ok_or_else(|| "worktree not registered for this repository".to_string())?;
    if target.is_main {
        return Err("refusing to remove the main worktree".into());
    }
    let mut command = String::from("git worktree remove");
    if force {
        command.push_str(" --force");
    }
    command.push(' ');
    command.push_str(&remote_runtime::shell_quote(&target.path));
    let script = script_for_project(settings, project_path, &command)?;
    run_remote(settings, script, None).await?;
    Ok(json!({ "path": target.path, "forced": force }))
}

pub async fn git_worktree_diff(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    worktree_path: &str,
) -> Result<serde_json::Value, String> {
    let listed = remote_worktrees_strict(settings, project_path).await?;
    let target_key = remote_worktree_path_key(worktree_path);
    let target = listed
        .iter()
        .find(|worktree| remote_worktree_path_key(&worktree.path) == target_key)
        .ok_or_else(|| "worktree not registered for this repository".to_string())?;
    if target.is_main {
        return Err("main worktree cannot be compared as a candidate".into());
    }
    let target_expr = remote_runtime::shell_quote(&target.path);
    let diff_script = format!(
        "cd {target_expr} && (git diff HEAD --binary || true); git ls-files --others --exclude-standard | while IFS= read -r relative; do [ -n \"$relative\" ] || continue; git diff --no-index --binary /dev/null \"$relative\" || true; done",
    );
    let diff = run_remote(settings, diff_script, None).await?;
    let status_script = format!("cd {target_expr} && git status --short --untracked-files=all");
    let status = run_remote(settings, status_script, None).await?;
    Ok(json!({
        "path": target.path,
        "branch": target.branch,
        "diff": diff.stdout.chars().take(1_000_000).collect::<String>(),
        "status": status.stdout.chars().take(50_000).collect::<String>(),
    }))
}

pub async fn git_worktree_adopt(
    settings: &RemoteRuntimeSettings,
    project_path: &str,
    worktree_path: &str,
    cleanup_paths: &[String],
) -> Result<serde_json::Value, String> {
    let listed = remote_worktrees_strict(settings, project_path).await?;
    let target_key = remote_worktree_path_key(worktree_path);
    let candidate = listed
        .iter()
        .find(|worktree| remote_worktree_path_key(&worktree.path) == target_key)
        .ok_or_else(|| "worktree not registered for this repository".to_string())?;
    if candidate.is_main {
        return Err("main worktree cannot be adopted as a candidate".into());
    }
    let branch = candidate
        .branch
        .clone()
        .ok_or_else(|| "candidate worktree is detached".to_string())?;
    let main = listed
        .first()
        .ok_or_else(|| "could not resolve main worktree path".to_string())?
        .path
        .clone();
    let main_expr = remote_runtime::shell_quote(&main);
    let status_script = format!(
        "status=$(git -C {main_expr} status --porcelain --untracked-files=all); [ -z \"$status\" ] || {{ printf '%s' \"$status\" >&2; exit 20; }}"
    );
    run_remote(settings, status_script, None)
        .await
        .map_err(|error| {
            format!(
                "main worktree has local changes; commit or stash them before adoption: {error}"
            )
        })?;
    let target_expr = remote_runtime::shell_quote(&candidate.path);
    let commit_script = format!(
        "cd {target_expr} && git add -A && if git diff --cached --quiet; then :; else git -c user.name='Pi App' -c user.email='pi-app@localhost' commit -m 'Pi App: adopt best-of-N result'; fi"
    );
    run_remote(settings, commit_script, None).await?;
    let branch_expr = remote_runtime::shell_quote(&branch);
    let merge_script = format!(
        "if output=$(git -C {main_expr} merge --no-edit --no-ff {branch_expr} 2>&1); then :; else git -C {main_expr} merge --abort >/dev/null 2>&1 || true; printf '%s' \"$output\" >&2; exit 1; fi"
    );
    run_remote(settings, merge_script, None).await?;

    let mut removed = Vec::new();
    let mut cleanup_errors = Vec::new();
    for raw_path in cleanup_paths {
        let key = remote_worktree_path_key(raw_path);
        if key.is_empty() || key == remote_worktree_path_key(&main) {
            continue;
        }
        let Some(registered) = listed
            .iter()
            .find(|worktree| remote_worktree_path_key(&worktree.path) == key)
        else {
            cleanup_errors.push(format!("not registered: {raw_path}"));
            continue;
        };
        let remove = format!(
            "git -C {main_expr} worktree remove {}",
            remote_runtime::shell_quote(&registered.path)
        );
        match run_remote(settings, remove, None).await {
            Ok(_) => removed.push(registered.path.clone()),
            Err(error) => {
                cleanup_errors.push(format!("{}: {}", registered.path, clean_detail(error)))
            }
        }
    }
    Ok(json!({
        "merged": true,
        "branch": branch,
        "removed": removed,
        "cleanupErrors": cleanup_errors,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_workspace_paths_relative() {
        assert_eq!(
            workspace_relative("~/project", "src/main.rs").unwrap(),
            "src/main.rs"
        );
        assert_eq!(
            workspace_relative("~/project", "~/project/src/main.rs").unwrap(),
            "src/main.rs"
        );
        assert_eq!(
            workspace_relative("/srv/pi", "/srv/pi/a b.md").unwrap(),
            "a b.md"
        );
    }

    #[test]
    fn rejects_escape_and_absolute_paths_outside_workspace() {
        assert!(workspace_relative("/srv/pi", "../secrets.txt").is_err());
        assert!(workspace_relative("/srv/pi", "/srv/other/secrets.txt").is_err());
        assert!(workspace_relative("/srv/pi", "src/../../secrets.txt").is_err());
    }

    #[test]
    fn classifies_porcelain_status() {
        assert_eq!(git_entry_kind('?', '?'), "untracked");
        assert_eq!(git_entry_kind('A', ' '), "added");
        assert_eq!(git_entry_kind(' ', 'D'), "deleted");
        assert_eq!(git_entry_kind(' ', 'M'), "modified");
    }

    #[test]
    fn parses_remote_worktrees() {
        let raw = "worktree /srv/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /srv/repo-feat\nHEAD def\nbranch refs/heads/feat\n";
        let list = parse_remote_worktrees(raw);
        assert_eq!(list.len(), 2);
        assert!(list[0].is_main);
        assert_eq!(list[1].branch.as_deref(), Some("feat"));
        assert!(!list[1].is_main);
    }

    #[test]
    fn remote_worktree_inputs_are_bounded() {
        assert!(remote_worktree_name("../escape").is_err());
        assert!(remote_worktree_name("feature-one").is_ok());
        assert!(remote_worktree_ref(Some("-c")).is_err());
        assert!(remote_worktree_age(Some("2.weeks.ago")).is_ok());
    }
}
