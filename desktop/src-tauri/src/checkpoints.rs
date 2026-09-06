//! Git-backed before/after snapshots for individual agent turns.
//!
//! Captures use an isolated temporary index and hidden refs. They never move the
//! user's branch, modify the real index, or use destructive reset operations.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, MutexGuard, OnceLock};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::operation_journal::{
    begin_host_operation, transition_host_operation, OperationBeginInput, OperationStatus,
    OperationTransitionInput,
};

const SCHEMA_VERSION: u32 = 1;
const MAX_RECORDS: usize = 10_000;
const MAX_CHANGED_PATHS: usize = 5_000;
const MAX_PATCH_BYTES: usize = 20 * 1024 * 1024;

static GIT_CAPTURE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// Checkpoints are Git objects owned by the host process. A remote Pi session
/// may still carry a local project id for its chat binding, but its working
/// tree lives on the SSH target. Never let that metadata route a remote turn
/// into a snapshot of the similarly named local repository.
fn remote_runtime_active() -> bool {
    crate::store::load_settings().remote_runtime.enabled
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckpointStatus {
    Capturing,
    Ready,
    Partial,
    Failed,
    Reverted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnCheckpoint {
    pub id: String,
    pub project_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub repo_root: String,
    pub before_tree: String,
    pub before_commit: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_tree: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_commit: Option<String>,
    pub working_tree_digest: String,
    pub status: CheckpointStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub changed_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckpointStore {
    #[serde(default = "default_schema_version")]
    schema_version: u32,
    #[serde(default)]
    records: Vec<TurnCheckpoint>,
}

impl Default for CheckpointStore {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            records: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointRevertPreview {
    pub checkpoint_id: String,
    pub changed_paths: Vec<String>,
    pub current_worktree_digest: String,
    pub clean: bool,
    pub conflict_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointRevertResult {
    pub checkpoint_id: String,
    pub safety_checkpoint_id: String,
    pub status: String,
    pub changed_paths: Vec<String>,
    pub recoverable_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointGcResult {
    pub removed: usize,
    pub retained: usize,
    pub ref_errors: Vec<String>,
}

fn default_schema_version() -> u32 {
    SCHEMA_VERSION
}

fn git_capture_guard() -> Result<MutexGuard<'static, ()>, String> {
    GIT_CAPTURE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "CHECKPOINT_LOCK_POISONED".to_string())
}

fn store_path() -> PathBuf {
    crate::paths::checkpoints_v1_file()
}

fn clean_id(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 180
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
    {
        return Err(format!("CHECKPOINT_INVALID: invalid {label}"));
    }
    Ok(value.to_string())
}

fn clean_error(value: impl Into<String>) -> String {
    value.into().replace('\0', "").chars().take(4_096).collect()
}

fn load_store(path: &Path) -> Result<CheckpointStore, String> {
    let text = match fs::read_to_string(path) {
        Ok(text) if !text.trim().is_empty() => text,
        Ok(_) => return Ok(CheckpointStore::default()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(CheckpointStore::default())
        }
        Err(error) => return Err(format!("CHECKPOINT_STORE_READ: {error}")),
    };
    let store: CheckpointStore = serde_json::from_str(&text)
        .map_err(|error| format!("CHECKPOINT_STORE_CORRUPT: {error}"))?;
    if store.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "CHECKPOINT_STORE_UNSUPPORTED_VERSION: expected {SCHEMA_VERSION}, got {}",
            store.schema_version
        ));
    }
    if store.records.len() > MAX_RECORDS {
        return Err("CHECKPOINT_STORE_LIMIT: too many records".into());
    }
    Ok(store)
}

fn save_store_under_lock(path: &Path, store: &CheckpointStore) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("CHECKPOINT_STORE_SERIALIZE: {error}"))?;
    crate::store_lock::write_bytes_atomic_under_lock(path, &bytes)
        .map_err(|error| format!("CHECKPOINT_STORE_WRITE: {error}"))
}

