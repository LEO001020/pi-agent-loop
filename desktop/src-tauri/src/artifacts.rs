//! Versioned metadata index for durable project artifacts.
//!
//! Artifact content stays in ordinary project files. This store only records
//! identity, provenance, links and revisions so packages can collaborate
//! without hiding user work in a proprietary database.

use std::fs;
use std::path::{Component, Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const SCHEMA_VERSION: u32 = 1;
const MAX_RECORDS: usize = 20_000;
const MAX_TITLE_CHARS: usize = 240;
const MAX_PATH_CHARS: usize = 2_048;
const MAX_SOURCE_IDS: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ArtifactKind {
    Requirement,
    Design,
    Plan,
    Document,
    Prototype,
    Report,
    GeneratedOutput,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactFormat {
    Markdown,
    Html,
    Json,
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactStatus {
    Draft,
    Review,
    Accepted,
    Superseded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRecord {
    pub id: String,
    pub kind: ArtifactKind,
    pub title: String,
    pub project_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub relative_path: String,
    pub format: ArtifactFormat,
    pub revision: u64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub created_by: String,
    #[serde(default)]
    pub source_ids: Vec<String>,
    pub status: ArtifactStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_digest: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactUpsertInput {
    #[serde(default)]
    pub id: Option<String>,
    pub kind: ArtifactKind,
    pub title: String,
    pub project_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    pub relative_path: String,
    pub format: ArtifactFormat,
    #[serde(default)]
    pub expected_revision: Option<u64>,
    #[serde(default)]
    pub created_by: Option<String>,
    #[serde(default)]
    pub source_ids: Vec<String>,
    pub status: ArtifactStatus,
    #[serde(default)]
    pub content_digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactStore {
    #[serde(default = "default_schema_version")]
    schema_version: u32,
    #[serde(default)]
    records: Vec<ArtifactRecord>,
}

impl Default for ArtifactStore {
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
    crate::paths::artifacts_v1_file()
}

fn clean_required(value: &str, label: &str, max_chars: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("ARTIFACT_INVALID: {label} is required"));
    }
    if value.chars().count() > max_chars || value.chars().any(char::is_control) {
        return Err(format!("ARTIFACT_INVALID: invalid {label}"));
    }
    Ok(value.to_string())
}

fn clean_optional_id(value: Option<String>, label: &str) -> Result<Option<String>, String> {
    value.map(|value| clean_id(&value, label)).transpose()
}

fn clean_id(value: &str, label: &str) -> Result<String, String> {
    let value = clean_required(value, label, 160)?;
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
    {
        return Err(format!("ARTIFACT_INVALID: invalid {label}"));
    }
    Ok(value)
}

fn clean_relative_path(value: &str) -> Result<String, String> {
    let value = clean_required(value, "relativePath", MAX_PATH_CHARS)?;
    if value.contains('\\') || Path::new(&value).is_absolute() {
        return Err("ARTIFACT_INVALID: relativePath must stay inside the project".into());
    }
    for component in Path::new(&value).components() {
        match component {
            Component::Normal(_) => {}
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("ARTIFACT_INVALID: relativePath must stay inside the project".into());
            }
        }
    }
    Ok(value)
}

fn clean_digest(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim().to_ascii_lowercase();
    let raw = value.strip_prefix("sha256:").unwrap_or(&value);
    if raw.len() != 64 || !raw.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("ARTIFACT_INVALID: contentDigest must be a SHA-256 digest".into());
    }
    Ok(Some(format!("sha256:{raw}")))
}

fn clean_source_ids(values: Vec<String>) -> Result<Vec<String>, String> {
    if values.len() > MAX_SOURCE_IDS {
        return Err("ARTIFACT_INVALID: too many sourceIds".into());
    }
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        let value = clean_id(&value, "sourceId")?;
        if !out.contains(&value) {
            out.push(value);
        }
    }
    Ok(out)
}

fn quarantine_corrupt(path: &Path) {
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let backup = path.with_extension(format!("corrupt-{stamp}.json"));
    if let Err(error) = fs::rename(path, &backup) {
        tracing::error!(
            "artifact store quarantine failed {}: {error}",
            path.display()
        );
    } else {
        tracing::error!("corrupt artifact store moved to {}", backup.display());
    }
}

fn load_store(path: &Path) -> Result<ArtifactStore, String> {
    let text = match fs::read_to_string(path) {
        Ok(text) if !text.trim().is_empty() => text,
        Ok(_) => return Ok(ArtifactStore::default()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ArtifactStore::default())
        }
        Err(error) => return Err(format!("ARTIFACT_STORE_READ: {error}")),
    };
    let store: ArtifactStore = match serde_json::from_str(&text) {
        Ok(store) => store,
        Err(error) => {
            tracing::error!("corrupt artifact store {}: {error}", path.display());
            quarantine_corrupt(path);
            return Ok(ArtifactStore::default());
        }
    };
    if store.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "ARTIFACT_STORE_UNSUPPORTED_VERSION: expected {SCHEMA_VERSION}, got {}",
            store.schema_version
        ));
    }
    if store.records.len() > MAX_RECORDS {
        return Err("ARTIFACT_STORE_LIMIT: too many records".into());
    }
    Ok(store)
}

