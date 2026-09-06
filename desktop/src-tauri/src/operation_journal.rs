//! Durable idempotency journal for host-side mutations.
//!
//! The journal records intent before side effects and lets retries return the
//! previous result instead of repeating an operation after renderer reload or
//! process restart.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

const SCHEMA_VERSION: u32 = 1;
const MAX_RECORDS: usize = 5_000;
const RETAIN_AFTER_PRUNE: usize = 4_000;
const MAX_PAYLOAD_BYTES: usize = 1_048_576;
const MAX_RESULT_BYTES: usize = 2_097_152;
const MAX_ERROR_CHARS: usize = 4_096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OperationStatus {
    Pending,
    Applied,
    Completed,
    Uncertain,
    Failed,
}

impl OperationStatus {
    fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRecord {
    pub operation_id: String,
    pub kind: String,
    pub project_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub payload_fingerprint: String,
    pub status: OperationStatus,
    pub revision: u64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recoverable_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationBeginInput {
    pub operation_id: String,
    pub kind: String,
    pub project_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationTransitionInput {
    pub operation_id: String,
    pub expected_revision: u64,
    pub status: OperationStatus,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub recoverable_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationStore {
    #[serde(default = "default_schema_version")]
    schema_version: u32,
    #[serde(default)]
    records: Vec<OperationRecord>,
}

impl Default for OperationStore {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            records: Vec::new(),
        }
    }
}

fn default_schema_version() -> u32 {
    SCHEMA_VERSION
}

fn store_path() -> PathBuf {
    crate::paths::operations_v1_file()
}

fn clean_id(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 180
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
    {
        return Err(format!("OPERATION_INVALID: invalid {label}"));
    }
    Ok(value.to_string())
}

fn clean_optional_id(value: Option<String>, label: &str) -> Result<Option<String>, String> {
    value.map(|value| clean_id(&value, label)).transpose()
}

fn clean_error(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim().replace('\0', "");
    if value.chars().count() > MAX_ERROR_CHARS {
        return Err("OPERATION_INVALID: recoverableError is too long".into());
    }
    if value.is_empty() {
        Ok(None)
    } else {
        Ok(Some(value))
    }
}

fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(canonicalize).collect()),
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort();
            let mut out = serde_json::Map::new();
            for key in keys {
                out.insert(key.clone(), canonicalize(&values[key]));
            }
            Value::Object(out)
        }
        value => value.clone(),
    }
}

fn checked_json_bytes(value: &Value, limit: usize, label: &str) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(&canonicalize(value))
        .map_err(|error| format!("OPERATION_INVALID: serialize {label}: {error}"))?;
    if bytes.len() > limit {
        return Err(format!("OPERATION_INVALID: {label} exceeds byte limit"));
    }
    Ok(bytes)
}

fn payload_fingerprint(payload: &Value) -> Result<String, String> {
    let bytes = checked_json_bytes(payload, MAX_PAYLOAD_BYTES, "payload")?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

fn quarantine_corrupt(path: &Path) {
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let backup = path.with_extension(format!("corrupt-{stamp}.json"));
    if let Err(error) = fs::rename(path, &backup) {
        tracing::error!(
            "operation journal quarantine failed {}: {error}",
            path.display()
        );
    } else {
        tracing::error!("corrupt operation journal moved to {}", backup.display());
    }
}

fn load_store(path: &Path) -> Result<OperationStore, String> {
    let text = match fs::read_to_string(path) {
        Ok(text) if !text.trim().is_empty() => text,
        Ok(_) => return Ok(OperationStore::default()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(OperationStore::default())
        }
        Err(error) => return Err(format!("OPERATION_STORE_READ: {error}")),
    };
    let store: OperationStore = match serde_json::from_str(&text) {
        Ok(store) => store,
        Err(error) => {
            tracing::error!("corrupt operation journal {}: {error}", path.display());
            quarantine_corrupt(path);
            return Ok(OperationStore::default());
        }
    };
    if store.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "OPERATION_STORE_UNSUPPORTED_VERSION: expected {SCHEMA_VERSION}, got {}",
            store.schema_version
        ));
    }
    if store.records.len() > MAX_RECORDS {
        return Err("OPERATION_STORE_LIMIT: too many records".into());
    }
    Ok(store)
}

fn save_store_under_lock(path: &Path, store: &OperationStore) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("OPERATION_STORE_SERIALIZE: {error}"))?;
    crate::store_lock::write_bytes_atomic_under_lock(path, &bytes)
        .map_err(|error| format!("OPERATION_STORE_WRITE: {error}"))
}

