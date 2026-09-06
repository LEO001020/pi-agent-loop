//! Durable, append-only lifecycle ledger for scheduled automation runs.
//!
//! The automation list intentionally keeps only the latest summary. This
//! ledger keeps the complete run lifecycle separately so a run can be traced
//! from dispatch to completion, failure, interruption, or retry without
//! rewriting history.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::sync::Mutex;

use crate::paths;
use crate::store;

static LEDGER_LOCK: Mutex<()> = Mutex::new(());

const MAX_ERROR_CHARS: usize = 1_000;
const MAX_TRIAGE_NOTE_CHARS: usize = 1_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRun {
    pub id: String,
    pub automation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// `schedule`, `manual`, or `retry`.
    pub trigger: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_of: Option<String>,
    #[serde(default = "default_attempt")]
    pub attempt: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheduled_at: Option<DateTime<Utc>>,
    pub started_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub ran_late: bool,
    /// `started`, `dispatched`, `completed`, `failed`, `interrupted`, or
    /// `cancelled`.
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Durable triage state: `none`, `open`, `acknowledged`, or `resolved`.
    #[serde(default = "default_triage")]
    pub triage: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub triage_note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
}

fn default_attempt() -> u32 {
    1
}

fn default_triage() -> String {
    "none".into()
}

fn is_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "interrupted" | "cancelled")
}

fn triage_for_status(status: &str, previous: &str) -> String {
    match status {
        "failed" | "interrupted" | "cancelled" => "open".into(),
        "completed" => "resolved".into(),
        _ => previous.to_string(),
    }
}

fn clean_optional(value: Option<&str>, max_chars: usize) -> Option<String> {
    let value = value.map(store::redact_text)?;
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    Some(value.chars().take(max_chars).collect())
}

fn append_snapshot_to(path: &Path, row: &AutomationRun) -> Result<(), String> {
    let _guard = LEDGER_LOCK
        .lock()
        .map_err(|_| "automation ledger lock poisoned".to_string())?;
    append_snapshot_unlocked(path, row)
}

fn append_snapshot_unlocked(path: &Path, row: &AutomationRun) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, row).map_err(|e| e.to_string())?;
    file.write_all(b"\n").map_err(|e| e.to_string())?;
    file.sync_data().map_err(|e| e.to_string())
}

pub fn load_from(path: &Path) -> Vec<AutomationRun> {
    let Ok(file) = fs::File::open(path) else {
        return Vec::new();
    };
    let mut latest = HashMap::<String, AutomationRun>::new();
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(row) = serde_json::from_str::<AutomationRun>(&line) else {
            continue;
        };
        // The file is append-only, so the last valid snapshot for a run id is
        // authoritative even when two events share the same timestamp.
        latest.insert(row.id.clone(), row);
    }
    let mut rows: Vec<_> = latest.into_values().collect();
    rows.sort_by(|a, b| {
        b.started_at
            .cmp(&a.started_at)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });
    rows
}

pub fn load() -> Vec<AutomationRun> {
    load_from(&paths::automation_runs_file())
}

pub fn list(automation_id: Option<&str>, limit: usize) -> Vec<AutomationRun> {
    let max = limit.clamp(1, 500);
    load()
        .into_iter()
        .filter(|row| automation_id.is_none_or(|id| row.automation_id == id))
        .take(max)
        .collect()
}

// Eight fields describing one run start; a parameter struct here would only
// move the same list one level out. Same call shape as `composer_prefs_set`.
#[allow(clippy::too_many_arguments)]
pub fn start(
    automation_id: &str,
    session_id: Option<&str>,
    trigger: &str,
    retry_of: Option<&str>,
    scheduled_at: Option<DateTime<Utc>>,
    ran_late: bool,
    model_id: Option<&str>,
    effort: Option<&str>,
) -> Result<AutomationRun, String> {
    let automation_id = automation_id.trim();
    if automation_id.is_empty() {
        return Err("automation id required".into());
    }
    let trigger = match trigger.trim() {
        "manual" => "manual",
        "retry" => "retry",
        _ => "schedule",
    };
    let attempt = retry_of
        .and_then(|id| load().into_iter().find(|row| row.id == id))
        .map(|row| row.attempt.saturating_add(1))
        .unwrap_or(1);
    let now = Utc::now();
    let row = AutomationRun {
        id: uuid::Uuid::new_v4().to_string(),
        automation_id: automation_id.to_string(),
        session_id: session_id.map(str::to_string),
        trigger: trigger.to_string(),
        retry_of: retry_of.map(str::to_string),
        attempt,
        scheduled_at,
        started_at: now,
        updated_at: now,
        finished_at: None,
        duration_ms: None,
        ran_late,
        status: "started".into(),
        error: None,
        triage: "none".into(),
        triage_note: None,
        model_id: model_id.map(str::to_string),
        effort: effort.map(str::to_string),
    };
    append_snapshot_to(&paths::automation_runs_file(), &row)?;
    Ok(row)
}

pub fn attach_session(run_id: &str, session_id: &str) -> Result<AutomationRun, String> {
    update_at(&paths::automation_runs_file(), run_id, |row| {
        row.session_id = Some(session_id.trim().to_string());
    })
}