fn save_store_under_lock(path: &Path, store: &ArtifactStore) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("ARTIFACT_STORE_SERIALIZE: {error}"))?;
    crate::store_lock::write_bytes_atomic_under_lock(path, &bytes)
        .map_err(|error| format!("ARTIFACT_STORE_WRITE: {error}"))
}

fn upsert_at(path: &Path, input: ArtifactUpsertInput) -> Result<ArtifactRecord, String> {
    let title = clean_required(&input.title, "title", MAX_TITLE_CHARS)?;
    let project_id = clean_id(&input.project_id, "projectId")?;
    let session_id = clean_optional_id(input.session_id, "sessionId")?;
    let relative_path = clean_relative_path(&input.relative_path)?;
    let created_by = clean_required(
        input.created_by.as_deref().unwrap_or("user"),
        "createdBy",
        180,
    )?;
    let source_ids = clean_source_ids(input.source_ids)?;
    let content_digest = clean_digest(input.content_digest)?;
    let requested_id = clean_optional_id(input.id, "id")?;

    crate::store_lock::with_exclusive_lock(path, || {
        let mut store = load_store(path)?;
        let now = Utc::now();

        let record = if let Some(id) = requested_id {
            if let Some(index) = store.records.iter().position(|record| record.id == id) {
                let current = &store.records[index];
                let Some(expected_revision) = input.expected_revision else {
                    return Err("ARTIFACT_REVISION_REQUIRED".into());
                };
                if current.revision != expected_revision {
                    return Err(format!(
                        "ARTIFACT_REVISION_CONFLICT: expected {expected_revision}, current {}",
                        current.revision
                    ));
                }
                let next = ArtifactRecord {
                    id: current.id.clone(),
                    kind: input.kind,
                    title,
                    project_id,
                    session_id,
                    relative_path,
                    format: input.format,
                    revision: current.revision.saturating_add(1),
                    created_at: current.created_at,
                    updated_at: now,
                    created_by: current.created_by.clone(),
                    source_ids,
                    status: input.status,
                    content_digest,
                };
                store.records[index] = next.clone();
                next
            } else {
                if input.expected_revision.unwrap_or(0) != 0 {
                    return Err("ARTIFACT_NOT_FOUND".into());
                }
                ArtifactRecord {
                    id,
                    kind: input.kind,
                    title,
                    project_id,
                    session_id,
                    relative_path,
                    format: input.format,
                    revision: 1,
                    created_at: now,
                    updated_at: now,
                    created_by,
                    source_ids,
                    status: input.status,
                    content_digest,
                }
            }
        } else {
            if input.expected_revision.is_some() {
                return Err("ARTIFACT_INVALID: expectedRevision requires id".into());
            }
            ArtifactRecord {
                id: Uuid::new_v4().to_string(),
                kind: input.kind,
                title,
                project_id,
                session_id,
                relative_path,
                format: input.format,
                revision: 1,
                created_at: now,
                updated_at: now,
                created_by,
                source_ids,
                status: input.status,
                content_digest,
            }
        };

        if !store.records.iter().any(|item| item.id == record.id) {
            if store.records.len() >= MAX_RECORDS {
                return Err("ARTIFACT_STORE_LIMIT: too many records".into());
            }
            store.records.push(record.clone());
        }
        save_store_under_lock(path, &store)?;
        Ok(record)
    })
}