fn prune_terminal_records(store: &mut OperationStore) {
    if store.records.len() < MAX_RECORDS {
        return;
    }
    let mut terminal = store
        .records
        .iter()
        .enumerate()
        .filter(|(_, record)| record.status.is_terminal())
        .map(|(index, record)| (index, record.updated_at))
        .collect::<Vec<_>>();
    terminal.sort_by_key(|(_, updated_at)| *updated_at);
    let remove_count = store.records.len().saturating_sub(RETAIN_AFTER_PRUNE);
    let mut indices = terminal
        .into_iter()
        .take(remove_count)
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    indices.sort_unstable_by(|left, right| right.cmp(left));
    for index in indices {
        store.records.remove(index);
    }
}

fn begin_at(path: &Path, input: OperationBeginInput) -> Result<OperationRecord, String> {
    let operation_id = clean_id(&input.operation_id, "operationId")?;
    let kind = clean_id(&input.kind, "kind")?;
    let project_id = clean_id(&input.project_id, "projectId")?;
    let session_id = clean_optional_id(input.session_id, "sessionId")?;
    let fingerprint = payload_fingerprint(&input.payload)?;

    crate::store_lock::with_exclusive_lock(path, || {
        let mut store = load_store(path)?;
        if let Some(existing) = store
            .records
            .iter()
            .find(|record| record.operation_id == operation_id)
        {
            if existing.payload_fingerprint != fingerprint
                || existing.kind != kind
                || existing.project_id != project_id
                || existing.session_id != session_id
            {
                return Err("OPERATION_ID_CONFLICT".into());
            }
            return Ok(existing.clone());
        }

        prune_terminal_records(&mut store);
        if store.records.len() >= MAX_RECORDS {
            return Err("OPERATION_STORE_LIMIT: no terminal records can be pruned".into());
        }

        let now = Utc::now();
        let record = OperationRecord {
            operation_id,
            kind,
            project_id,
            session_id,
            payload_fingerprint: fingerprint,
            status: OperationStatus::Pending,
            revision: 1,
            created_at: now,
            updated_at: now,
            result: None,
            recoverable_error: None,
        };
        store.records.push(record.clone());
        save_store_under_lock(path, &store)?;
        Ok(record)
    })
}

fn transition_allowed(from: OperationStatus, to: OperationStatus) -> bool {
    match from {
        OperationStatus::Pending => matches!(
            to,
            OperationStatus::Applied
                | OperationStatus::Completed
                | OperationStatus::Uncertain
                | OperationStatus::Failed
        ),
        OperationStatus::Applied => matches!(
            to,
            OperationStatus::Completed | OperationStatus::Uncertain | OperationStatus::Failed
        ),
        OperationStatus::Uncertain => matches!(
            to,
            OperationStatus::Applied | OperationStatus::Completed | OperationStatus::Failed
        ),
        OperationStatus::Completed | OperationStatus::Failed => false,
    }
}

fn transition_at(path: &Path, input: OperationTransitionInput) -> Result<OperationRecord, String> {
    let operation_id = clean_id(&input.operation_id, "operationId")?;
    let recoverable_error = clean_error(input.recoverable_error)?;
    if let Some(result) = input.result.as_ref() {
        checked_json_bytes(result, MAX_RESULT_BYTES, "result")?;
    }
    if input.status == OperationStatus::Pending {
        return Err("OPERATION_INVALID_TRANSITION: use operation_begin".into());
    }

    crate::store_lock::with_exclusive_lock(path, || {
        let mut store = load_store(path)?;
        let Some(index) = store
            .records
            .iter()
            .position(|record| record.operation_id == operation_id)
        else {
            return Err("OPERATION_NOT_FOUND".into());
        };
        let current = &store.records[index];

        if current.status == input.status {
            if current.result == input.result && current.recoverable_error == recoverable_error {
                return Ok(current.clone());
            }
            return Err("OPERATION_TRANSITION_CONFLICT".into());
        }
        if current.revision != input.expected_revision {
            return Err(format!(
                "OPERATION_REVISION_CONFLICT: expected {}, current {}",
                input.expected_revision, current.revision
            ));
        }
        if !transition_allowed(current.status, input.status) {
            return Err(format!(
                "OPERATION_INVALID_TRANSITION: {:?} to {:?}",
                current.status, input.status
            ));
        }

        let mut next = current.clone();
        next.status = input.status;
        next.revision = next.revision.saturating_add(1);
        next.updated_at = Utc::now();
        next.result = input.result;
        next.recoverable_error = recoverable_error;
        store.records[index] = next.clone();
        save_store_under_lock(path, &store)?;
        Ok(next)
    })
}

fn reconcile_incomplete_at(path: &Path) -> Result<usize, String> {
    crate::store_lock::with_exclusive_lock(path, || {
        let mut store = load_store(path)?;
        let mut changed = 0;
        let now = Utc::now();
        for record in &mut store.records {
            if matches!(
                record.status,
                OperationStatus::Pending | OperationStatus::Applied
            ) {
                record.status = OperationStatus::Uncertain;
                record.revision = record.revision.saturating_add(1);
                record.updated_at = now;
                record.recoverable_error =
                    Some("Interrupted before the operation reached a terminal state".into());
                changed += 1;
            }
        }
        if changed > 0 {
            save_store_under_lock(path, &store)?;
        }
        Ok(changed)
    })
}