pub fn mark_dispatched(run_id: &str) -> Result<AutomationRun, String> {
    update_at(&paths::automation_runs_file(), run_id, |row| {
        if !is_terminal(&row.status) {
            row.status = "dispatched".into();
        }
    })
}

pub fn finish(
    run_id: &str,
    status: &str,
    duration_ms: Option<u64>,
    error: Option<&str>,
) -> Result<AutomationRun, String> {
    let status = match status {
        "completed" | "failed" | "interrupted" | "cancelled" => status,
        _ => return Err(format!("invalid automation run status: {status}")),
    };
    update_at(&paths::automation_runs_file(), run_id, |row| {
        if is_terminal(&row.status) {
            return;
        }
        let finished_at = Utc::now();
        row.status = status.to_string();
        row.finished_at = Some(finished_at);
        row.duration_ms = duration_ms.or_else(|| {
            finished_at
                .signed_duration_since(row.started_at)
                .num_milliseconds()
                .try_into()
                .ok()
        });
        row.error = clean_optional(error, MAX_ERROR_CHARS);
        row.triage = triage_for_status(status, &row.triage);
    })
}

pub fn set_triage(run_id: &str, triage: &str, note: Option<&str>) -> Result<AutomationRun, String> {
    let triage = match triage.trim() {
        "none" | "open" | "acknowledged" | "resolved" => triage.trim(),
        _ => return Err("invalid automation triage state".into()),
    };
    update_at(&paths::automation_runs_file(), run_id, |row| {
        row.triage = triage.to_string();
        row.triage_note = clean_optional(note, MAX_TRIAGE_NOTE_CHARS);
    })
}

fn update_at<F>(path: &Path, run_id: &str, mutate: F) -> Result<AutomationRun, String>
where
    F: FnOnce(&mut AutomationRun),
{
    let _guard = LEDGER_LOCK
        .lock()
        .map_err(|_| "automation ledger lock poisoned".to_string())?;
    let mut rows = load_from(path);
    let row = rows
        .iter_mut()
        .find(|row| row.id == run_id)
        .ok_or_else(|| "automation run not found".to_string())?;
    mutate(row);
    row.updated_at = Utc::now();
    let next = row.clone();
    append_snapshot_unlocked(path, &next)?;
    Ok(next)
}

/// Mark in-flight runs as interrupted after an app restart.
///
/// A dispatched run is not silently presented as successful when its owning
/// process disappeared. The caller can run this once during startup; the
/// session journal remains available for inspection and retry.
pub fn reconcile_stale(max_age: Duration) -> Result<usize, String> {
    let cutoff = Utc::now() - max_age;
    let stale: Vec<String> = load()
        .into_iter()
        .filter(|row| {
            matches!(row.status.as_str(), "started" | "dispatched") && row.updated_at <= cutoff
        })
        .map(|row| row.id)
        .collect();
    let mut count = 0;
    for id in stale {
        if let Ok(row) = finish(
            &id,
            "interrupted",
            None,
            Some("app restarted before the automation run completed"),
        ) {
            let _ = store::mark_automation_run_outcome(
                &row.automation_id,
                row.started_at,
                &row.status,
                row.error.as_deref(),
            );
            count += 1;
        }
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "pi-app-automation-runs-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn row(id: &str, status: &str, updated_at: DateTime<Utc>) -> AutomationRun {
        AutomationRun {
            id: id.into(),
            automation_id: "auto-1".into(),
            session_id: Some("session-1".into()),
            trigger: "schedule".into(),
            retry_of: None,
            attempt: 1,
            scheduled_at: None,
            started_at: updated_at,
            updated_at,
            finished_at: None,
            duration_ms: None,
            ran_late: false,
            status: status.into(),
            error: None,
            triage: "none".into(),
            triage_note: None,
            model_id: Some("model".into()),
            effort: Some("medium".into()),
        }
    }

    #[test]
    fn append_only_updates_fold_to_the_latest_snapshot() {
        let path = temp_path("fold");
        let started = row("run-1", "started", Utc::now());
        append_snapshot_to(&path, &started).unwrap();
        let mut completed = started.clone();
        completed.status = "completed".into();
        completed.updated_at = Utc::now();
        completed.finished_at = completed.updated_at.into();
        append_snapshot_to(&path, &completed).unwrap();

        let rows = load_from(&path);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, "completed");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn terminal_finish_is_idempotent() {
        let path = temp_path("terminal");
        let started = row("run-1", "started", Utc::now());
        append_snapshot_to(&path, &started).unwrap();
        let first = update_at(&path, "run-1", |row| {
            row.status = "completed".into();
        })
        .unwrap();
        let second = update_at(&path, "run-1", |row| {
            if is_terminal(&row.status) {
                return;
            }
            row.status = "failed".into();
        })
        .unwrap();
        assert_eq!(first.status, "completed");
        assert_eq!(second.status, "completed");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn malformed_lines_are_ignored_without_losing_valid_history() {
        let path = temp_path("malformed");
        fs::write(&path, "not-json\n").unwrap();
        let valid = row("run-1", "failed", Utc::now());
        append_snapshot_to(&path, &valid).unwrap();
        assert_eq!(load_from(&path), vec![valid]);
        let _ = fs::remove_file(path);
    }
}