fn delete_at(path: &Path, id: &str, expected_revision: u64) -> Result<(), String> {
    let id = clean_id(id, "id")?;
    crate::store_lock::with_exclusive_lock(path, || {
        let mut store = load_store(path)?;
        let Some(index) = store.records.iter().position(|record| record.id == id) else {
            return Err("ARTIFACT_NOT_FOUND".into());
        };
        if store.records[index].revision != expected_revision {
            return Err(format!(
                "ARTIFACT_REVISION_CONFLICT: expected {expected_revision}, current {}",
                store.records[index].revision
            ));
        }
        store.records.remove(index);
        save_store_under_lock(path, &store)
    })
}

#[tauri::command]
pub fn artifacts_list(
    project_id: Option<String>,
    session_id: Option<String>,
    kind: Option<ArtifactKind>,
) -> Result<Vec<ArtifactRecord>, String> {
    let project_id = clean_optional_id(project_id, "projectId")?;
    let session_id = clean_optional_id(session_id, "sessionId")?;
    let mut records = load_store(&store_path())?.records;
    records.retain(|record| {
        project_id
            .as_ref()
            .is_none_or(|project_id| &record.project_id == project_id)
            && session_id
                .as_ref()
                .is_none_or(|session_id| record.session_id.as_ref() == Some(session_id))
            && kind.is_none_or(|kind| record.kind == kind)
    });
    records.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(records)
}

#[tauri::command]
pub fn artifact_get(id: String) -> Result<Option<ArtifactRecord>, String> {
    let id = clean_id(&id, "id")?;
    Ok(load_store(&store_path())?
        .records
        .into_iter()
        .find(|record| record.id == id))
}

#[tauri::command]
pub fn artifact_upsert(input: ArtifactUpsertInput) -> Result<ArtifactRecord, String> {
    upsert_at(&store_path(), input)
}

/// Remove index metadata only. The referenced project file is never deleted.
#[tauri::command]
pub fn artifact_delete(id: String, expected_revision: u64) -> Result<(), String> {
    delete_at(&store_path(), &id, expected_revision)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> PathBuf {
        std::env::temp_dir().join(format!("pi-artifacts-{}.json", Uuid::new_v4()))
    }

    fn input(id: Option<String>, expected_revision: Option<u64>) -> ArtifactUpsertInput {
        ArtifactUpsertInput {
            id,
            kind: ArtifactKind::Requirement,
            title: "Keyboard workflow".into(),
            project_id: "project-1".into(),
            session_id: Some("session-1".into()),
            relative_path: ".pi/requirements/keyboard.md".into(),
            format: ArtifactFormat::Markdown,
            expected_revision,
            created_by: Some("user".into()),
            source_ids: vec!["message:1".into(), "message:1".into()],
            status: ArtifactStatus::Draft,
            content_digest: Some(format!("sha256:{}", "a".repeat(64))),
        }
    }

    #[test]
    fn creates_updates_and_checks_revision() {
        let path = temp_store();
        let created = upsert_at(&path, input(None, None)).expect("create");
        assert_eq!(created.revision, 1);
        assert_eq!(created.source_ids, vec!["message:1"]);

        let mut update = input(Some(created.id.clone()), Some(1));
        update.title = "Keyboard workflow updated".into();
        let updated = upsert_at(&path, update).expect("update");
        assert_eq!(updated.revision, 2);
        assert_eq!(updated.created_at, created.created_at);
        assert_eq!(updated.created_by, "user");

        let error = upsert_at(&path, input(Some(created.id), Some(1))).unwrap_err();
        assert!(error.contains("ARTIFACT_REVISION_CONFLICT"));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn refuses_paths_outside_project() {
        let path = temp_store();
        let mut value = input(None, None);
        value.relative_path = "../secret.md".into();
        assert!(upsert_at(&path, value)
            .unwrap_err()
            .contains("relativePath"));
    }

    #[test]
    fn delete_removes_metadata_only_after_revision_match() {
        let path = temp_store();
        let created = upsert_at(&path, input(None, None)).expect("create");
        assert!(delete_at(&path, &created.id, 99)
            .unwrap_err()
            .contains("ARTIFACT_REVISION_CONFLICT"));
        delete_at(&path, &created.id, 1).expect("delete");
        assert!(load_store(&path).unwrap().records.is_empty());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn corrupt_store_is_quarantined() {
        let path = temp_store();
        fs::write(&path, "{not-json").unwrap();
        let store = load_store(&path).expect("recover");
        assert!(store.records.is_empty());
        assert!(!path.exists());
        let prefix = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap()
            .to_string();
        if let Some(parent) = path.parent() {
            for entry in fs::read_dir(parent).unwrap().flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with(&prefix) && name.contains(".corrupt-") {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }
}