/// Mark interrupted operations for subsystem-specific reconciliation on startup.
pub fn reconcile_incomplete() -> Result<usize, String> {
    reconcile_incomplete_at(&store_path())
}

pub(crate) fn begin_host_operation(input: OperationBeginInput) -> Result<OperationRecord, String> {
    begin_at(&store_path(), input)
}

pub(crate) fn transition_host_operation(
    input: OperationTransitionInput,
) -> Result<OperationRecord, String> {
    transition_at(&store_path(), input)
}

#[tauri::command]
pub fn operation_begin(input: OperationBeginInput) -> Result<OperationRecord, String> {
    begin_at(&store_path(), input)
}

#[tauri::command]
pub fn operation_transition(input: OperationTransitionInput) -> Result<OperationRecord, String> {
    transition_at(&store_path(), input)
}

#[tauri::command]
pub fn operation_get(operation_id: String) -> Result<Option<OperationRecord>, String> {
    let operation_id = clean_id(&operation_id, "operationId")?;
    Ok(load_store(&store_path())?
        .records
        .into_iter()
        .find(|record| record.operation_id == operation_id))
}

#[tauri::command]
pub fn operations_list(
    project_id: Option<String>,
    session_id: Option<String>,
    status: Option<OperationStatus>,
    limit: Option<usize>,
) -> Result<Vec<OperationRecord>, String> {
    let project_id = clean_optional_id(project_id, "projectId")?;
    let session_id = clean_optional_id(session_id, "sessionId")?;
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let mut records = load_store(&store_path())?.records;
    records.retain(|record| {
        project_id
            .as_ref()
            .is_none_or(|project_id| &record.project_id == project_id)
            && session_id
                .as_ref()
                .is_none_or(|session_id| record.session_id.as_ref() == Some(session_id))
            && status.is_none_or(|status| record.status == status)
    });
    records.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.operation_id.cmp(&right.operation_id))
    });
    records.truncate(limit);
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_store() -> PathBuf {
        std::env::temp_dir().join(format!(
            "pi-operation-journal-{}.json",
            uuid::Uuid::new_v4()
        ))
    }

    fn begin_input(id: &str, payload: Value) -> OperationBeginInput {
        OperationBeginInput {
            operation_id: id.into(),
            kind: "artifact.write".into(),
            project_id: "project-1".into(),
            session_id: Some("session-1".into()),
            payload,
        }
    }

    #[test]
    fn fingerprint_is_stable_across_object_key_order() {
        let left = json!({"a": 1, "b": {"c": true, "d": 2}});
        let right = json!({"b": {"d": 2, "c": true}, "a": 1});
        assert_eq!(
            payload_fingerprint(&left).unwrap(),
            payload_fingerprint(&right).unwrap()
        );
    }

    #[test]
    fn begin_is_idempotent_and_rejects_changed_payload() {
        let path = temp_store();
        let first = begin_at(&path, begin_input("op-1", json!({"value": 1}))).unwrap();
        let retry = begin_at(&path, begin_input("op-1", json!({"value": 1}))).unwrap();
        assert_eq!(first, retry);
        assert_eq!(first.revision, 1);

        let error = begin_at(&path, begin_input("op-1", json!({"value": 2}))).unwrap_err();
        assert_eq!(error, "OPERATION_ID_CONFLICT");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn transition_is_revision_checked_and_retry_safe() {
        let path = temp_store();
        begin_at(&path, begin_input("op-2", json!({}))).unwrap();
        let input = OperationTransitionInput {
            operation_id: "op-2".into(),
            expected_revision: 1,
            status: OperationStatus::Completed,
            result: Some(json!({"ok": true})),
            recoverable_error: None,
        };
        let completed = transition_at(&path, input.clone()).unwrap();
        assert_eq!(completed.revision, 2);
        assert_eq!(transition_at(&path, input).unwrap(), completed);

        let invalid = OperationTransitionInput {
            operation_id: "op-2".into(),
            expected_revision: 2,
            status: OperationStatus::Applied,
            result: None,
            recoverable_error: None,
        };
        assert!(transition_at(&path, invalid)
            .unwrap_err()
            .contains("OPERATION_INVALID_TRANSITION"));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn startup_reconciliation_marks_incomplete_uncertain() {
        let path = temp_store();
        begin_at(&path, begin_input("op-3", json!({}))).unwrap();
        assert_eq!(reconcile_incomplete_at(&path).unwrap(), 1);
        let store = load_store(&path).unwrap();
        assert_eq!(store.records[0].status, OperationStatus::Uncertain);
        assert_eq!(store.records[0].revision, 2);
        assert_eq!(reconcile_incomplete_at(&path).unwrap(), 0);
        let _ = fs::remove_file(&path);
    }
}