fn run_git(root: &Path, args: &[&str], index: Option<&Path>) -> Result<String, String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(root).args(args);
    if let Some(index) = index {
        command.env("GIT_INDEX_FILE", index);
    }
    crate::process_util::apply_no_window_std(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("CHECKPOINT_GIT_EXEC: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!("CHECKPOINT_GIT: {}", clean_error(detail)));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn run_git_bytes(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(root).args(args);
    crate::process_util::apply_no_window_std(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("CHECKPOINT_GIT_EXEC: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "CHECKPOINT_GIT: {}",
            clean_error(String::from_utf8_lossy(&output.stderr))
        ));
    }
    Ok(output.stdout)
}

fn run_git_with_input(root: &Path, args: &[&str], input: &[u8]) -> Result<(bool, String), String> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(root)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::process_util::apply_no_window_std(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("CHECKPOINT_GIT_EXEC: {error}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "CHECKPOINT_GIT_EXEC: missing stdin".to_string())?
        .write_all(input)
        .map_err(|error| format!("CHECKPOINT_GIT_STDIN: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("CHECKPOINT_GIT_WAIT: {error}"))?;
    let detail = if output.stderr.is_empty() {
        String::from_utf8_lossy(&output.stdout).to_string()
    } else {
        String::from_utf8_lossy(&output.stderr).to_string()
    };
    Ok((output.status.success(), clean_error(detail.trim())))
}

fn resolve_repo_root(project_path: &str) -> Result<Option<PathBuf>, String> {
    let project = PathBuf::from(project_path.trim());
    if !project.is_dir() {
        return Ok(None);
    }
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(&project)
        .args(["rev-parse", "--show-toplevel"]);
    crate::process_util::apply_no_window_std(&mut command);
    let output = match command.output() {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("CHECKPOINT_GIT_EXEC: {error}")),
    };
    if !output.status.success() {
        return Ok(None);
    }
    let root = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    let root = root
        .canonicalize()
        .map_err(|error| format!("CHECKPOINT_REPO_ROOT: {error}"))?;
    Ok(Some(root))
}

fn ref_component(value: &str) -> String {
    if !value.is_empty()
        && value.len() <= 100
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return value.to_string();
    }
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex::encode(hasher.finalize())[..24].to_string()
}

fn checkpoint_ref(repo_root: &Path, session_id: &str, turn_id: &str, phase: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(repo_root.to_string_lossy().as_bytes());
    let repo = &hex::encode(hasher.finalize())[..16];
    format!(
        "refs/pi/checkpoints/{}/{}/{}/{}",
        repo,
        ref_component(session_id),
        ref_component(turn_id),
        phase
    )
}

fn head_commit(root: &Path) -> Option<String> {
    run_git(root, &["rev-parse", "--verify", "HEAD"], None)
        .ok()
        .filter(|value| !value.is_empty())
}

fn write_worktree_tree(root: &Path) -> Result<String, String> {
    let index = std::env::temp_dir().join(format!("pi-checkpoint-{}.index", Uuid::new_v4()));
    let _ = fs::remove_file(&index);
    let result = (|| {
        if let Some(head) = head_commit(root) {
            run_git(root, &["read-tree", &head], Some(&index))?;
        }
        run_git(root, &["add", "-A", "--", "."], Some(&index))?;
        run_git(root, &["write-tree"], Some(&index))
    })();
    let _ = fs::remove_file(index);
    result
}

fn create_commit(
    root: &Path,
    tree: &str,
    parent: Option<&str>,
    message: &str,
) -> Result<String, String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(root).args(["commit-tree", tree]);
    if let Some(parent) = parent {
        command.args(["-p", parent]);
    }
    command.args(["-m", message]);
    command
        .env("GIT_AUTHOR_NAME", "Pi App")
        .env("GIT_AUTHOR_EMAIL", "checkpoint@pi.local")
        .env("GIT_COMMITTER_NAME", "Pi App")
        .env("GIT_COMMITTER_EMAIL", "checkpoint@pi.local");
    crate::process_util::apply_no_window_std(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("CHECKPOINT_GIT_EXEC: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "CHECKPOINT_COMMIT: {}",
            clean_error(String::from_utf8_lossy(&output.stderr))
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn update_ref(root: &Path, reference: &str, commit: &str) -> Result<(), String> {
    run_git(root, &["update-ref", reference, commit], None).map(|_| ())
}

fn changed_paths(root: &Path, before_tree: &str, after_tree: &str) -> Result<Vec<String>, String> {
    let bytes = run_git_bytes(
        root,
        &["diff", "--name-only", "-z", before_tree, after_tree, "--"],
    )?;
    let mut paths = bytes
        .split(|byte| *byte == 0)
        .filter(|value| !value.is_empty())
        .take(MAX_CHANGED_PATHS)
        .map(|value| String::from_utf8_lossy(value).to_string())
        .collect::<Vec<_>>();
    paths.sort();
    Ok(paths)
}

fn diff_patch(root: &Path, before_tree: &str, after_tree: &str) -> Result<Vec<u8>, String> {
    let patch = run_git_bytes(
        root,
        &[
            "diff",
            "--binary",
            "--full-index",
            before_tree,
            after_tree,
            "--",
        ],
    )?;
    if patch.len() > MAX_PATCH_BYTES {
        return Err(format!(
            "CHECKPOINT_PATCH_LIMIT: patch is {} bytes",
            patch.len()
        ));
    }
    Ok(patch)
}

fn insert_checkpoint(path: &Path, checkpoint: TurnCheckpoint) -> Result<(), String> {
    crate::store_lock::with_exclusive_lock(path, || {
        let mut store = load_store(path)?;
        if store.records.len() >= MAX_RECORDS {
            return Err("CHECKPOINT_STORE_LIMIT: too many records".into());
        }
        if store.records.iter().any(|item| item.id == checkpoint.id) {
            return Err("CHECKPOINT_ID_CONFLICT".into());
        }
        store.records.push(checkpoint);
        save_store_under_lock(path, &store)
    })
}

fn update_checkpoint(
    path: &Path,
    id: &str,
    update: impl FnOnce(&mut TurnCheckpoint) -> Result<(), String>,
) -> Result<TurnCheckpoint, String> {
    crate::store_lock::with_exclusive_lock(path, || {
        let mut store = load_store(path)?;
        let Some(checkpoint) = store.records.iter_mut().find(|item| item.id == id) else {
            return Err("CHECKPOINT_NOT_FOUND".into());
        };
        update(checkpoint)?;
        checkpoint.updated_at = Utc::now();
        let result = checkpoint.clone();
        save_store_under_lock(path, &store)?;
        Ok(result)
    })
}

fn checkpoint_by_id(path: &Path, id: &str) -> Result<TurnCheckpoint, String> {
    load_store(path)?
        .records
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "CHECKPOINT_NOT_FOUND".into())
}

fn delete_checkpoint_refs(checkpoint: &TurnCheckpoint) -> Vec<String> {
    let root = Path::new(&checkpoint.repo_root);
    if !root.is_dir() {
        return vec![format!("repository unavailable: {}", checkpoint.repo_root)];
    }
    ["before", "after"]
        .into_iter()
        .filter_map(|phase| {
            let reference =
                checkpoint_ref(root, &checkpoint.session_id, &checkpoint.turn_id, phase);
            run_git(root, &["update-ref", "-d", &reference], None)
                .err()
                .map(clean_error)
        })
        .collect()
}

pub(crate) fn cleanup_all_refs() -> Result<Vec<String>, String> {
    let store = load_store(&store_path())?;
    let _git_guard = git_capture_guard()?;
    Ok(store
        .records
        .iter()
        .flat_map(delete_checkpoint_refs)
        .collect())
}

pub(crate) fn reconcile_incomplete() -> Result<usize, String> {
    let path = store_path();
    crate::store_lock::with_exclusive_lock(&path, || {
        let mut store = load_store(&path)?;
        let mut changed = 0;
        for checkpoint in &mut store.records {
            if checkpoint.status == CheckpointStatus::Capturing {
                checkpoint.status = CheckpointStatus::Partial;
                checkpoint.updated_at = Utc::now();
                checkpoint.last_error =
                    Some("Interrupted before the after-turn snapshot completed".into());
                changed += 1;
            }
        }
        if changed > 0 {
            save_store_under_lock(&path, &store)?;
        }
        Ok(changed)
    })
}

fn latest_matching_after_commit(
    path: &Path,
    repo_root: &Path,
    session_id: &str,
    tree: &str,
) -> Option<String> {
    load_store(path)
        .ok()?
        .records
        .into_iter()
        .filter(|item| {
            item.repo_root == repo_root.to_string_lossy()
                && item.session_id == session_id
                && item.after_tree.as_deref() == Some(tree)
        })
        .max_by_key(|item| item.updated_at)
        .and_then(|item| item.after_commit)
}

pub(crate) fn capture_before_auto(
    project_path: &str,
    project_id: &str,
    session_id: &str,
    turn_id: &str,
) -> Result<Option<TurnCheckpoint>, String> {
    if remote_runtime_active() {
        return Ok(None);
    }
    let project_id = clean_id(project_id, "projectId")?;
    let session_id = clean_id(session_id, "sessionId")?;
    let turn_id = clean_id(turn_id, "turnId")?;
    let Some(repo_root) = resolve_repo_root(project_path)? else {
        return Ok(None);
    };

    let checkpoint_id = Uuid::new_v4().to_string();
    let operation_id = format!("checkpoint:{checkpoint_id}:before");
    let operation = begin_host_operation(OperationBeginInput {
        operation_id: operation_id.clone(),
        kind: "git.checkpoint.capture".into(),
        project_id: project_id.clone(),
        session_id: Some(session_id.clone()),
        payload: json!({
            "checkpointId": checkpoint_id,
            "turnId": turn_id,
            "phase": "before",
            "repoRoot": repo_root,
        }),
    })?;

    let _git_guard = git_capture_guard()?;
    let result = (|| {
        let tree = write_worktree_tree(&repo_root)?;
        let commit = if let Some(commit) =
            latest_matching_after_commit(&store_path(), &repo_root, &session_id, &tree)
        {
            commit
        } else {
            create_commit(
                &repo_root,
                &tree,
                head_commit(&repo_root).as_deref(),
                &format!("Pi checkpoint before turn {turn_id}"),
            )?
        };
        let reference = checkpoint_ref(&repo_root, &session_id, &turn_id, "before");
        update_ref(&repo_root, &reference, &commit)?;
        let now = Utc::now();
        let checkpoint = TurnCheckpoint {
            id: checkpoint_id.clone(),
            project_id,
            session_id,
            turn_id,
            repo_root: repo_root.display().to_string(),
            before_tree: tree.clone(),
            before_commit: commit,
            after_tree: None,
            after_commit: None,
            working_tree_digest: tree,
            status: CheckpointStatus::Capturing,
            created_at: now,
            updated_at: now,
            changed_paths: Vec::new(),
            last_error: None,
        };
        insert_checkpoint(&store_path(), checkpoint.clone())?;
        Ok(checkpoint)
    })();

    match result {
        Ok(checkpoint) => {
            let _ = transition_host_operation(OperationTransitionInput {
                operation_id,
                expected_revision: operation.revision,
                status: OperationStatus::Completed,
                result: Some(json!({"checkpointId": checkpoint.id})),
                recoverable_error: None,
            });
            Ok(Some(checkpoint))
        }
        Err(error) => {
            let _ = transition_host_operation(OperationTransitionInput {
                operation_id,
                expected_revision: operation.revision,
                status: OperationStatus::Failed,
                result: None,
                recoverable_error: Some(clean_error(&error)),
            });
            Err(error)
        }
    }
}

pub(crate) fn capture_after_auto(checkpoint_id: &str) -> Result<TurnCheckpoint, String> {
    if remote_runtime_active() {
        return Err("REMOTE_CHECKPOINTS_UNSUPPORTED".into());
    }
    let checkpoint_id = clean_id(checkpoint_id, "checkpointId")?;
    let checkpoint = checkpoint_by_id(&store_path(), &checkpoint_id)?;
    if checkpoint.status == CheckpointStatus::Ready {
        return Ok(checkpoint);
    }
    if checkpoint.status != CheckpointStatus::Capturing {
        return Err("CHECKPOINT_INVALID_STATE".into());
    }
    let repo_root = PathBuf::from(&checkpoint.repo_root);
    let operation_id = format!("checkpoint:{checkpoint_id}:after");
    let operation = begin_host_operation(OperationBeginInput {
        operation_id: operation_id.clone(),
        kind: "git.checkpoint.capture".into(),
        project_id: checkpoint.project_id.clone(),
        session_id: Some(checkpoint.session_id.clone()),
        payload: json!({
            "checkpointId": checkpoint_id,
            "turnId": checkpoint.turn_id,
            "phase": "after",
            "repoRoot": checkpoint.repo_root,
        }),
    })?;

    let _git_guard = git_capture_guard()?;
    let result = (|| {
        let tree = write_worktree_tree(&repo_root)?;
        let commit = create_commit(
            &repo_root,
            &tree,
            Some(&checkpoint.before_commit),
            &format!("Pi checkpoint after turn {}", checkpoint.turn_id),
        )?;
        let reference = checkpoint_ref(
            &repo_root,
            &checkpoint.session_id,
            &checkpoint.turn_id,
            "after",
        );
        update_ref(&repo_root, &reference, &commit)?;
        let paths = changed_paths(&repo_root, &checkpoint.before_tree, &tree)?;
        update_checkpoint(&store_path(), &checkpoint_id, |item| {
            item.after_tree = Some(tree.clone());
            item.after_commit = Some(commit.clone());
            item.working_tree_digest = tree.clone();
            item.changed_paths = paths.clone();
            item.status = CheckpointStatus::Ready;
            item.last_error = None;
            Ok(())
        })
    })();

    match result {
        Ok(checkpoint) => {
            let _ = transition_host_operation(OperationTransitionInput {
                operation_id,
                expected_revision: operation.revision,
                status: OperationStatus::Completed,
                result: Some(json!({
                    "checkpointId": checkpoint.id,
                    "changedPaths": checkpoint.changed_paths,
                })),
                recoverable_error: None,
            });
            Ok(checkpoint)
        }
        Err(error) => {
            let _ = update_checkpoint(&store_path(), &checkpoint_id, |item| {
                item.status = CheckpointStatus::Partial;
                item.last_error = Some(clean_error(&error));
                Ok(())
            });
            let _ = transition_host_operation(OperationTransitionInput {
                operation_id,
                expected_revision: operation.revision,
                status: OperationStatus::Failed,
                result: None,
                recoverable_error: Some(clean_error(&error)),
            });
            Err(error)
        }
    }
}

pub(crate) fn schedule_capture_after(checkpoint_id: String) {
    std::thread::spawn(move || {
        if let Err(error) = capture_after_auto(&checkpoint_id) {
            tracing::warn!(
                checkpoint_id,
                "turn checkpoint after-capture failed: {error}"
            );
        }
    });
}

fn preview_revert(checkpoint: &TurnCheckpoint) -> Result<CheckpointRevertPreview, String> {
    if checkpoint.status != CheckpointStatus::Ready {
        return Err("CHECKPOINT_NOT_READY".into());
    }
    let after_tree = checkpoint
        .after_tree
        .as_deref()
        .ok_or("CHECKPOINT_NOT_READY")?;
    let root = Path::new(&checkpoint.repo_root);
    let _git_guard = git_capture_guard()?;
    let current = write_worktree_tree(root)?;
    let patch = diff_patch(root, &checkpoint.before_tree, after_tree)?;
    if patch.is_empty() {
        return Ok(CheckpointRevertPreview {
            checkpoint_id: checkpoint.id.clone(),
            changed_paths: checkpoint.changed_paths.clone(),
            current_worktree_digest: current,
            clean: true,
            conflict_summary: None,
        });
    }
    let (clean, detail) = run_git_with_input(
        root,
        &["apply", "--reverse", "--check", "--whitespace=nowarn", "-"],
        &patch,
    )?;
    Ok(CheckpointRevertPreview {
        checkpoint_id: checkpoint.id.clone(),
        changed_paths: checkpoint.changed_paths.clone(),
        current_worktree_digest: current,
        clean,
        conflict_summary: (!clean).then_some(detail),
    })
}

#[tauri::command]
pub fn checkpoints_list(
    project_id: Option<String>,
    session_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<TurnCheckpoint>, String> {
    if remote_runtime_active() {
        return Ok(Vec::new());
    }
    let project_id = project_id
        .map(|value| clean_id(&value, "projectId"))
        .transpose()?;
    let session_id = session_id
        .map(|value| clean_id(&value, "sessionId"))
        .transpose()?;
    let mut records = load_store(&store_path())?.records;
    records.retain(|record| {
        project_id
            .as_ref()
            .is_none_or(|value| &record.project_id == value)
            && session_id
                .as_ref()
                .is_none_or(|value| &record.session_id == value)
    });
    records.sort_by_key(|r| std::cmp::Reverse(r.updated_at));
    records.truncate(limit.unwrap_or(100).clamp(1, 500));
    Ok(records)
}

#[tauri::command]
pub fn checkpoint_revert_preview(checkpoint_id: String) -> Result<CheckpointRevertPreview, String> {
    if remote_runtime_active() {
        return Err("REMOTE_CHECKPOINTS_UNSUPPORTED".into());
    }
    let checkpoint_id = clean_id(&checkpoint_id, "checkpointId")?;
    preview_revert(&checkpoint_by_id(&store_path(), &checkpoint_id)?)
}

#[tauri::command]
pub fn checkpoint_revert_apply(
    checkpoint_id: String,
    expected_worktree_digest: String,
    operation_id: String,
) -> Result<CheckpointRevertResult, String> {
    if remote_runtime_active() {
        return Err("REMOTE_CHECKPOINTS_UNSUPPORTED".into());
    }
    let checkpoint_id = clean_id(&checkpoint_id, "checkpointId")?;
    let operation_id = clean_id(&operation_id, "operationId")?;
    let expected_worktree_digest = expected_worktree_digest.trim().to_string();
    let checkpoint = checkpoint_by_id(&store_path(), &checkpoint_id)?;
    let preview = preview_revert(&checkpoint)?;
    if !preview.clean {
        return Err(format!(
            "CHECKPOINT_REVERT_CONFLICT: {}",
            preview.conflict_summary.unwrap_or_default()
        ));
    }
    if preview.current_worktree_digest != expected_worktree_digest {
        return Err("CHECKPOINT_WORKTREE_CHANGED: preview is stale".into());
    }

    let operation = begin_host_operation(OperationBeginInput {
        operation_id: operation_id.clone(),
        kind: "git.checkpoint.revert".into(),
        project_id: checkpoint.project_id.clone(),
        session_id: Some(checkpoint.session_id.clone()),
        payload: json!({
            "checkpointId": checkpoint_id,
            "expectedWorktreeDigest": expected_worktree_digest,
        }),
    })?;
    if operation.status == OperationStatus::Completed {
        let safety_checkpoint_id = operation
            .result
            .as_ref()
            .and_then(|value| value.get("safetyCheckpointId"))
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        return Ok(CheckpointRevertResult {
            checkpoint_id,
            safety_checkpoint_id,
            status: "completed".into(),
            changed_paths: checkpoint.changed_paths,
            recoverable_error: None,
        });
    }
    if operation.status != OperationStatus::Pending {
        return Err(format!(
            "OPERATION_RECONCILIATION_REQUIRED: {:?}",
            operation.status
        ));
    }

    let safety_turn = format!("revert-{}", Uuid::new_v4());
    let safety = capture_before_auto(
        &checkpoint.repo_root,
        &checkpoint.project_id,
        &checkpoint.session_id,
        &safety_turn,
    )?
    .ok_or("CHECKPOINT_REVERT_SAFETY_UNAVAILABLE")?;
    let after_tree = checkpoint
        .after_tree
        .as_deref()
        .ok_or("CHECKPOINT_NOT_READY")?;
    let (applied, detail) = {
        let _git_guard = git_capture_guard()?;
        let patch = diff_patch(
            Path::new(&checkpoint.repo_root),
            &checkpoint.before_tree,
            after_tree,
        )?;
        run_git_with_input(
            Path::new(&checkpoint.repo_root),
            &["apply", "--reverse", "--whitespace=nowarn", "-"],
            &patch,
        )?
    };
    if !applied {
        let _ = transition_host_operation(OperationTransitionInput {
            operation_id,
            expected_revision: operation.revision,
            status: OperationStatus::Failed,
            result: None,
            recoverable_error: Some(detail.clone()),
        });
        return Err(format!("CHECKPOINT_REVERT_FAILED: {detail}"));
    }

    match capture_after_auto(&safety.id) {
        Ok(_) => {
            let _ = update_checkpoint(&store_path(), &checkpoint_id, |item| {
                item.status = CheckpointStatus::Reverted;
                Ok(())
            });
            let _ = transition_host_operation(OperationTransitionInput {
                operation_id,
                expected_revision: operation.revision,
                status: OperationStatus::Completed,
                result: Some(json!({
                    "checkpointId": checkpoint_id,
                    "safetyCheckpointId": safety.id,
                })),
                recoverable_error: None,
            });
            Ok(CheckpointRevertResult {
                checkpoint_id,
                safety_checkpoint_id: safety.id,
                status: "completed".into(),
                changed_paths: checkpoint.changed_paths,
                recoverable_error: None,
            })
        }
        Err(error) => {
            let detail = clean_error(error);
            let _ = transition_host_operation(OperationTransitionInput {
                operation_id,
                expected_revision: operation.revision,
                status: OperationStatus::Uncertain,
                result: Some(json!({
                    "checkpointId": checkpoint_id,
                    "safetyCheckpointId": safety.id,
                })),
                recoverable_error: Some(detail.clone()),
            });
            Ok(CheckpointRevertResult {
                checkpoint_id,
                safety_checkpoint_id: safety.id,
                status: "uncertain".into(),
                changed_paths: checkpoint.changed_paths,
                recoverable_error: Some(detail),
            })
        }
    }
}

#[tauri::command]
pub fn checkpoints_gc(
    max_age_days: Option<u32>,
    max_records: Option<usize>,
) -> Result<CheckpointGcResult, String> {
    if remote_runtime_active() {
        return Err("REMOTE_CHECKPOINTS_UNSUPPORTED".into());
    }
    let max_age_days = max_age_days.unwrap_or(30).clamp(1, 365);
    let max_records = max_records.unwrap_or(1_000).clamp(50, 5_000);
    let cutoff = Utc::now() - chrono::Duration::days(i64::from(max_age_days));
    let path = store_path();
    let (removed_records, retained) = crate::store_lock::with_exclusive_lock(&path, || {
        let mut store = load_store(&path)?;
        store
            .records
            .sort_by_key(|r| std::cmp::Reverse(r.updated_at));
        let mut keep = Vec::with_capacity(store.records.len());
        let mut remove = Vec::new();
        for checkpoint in store.records {
            let terminal = matches!(
                checkpoint.status,
                CheckpointStatus::Ready | CheckpointStatus::Failed | CheckpointStatus::Reverted
            );
            if terminal && (checkpoint.updated_at < cutoff || keep.len() >= max_records) {
                remove.push(checkpoint);
            } else {
                keep.push(checkpoint);
            }
        }
        let retained = keep.len();
        store.records = keep;
        save_store_under_lock(&path, &store)?;
        Ok((remove, retained))
    })?;

    let _git_guard = git_capture_guard()?;
    let ref_errors = removed_records
        .iter()
        .flat_map(delete_checkpoint_refs)
        .collect::<Vec<_>>();
    Ok(CheckpointGcResult {
        removed: removed_records.len(),
        retained,
        ref_errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(root: &Path, args: &[&str]) -> String {
        run_git(root, args, None).unwrap()
    }

    fn temp_repo() -> PathBuf {
        let root = std::env::temp_dir().join(format!("pi-checkpoint-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        git(&root, &["init"]);
        fs::write(root.join("tracked.txt"), "before\n").unwrap();
        git(&root, &["add", "tracked.txt"]);
        let tree = git(&root, &["write-tree"]);
        let commit = create_commit(&root, &tree, None, "initial").unwrap();
        git(&root, &["update-ref", "refs/heads/main", &commit]);
        git(&root, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        root
    }

    #[test]
    fn isolated_snapshot_does_not_touch_real_index() {
        let root = temp_repo();
        fs::write(root.join("tracked.txt"), "changed\n").unwrap();
        fs::write(root.join("new.txt"), "new\n").unwrap();
        let staged_before = git(&root, &["diff", "--cached", "--name-only"]);
        let tree = write_worktree_tree(&root).unwrap();
        let staged_after = git(&root, &["diff", "--cached", "--name-only"]);
        assert_eq!(staged_before, staged_after);
        let names =
            changed_paths(&root, &git(&root, &["rev-parse", "HEAD^{tree}"]), &tree).unwrap();
        assert_eq!(names, vec!["new.txt", "tracked.txt"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reverse_preview_detects_clean_and_conflicting_worktrees() {
        let root = temp_repo();
        let before_tree = write_worktree_tree(&root).unwrap();
        fs::write(root.join("tracked.txt"), "agent\n").unwrap();
        let after_tree = write_worktree_tree(&root).unwrap();
        let before_commit =
            create_commit(&root, &before_tree, head_commit(&root).as_deref(), "b").unwrap();
        let after_commit = create_commit(&root, &after_tree, Some(&before_commit), "a").unwrap();
        let now = Utc::now();
        let checkpoint = TurnCheckpoint {
            id: "checkpoint-1".into(),
            project_id: "project-1".into(),
            session_id: "session-1".into(),
            turn_id: "turn-1".into(),
            repo_root: root.display().to_string(),
            before_tree,
            before_commit,
            after_tree: Some(after_tree.clone()),
            after_commit: Some(after_commit),
            working_tree_digest: after_tree,
            status: CheckpointStatus::Ready,
            created_at: now,
            updated_at: now,
            changed_paths: vec!["tracked.txt".into()],
            last_error: None,
        };
        assert!(preview_revert(&checkpoint).unwrap().clean);
        fs::write(root.join("tracked.txt"), "user overlap\n").unwrap();
        assert!(!preview_revert(&checkpoint).unwrap().clean);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reverse_patch_preserves_non_overlapping_user_changes_and_index() {
        let root = temp_repo();
        let before_tree = write_worktree_tree(&root).unwrap();
        fs::write(root.join("tracked.txt"), "agent\n").unwrap();
        let after_tree = write_worktree_tree(&root).unwrap();
        fs::write(root.join("user-note.txt"), "keep me\n").unwrap();
        let staged_before = git(&root, &["diff", "--cached", "--name-only"]);

        let patch = diff_patch(&root, &before_tree, &after_tree).unwrap();
        let (clean, _) = run_git_with_input(
            &root,
            &["apply", "--reverse", "--check", "--whitespace=nowarn", "-"],
            &patch,
        )
        .unwrap();
        assert!(clean);
        let (applied, detail) = run_git_with_input(
            &root,
            &["apply", "--reverse", "--whitespace=nowarn", "-"],
            &patch,
        )
        .unwrap();
        assert!(applied, "{detail}");
        // Windows git may rewrite line endings in the worktree.
        let tracked = fs::read_to_string(root.join("tracked.txt"))
            .unwrap()
            .replace("\r\n", "\n");
        let user_note = fs::read_to_string(root.join("user-note.txt"))
            .unwrap()
            .replace("\r\n", "\n");
        assert_eq!(tracked, "before\n");
        assert_eq!(user_note, "keep me\n");
        assert_eq!(
            staged_before,
            git(&root, &["diff", "--cached", "--name-only"])
        );
        let _ = fs::remove_dir_all(root);
    }
}
