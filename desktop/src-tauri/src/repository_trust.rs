//! Review and digest-bound trust for repository-owned capabilities.
//!
//! `.pi/project.json` is parsed as data only. This module never starts an MCP
//! server, loads a skill, or runs a script while reviewing the file. Trust is
//! tied to the canonical repository root, the exact config bytes, referenced
//! local files, and this local app identity.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::operation_journal::{
    begin_host_operation, transition_host_operation, OperationBeginInput, OperationStatus,
    OperationTransitionInput,
};

const SCHEMA_VERSION: u32 = 1;
const CONFIG_VERSION: u32 = 1;
const CONFIG_RELATIVE_PATH: &str = ".pi/project.json";
const MAX_CONFIG_BYTES: u64 = 256 * 1024;
const MAX_ENTRIES: usize = 128;
const MAX_ARGS: usize = 128;
const MAX_ENV_NAMES: usize = 128;
const MAX_NETWORK_HOSTS: usize = 128;
const MAX_MANIFEST_FILES: usize = 256;
const MAX_HASHED_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_HASHED_TOTAL_BYTES: u64 = 32 * 1024 * 1024;
const MAX_APPROVALS: usize = 2_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum ApprovalDecision {
    Approved,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryApproval {
    root: String,
    config_digest: String,
    identity_id: String,
    decision: ApprovalDecision,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryTrustStore {
    #[serde(default = "default_schema_version")]
    schema_version: u32,
    #[serde(default)]
    approvals: Vec<RepositoryApproval>,
}

impl Default for RepositoryTrustStore {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            approvals: Vec::new(),
        }
    }
}

fn default_schema_version() -> u32 {
    SCHEMA_VERSION
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RepositoryConfig {
    version: u32,
    #[serde(default)]
    mcp_servers: Vec<CommandContribution>,
    #[serde(default)]
    skills: Vec<SkillContribution>,
    #[serde(default)]
    scripts: Vec<CommandContribution>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommandContribution {
    id: String,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    env: Vec<String>,
    #[serde(default)]
    network_hosts: Vec<String>,
    #[serde(default)]
    manifest_files: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SkillContribution {
    id: String,
    path: String,
    #[serde(default)]
    manifest_files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryContributionReview {
    pub kind: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env_names: Vec<String>,
    #[serde(default)]
    pub network_hosts: Vec<String>,
    #[serde(default)]
    pub files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryTrustReview {
    pub project_id: String,
    pub project_trusted: bool,
    pub config_path: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub short_digest: Option<String>,
    #[serde(default)]
    pub contributions: Vec<RepositoryContributionReview>,
    #[serde(default)]
    pub issues: Vec<String>,
    pub can_approve: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RepositoryTrustMode {
    Once,
    Digest,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryTrustApproveInput {
    pub project_id: String,
    pub expected_digest: String,
    pub mode: RepositoryTrustMode,
    #[serde(default)]
    pub operation_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryTrustDecisionInput {
    pub project_id: String,
    pub expected_digest: String,
    pub operation_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryTrustRevokeInput {
    pub project_id: String,
    pub operation_id: String,
}

#[derive(Debug)]
struct ValidatedConfig {
    digest: String,
    contributions: Vec<RepositoryContributionReview>,
}

static ONCE_APPROVALS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn once_approvals() -> &'static Mutex<HashSet<String>> {
    ONCE_APPROVALS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn store_path() -> PathBuf {
    crate::paths::repository_trust_v1_file()
}

fn local_identity_id() -> String {
    let home = crate::process_util::user_home();
    let stable = fs::canonicalize(&home).unwrap_or(home);
    let mut hasher = Sha256::new();
    hasher.update(b"pi-app:repository-trust:identity:v1\0");
    hasher.update(stable.to_string_lossy().as_bytes());
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn clean_id(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 180
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
    {
        return Err(format!("REPOSITORY_TRUST_INVALID: invalid {label}"));
    }
    Ok(value.to_string())
}

fn clean_digest(value: &str) -> Result<String, String> {
    let value = value.trim().to_ascii_lowercase();
    let raw = value.strip_prefix("sha256:").unwrap_or(&value);
    if raw.len() != 64 || !raw.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("REPOSITORY_TRUST_INVALID: invalid digest".into());
    }
    Ok(format!("sha256:{raw}"))
}

fn clean_text(value: &str, label: &str, max: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max || value.chars().any(char::is_control) {
        return Err(format!("REPOSITORY_CONFIG_INVALID: invalid {label}"));
    }
    Ok(value.to_string())
}

fn quarantine_corrupt(path: &Path) {
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let backup = path.with_extension(format!("corrupt-{stamp}.json"));
    if let Err(error) = fs::rename(path, &backup) {
        tracing::error!(
            "repository trust quarantine failed {}: {error}",
            path.display()
        );
    } else {
        tracing::error!(
            "corrupt repository trust store moved to {}",
            backup.display()
        );
    }
}

fn load_store(path: &Path) -> Result<RepositoryTrustStore, String> {
    let text = match fs::read_to_string(path) {
        Ok(text) if !text.trim().is_empty() => text,
        Ok(_) => return Ok(RepositoryTrustStore::default()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(RepositoryTrustStore::default())
        }
        Err(error) => return Err(format!("REPOSITORY_TRUST_STORE_READ: {error}")),
    };
    let store: RepositoryTrustStore = match serde_json::from_str(&text) {
        Ok(store) => store,
        Err(error) => {
            tracing::error!("corrupt repository trust store {}: {error}", path.display());
            quarantine_corrupt(path);
            return Ok(RepositoryTrustStore::default());
        }
    };
    if store.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "REPOSITORY_TRUST_STORE_UNSUPPORTED_VERSION: expected {SCHEMA_VERSION}, got {}",
            store.schema_version
        ));
    }
    if store.approvals.len() > MAX_APPROVALS {
        return Err("REPOSITORY_TRUST_STORE_LIMIT: too many approvals".into());
    }
    Ok(store)
}

fn save_store_under_lock(path: &Path, store: &RepositoryTrustStore) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("REPOSITORY_TRUST_STORE_SERIALIZE: {error}"))?;
    crate::store_lock::write_bytes_atomic_under_lock(path, &bytes)
        .map_err(|error| format!("REPOSITORY_TRUST_STORE_WRITE: {error}"))
}

fn project(project_id: &str) -> Result<(crate::store::Project, PathBuf), String> {
    let project_id = clean_id(project_id, "projectId")?;
    let project = crate::store::load_projects()
        .into_iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "REPOSITORY_TRUST_PROJECT_NOT_FOUND".to_string())?;
    let root = fs::canonicalize(&project.path)
        .map_err(|error| format!("REPOSITORY_TRUST_PROJECT_PATH: {error}"))?;
    if !root.is_dir() {
        return Err("REPOSITORY_TRUST_PROJECT_PATH: root is not a directory".into());
    }
    Ok((project, root))
}

fn inside(root: &Path, path: &Path, label: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("REPOSITORY_CONFIG_INVALID: {label}: {error}"))?;
    if canonical.strip_prefix(root).is_err() {
        return Err(format!(
            "REPOSITORY_CONFIG_PATH_ESCAPE: {label} leaves the project root"
        ));
    }
    Ok(canonical)
}

fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn resolve_inside(root: &Path, value: &str, label: &str) -> Result<PathBuf, String> {
    let value = clean_text(value, label, 2_048)?;
    let relative = Path::new(&value);
    if relative.is_absolute() {
        return Err(format!(
            "REPOSITORY_CONFIG_INVALID: {label} must be project-relative"
        ));
    }
    inside(root, &root.join(relative), label)
}

fn resolve_command(root: &Path, value: &str) -> Result<PathBuf, String> {
    let value = clean_text(value, "command", 2_048)?;
    let command = Path::new(&value);
    let resolved = if command.is_absolute() {
        fs::canonicalize(command)
            .map_err(|error| format!("REPOSITORY_CONFIG_COMMAND_MISSING: {error}"))?
    } else if value.contains('/') || value.contains('\\') {
        inside(root, &root.join(command), "command")?
    } else {
        let path = std::env::var_os("PATH")
            .ok_or("REPOSITORY_CONFIG_COMMAND_MISSING: PATH is unavailable")?;
        let mut found = None;
        for directory in std::env::split_paths(&path) {
            let candidate = directory.join(&value);
            if candidate.is_file() {
                found = fs::canonicalize(candidate).ok();
                if found.is_some() {
                    break;
                }
            }
            #[cfg(target_os = "windows")]
            {
                let candidate = directory.join(format!("{value}.exe"));
                if candidate.is_file() {
                    found = fs::canonicalize(candidate).ok();
                    if found.is_some() {
                        break;
                    }
                }
            }
        }
        found.ok_or_else(|| {
            format!("REPOSITORY_CONFIG_COMMAND_MISSING: executable {value} was not found")
        })?
    };
    if !resolved.is_file() {
        return Err("REPOSITORY_CONFIG_COMMAND_MISSING: command is not a file".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if fs::metadata(&resolved)
            .map_err(|error| format!("REPOSITORY_CONFIG_COMMAND_MISSING: {error}"))?
            .permissions()
            .mode()
            & 0o111
            == 0
        {
            return Err("REPOSITORY_CONFIG_COMMAND_NOT_EXECUTABLE".into());
        }
    }
    Ok(resolved)
}

fn validate_args(values: &[String]) -> Result<Vec<String>, String> {
    if values.len() > MAX_ARGS {
        return Err("REPOSITORY_CONFIG_LIMIT: too many arguments".into());
    }
    values
        .iter()
        .map(|value| clean_text(value, "argument", 4_096))
        .collect()
}

fn validate_env_names(values: &[String]) -> Result<Vec<String>, String> {
    if values.len() > MAX_ENV_NAMES {
        return Err("REPOSITORY_CONFIG_LIMIT: too many environment names".into());
    }
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        let value = clean_text(value, "environment name", 160)?;
        let mut chars = value.chars();
        let first = chars
            .next()
            .ok_or("REPOSITORY_CONFIG_INVALID: empty environment name")?;
        if !(first.is_ascii_alphabetic() || first == '_')
            || !chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            return Err("REPOSITORY_CONFIG_INVALID: invalid environment name".into());
        }
        if !out.contains(&value) {
            out.push(value);
        }
    }
    Ok(out)
}

fn validate_network_hosts(values: &[String]) -> Result<Vec<String>, String> {
    if values.len() > MAX_NETWORK_HOSTS {
        return Err("REPOSITORY_CONFIG_LIMIT: too many network hosts".into());
    }
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        let value = clean_text(value, "network host", 255)?.to_ascii_lowercase();
        if value.contains('*')
            || value.contains('/')
            || value.contains('@')
            || value.chars().any(char::is_whitespace)
        {
            return Err("REPOSITORY_CONFIG_INVALID: network host must be exact".into());
        }
        let parsed = url::Url::parse(&format!("https://{value}/"))
            .map_err(|_| "REPOSITORY_CONFIG_INVALID: invalid network host".to_string())?;
        if parsed.host_str().is_none()
            || parsed.path() != "/"
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err("REPOSITORY_CONFIG_INVALID: invalid network host".into());
        }
        if !out.contains(&value) {
            out.push(value);
        }
    }
    Ok(out)
}

fn resolve_manifest_files(
    root: &Path,
    values: &[String],
) -> Result<Vec<(String, PathBuf)>, String> {
    if values.len() > MAX_MANIFEST_FILES {
        return Err("REPOSITORY_CONFIG_LIMIT: too many manifest files".into());
    }
    let mut out = Vec::with_capacity(values.len());
    for value in values {
        let path = resolve_inside(root, value, "manifest file")?;
        if !path.is_file() {
            return Err("REPOSITORY_CONFIG_INVALID: manifest path is not a file".into());
        }
        let display = relative_display(root, &path);
        if !out.iter().any(|(existing, _)| existing == &display) {
            out.push((display, path));
        }
    }
    Ok(out)
}

fn append_file_digest(
    hasher: &mut Sha256,
    root: &Path,
    path: &Path,
    total_bytes: &mut u64,
) -> Result<(), String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("REPOSITORY_CONFIG_HASH_FAILED: {error}"))?;
    if metadata.len() > MAX_HASHED_FILE_BYTES
        || total_bytes.saturating_add(metadata.len()) > MAX_HASHED_TOTAL_BYTES
    {
        return Err("REPOSITORY_CONFIG_LIMIT: referenced files are too large".into());
    }
    let bytes =
        fs::read(path).map_err(|error| format!("REPOSITORY_CONFIG_HASH_FAILED: {error}"))?;
    *total_bytes += bytes.len() as u64;
    hasher.update(relative_display(root, path).as_bytes());
    hasher.update([0]);
    hasher.update(&bytes);
    hasher.update([0]);
    Ok(())
}

fn validate_command_contribution(
    root: &Path,
    kind: &str,
    contribution: &CommandContribution,
    seen_ids: &mut HashSet<String>,
    digest_files: &mut Vec<PathBuf>,
) -> Result<RepositoryContributionReview, String> {
    let id = clean_id(&contribution.id, "contribution id")?;
    if !seen_ids.insert(id.clone()) {
        return Err(format!("REPOSITORY_CONFIG_INVALID: duplicate id {id}"));
    }
    let executable = resolve_command(root, &contribution.command)?;
    let args = validate_args(&contribution.args)?;
    let cwd = match contribution.cwd.as_deref() {
        Some(value) => {
            let path = resolve_inside(root, value, "cwd")?;
            if !path.is_dir() {
                return Err("REPOSITORY_CONFIG_INVALID: cwd is not a directory".into());
            }
            Some(relative_display(root, &path))
        }
        None => Some(".".into()),
    };
    let env_names = validate_env_names(&contribution.env)?;
    let network_hosts = validate_network_hosts(&contribution.network_hosts)?;
    let manifests = resolve_manifest_files(root, &contribution.manifest_files)?;
    let mut files = manifests
        .iter()
        .map(|(display, _)| display.clone())
        .collect::<Vec<_>>();
    digest_files.extend(manifests.into_iter().map(|(_, path)| path));
    if executable.starts_with(root) {
        let display = relative_display(root, &executable);
        if !files.contains(&display) {
            files.push(display);
        }
        digest_files.push(executable.clone());
    }
    Ok(RepositoryContributionReview {
        kind: kind.into(),
        id,
        executable: Some(executable.to_string_lossy().to_string()),
        args,
        cwd,
        env_names,
        network_hosts,
        files,
    })
}

fn validate_skill_contribution(
    root: &Path,
    contribution: &SkillContribution,
    seen_ids: &mut HashSet<String>,
    digest_files: &mut Vec<PathBuf>,
) -> Result<RepositoryContributionReview, String> {
    let id = clean_id(&contribution.id, "contribution id")?;
    if !seen_ids.insert(id.clone()) {
        return Err(format!("REPOSITORY_CONFIG_INVALID: duplicate id {id}"));
    }
    let selected = resolve_inside(root, &contribution.path, "skill path")?;
    let skill_file = if selected.is_dir() {
        inside(root, &selected.join("SKILL.md"), "skill SKILL.md")?
    } else {
        selected
    };
    if !skill_file.is_file() {
        return Err("REPOSITORY_CONFIG_INVALID: skill path is not a file".into());
    }
    let manifests = resolve_manifest_files(root, &contribution.manifest_files)?;
    let mut files = vec![relative_display(root, &skill_file)];
    digest_files.push(skill_file);
    for (display, path) in manifests {
        if !files.contains(&display) {
            files.push(display);
        }
        digest_files.push(path);
    }
    Ok(RepositoryContributionReview {
        kind: "skill".into(),
        id,
        executable: None,
        args: Vec::new(),
        cwd: None,
        env_names: Vec::new(),
        network_hosts: Vec::new(),
        files,
    })
}

fn validate_config(root: &Path, config_path: &Path) -> Result<ValidatedConfig, String> {
    let root = fs::canonicalize(root)
        .map_err(|error| format!("REPOSITORY_TRUST_PROJECT_PATH: {error}"))?;
    let root = root.as_path();
    let config_path = inside(root, config_path, "config path")?;
    if !config_path.is_file() {
        return Err("REPOSITORY_CONFIG_INVALID: config path is not a file".into());
    }
    let metadata =
        fs::metadata(&config_path).map_err(|error| format!("REPOSITORY_CONFIG_READ: {error}"))?;
    if metadata.len() > MAX_CONFIG_BYTES {
        return Err("REPOSITORY_CONFIG_LIMIT: config is too large".into());
    }
    let bytes =
        fs::read(&config_path).map_err(|error| format!("REPOSITORY_CONFIG_READ: {error}"))?;
    let config: RepositoryConfig = serde_json::from_slice(&bytes)
        .map_err(|error| format!("REPOSITORY_CONFIG_INVALID: {error}"))?;
    if config.version != CONFIG_VERSION {
        return Err(format!(
            "REPOSITORY_CONFIG_UNSUPPORTED_VERSION: expected {CONFIG_VERSION}, got {}",
            config.version
        ));
    }
    let entry_count = config.mcp_servers.len() + config.skills.len() + config.scripts.len();
    if entry_count > MAX_ENTRIES {
        return Err("REPOSITORY_CONFIG_LIMIT: too many contributions".into());
    }

    let mut seen_ids = HashSet::new();
    let mut digest_files = Vec::new();
    let mut contributions = Vec::with_capacity(entry_count);
    for contribution in &config.mcp_servers {
        contributions.push(validate_command_contribution(
            root,
            "mcp",
            contribution,
            &mut seen_ids,
            &mut digest_files,
        )?);
    }
    for contribution in &config.skills {
        contributions.push(validate_skill_contribution(
            root,
            contribution,
            &mut seen_ids,
            &mut digest_files,
        )?);
    }
    for contribution in &config.scripts {
        contributions.push(validate_command_contribution(
            root,
            "script",
            contribution,
            &mut seen_ids,
            &mut digest_files,
        )?);
    }

    digest_files.sort();
    digest_files.dedup();
    let mut hasher = Sha256::new();
    hasher.update(b"pi-app:repository-config:v1\0");
    hasher.update(root.to_string_lossy().as_bytes());
    hasher.update([0]);
    hasher.update(&bytes);
    hasher.update([0]);
    let mut total_bytes = 0;
    for path in digest_files {
        append_file_digest(&mut hasher, root, &path, &mut total_bytes)?;
    }
    Ok(ValidatedConfig {
        digest: format!("sha256:{}", hex::encode(hasher.finalize())),
        contributions,
    })
}

fn once_key(root: &Path, digest: &str, identity_id: &str) -> String {
    format!("{}\0{digest}\0{identity_id}", root.to_string_lossy())
}

fn review_with(
    project_id: &str,
    project_trusted: bool,
    root: &Path,
    approvals: &[RepositoryApproval],
    identity_id: &str,
) -> RepositoryTrustReview {
    let config_candidate = root.join(CONFIG_RELATIVE_PATH);
    let config_path = config_candidate.to_string_lossy().to_string();
    let metadata = match fs::symlink_metadata(&config_candidate) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return RepositoryTrustReview {
                project_id: project_id.into(),
                project_trusted,
                config_path,
                status: "missing".into(),
                digest: None,
                short_digest: None,
                contributions: Vec::new(),
                issues: Vec::new(),
                can_approve: false,
            }
        }
        Err(error) => {
            return RepositoryTrustReview {
                project_id: project_id.into(),
                project_trusted,
                config_path,
                status: "invalid".into(),
                digest: None,
                short_digest: None,
                contributions: Vec::new(),
                issues: vec![format!("REPOSITORY_CONFIG_READ: {error}")],
                can_approve: false,
            }
        }
    };
    if !metadata.file_type().is_file() && !metadata.file_type().is_symlink() {
        return RepositoryTrustReview {
            project_id: project_id.into(),
            project_trusted,
            config_path,
            status: "invalid".into(),
            digest: None,
            short_digest: None,
            contributions: Vec::new(),
            issues: vec!["REPOSITORY_CONFIG_INVALID: config path is not a file".into()],
            can_approve: false,
        };
    }
    let validated = match validate_config(root, &config_candidate) {
        Ok(validated) => validated,
        Err(error) => {
            return RepositoryTrustReview {
                project_id: project_id.into(),
                project_trusted,
                config_path,
                status: "invalid".into(),
                digest: None,
                short_digest: None,
                contributions: Vec::new(),
                issues: vec![error],
                can_approve: false,
            }
        }
    };
    let short_digest = validated
        .digest
        .strip_prefix("sha256:")
        .unwrap_or(&validated.digest)
        .chars()
        .take(12)
        .collect::<String>();
    let matching = approvals.iter().find(|approval| {
        approval.root == root.to_string_lossy()
            && approval.config_digest == validated.digest
            && approval.identity_id == identity_id
    });
    let has_old_approval = approvals.iter().any(|approval| {
        approval.root == root.to_string_lossy()
            && approval.identity_id == identity_id
            && approval.decision == ApprovalDecision::Approved
            && approval.config_digest != validated.digest
    });
    let approved_once = once_approvals()
        .lock()
        .map(|approvals| approvals.contains(&once_key(root, &validated.digest, identity_id)))
        .unwrap_or(false);
    let status = if !project_trusted {
        "project-untrusted"
    } else if approved_once {
        "trusted-once"
    } else {
        match matching.map(|approval| approval.decision) {
            Some(ApprovalDecision::Approved) => "trusted",
            Some(ApprovalDecision::Rejected) => "rejected",
            None if has_old_approval => "changed",
            None => "untrusted",
        }
    };
    RepositoryTrustReview {
        project_id: project_id.into(),
        project_trusted,
        config_path,
        status: status.into(),
        digest: Some(validated.digest),
        short_digest: Some(short_digest),
        contributions: validated.contributions,
        issues: Vec::new(),
        can_approve: project_trusted,
    }
}

fn current_review(project_id: &str) -> Result<RepositoryTrustReview, String> {
    let (project, root) = project(project_id)?;
    let approvals = load_store(&store_path())?.approvals;
    Ok(review_with(
        &project.id,
        project.trusted,
        &root,
        &approvals,
        &local_identity_id(),
    ))
}

fn completed_review(
    operation: &crate::operation_journal::OperationRecord,
) -> Result<Option<RepositoryTrustReview>, String> {
    if operation.status != OperationStatus::Completed {
        return Ok(None);
    }
    let value = operation
        .result
        .clone()
        .ok_or("REPOSITORY_TRUST_OPERATION_RESULT_MISSING")?;
    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| format!("REPOSITORY_TRUST_OPERATION_RESULT_INVALID: {error}"))
}

fn persist_decision(
    input: &RepositoryTrustDecisionInput,
    decision: ApprovalDecision,
) -> Result<RepositoryTrustReview, String> {
    let project_id = clean_id(&input.project_id, "projectId")?;
    let operation_id = clean_id(&input.operation_id, "operationId")?;
    let expected_digest = clean_digest(&input.expected_digest)?;
    let (project, root) = project(&project_id)?;
    if !project.trusted {
        return Err("REPOSITORY_TRUST_PROJECT_UNTRUSTED".into());
    }
    let review = current_review(&project_id)?;
    if review.digest.as_deref() != Some(expected_digest.as_str()) || !review.can_approve {
        return Err("REPOSITORY_TRUST_CONFIG_CHANGED".into());
    }
    let kind = match decision {
        ApprovalDecision::Approved => "repository.trust.approve",
        ApprovalDecision::Rejected => "repository.trust.reject",
    };
    let operation = begin_host_operation(OperationBeginInput {
        operation_id: operation_id.clone(),
        kind: kind.into(),
        project_id: project_id.clone(),
        session_id: None,
        payload: json!({
            "configDigest": expected_digest,
            "root": root.to_string_lossy(),
        }),
    })?;
    if let Some(review) = completed_review(&operation)? {
        return Ok(review);
    }
    if operation.status != OperationStatus::Pending {
        return Err(format!(
            "OPERATION_RECONCILIATION_REQUIRED: {:?}",
            operation.status
        ));
    }

    let path = store_path();
    let identity_id = local_identity_id();
    let write_result = crate::store_lock::with_exclusive_lock(&path, || {
        let mut store = load_store(&path)?;
        store.approvals.retain(|approval| {
            !(approval.root == root.to_string_lossy()
                && approval.config_digest == expected_digest
                && approval.identity_id == identity_id)
        });
        store.approvals.push(RepositoryApproval {
            root: root.to_string_lossy().to_string(),
            config_digest: expected_digest.clone(),
            identity_id: identity_id.clone(),
            decision,
            updated_at: Utc::now(),
        });
        if store.approvals.len() > MAX_APPROVALS {
            store.approvals.sort_by_key(|approval| approval.updated_at);
            let remove = store.approvals.len() - MAX_APPROVALS;
            store.approvals.drain(0..remove);
        }
        save_store_under_lock(&path, &store)
    });
    if let Err(error) = write_result {
        let _ = transition_host_operation(OperationTransitionInput {
            operation_id,
            expected_revision: operation.revision,
            status: OperationStatus::Failed,
            result: None,
            recoverable_error: Some(error.clone()),
        });
        return Err(error);
    }
    let review = current_review(&project_id)?;
    let result = serde_json::to_value(&review)
        .map_err(|error| format!("REPOSITORY_TRUST_RESULT_SERIALIZE: {error}"))?;
    transition_host_operation(OperationTransitionInput {
        operation_id,
        expected_revision: operation.revision,
        status: OperationStatus::Completed,
        result: Some(result),
        recoverable_error: None,
    })?;
    Ok(review)
}

#[tauri::command]
pub fn repository_trust_review(project_id: String) -> Result<RepositoryTrustReview, String> {
    current_review(&project_id)
}

#[tauri::command]
pub fn repository_trust_approve(
    input: RepositoryTrustApproveInput,
) -> Result<RepositoryTrustReview, String> {
    let project_id = clean_id(&input.project_id, "projectId")?;
    let expected_digest = clean_digest(&input.expected_digest)?;
    if input.mode == RepositoryTrustMode::Once {
        let (project, root) = project(&project_id)?;
        if !project.trusted {
            return Err("REPOSITORY_TRUST_PROJECT_UNTRUSTED".into());
        }
        let review = current_review(&project_id)?;
        if review.digest.as_deref() != Some(expected_digest.as_str()) || !review.can_approve {
            return Err("REPOSITORY_TRUST_CONFIG_CHANGED".into());
        }
        once_approvals()
            .lock()
            .map_err(|_| "REPOSITORY_TRUST_LOCK_POISONED".to_string())?
            .insert(once_key(&root, &expected_digest, &local_identity_id()));
        return current_review(&project_id);
    }
    let operation_id = input
        .operation_id
        .ok_or("REPOSITORY_TRUST_INVALID: operationId is required")?;
    persist_decision(
        &RepositoryTrustDecisionInput {
            project_id,
            expected_digest,
            operation_id,
        },
        ApprovalDecision::Approved,
    )
}

#[tauri::command]
pub fn repository_trust_reject(
    input: RepositoryTrustDecisionInput,
) -> Result<RepositoryTrustReview, String> {
    persist_decision(&input, ApprovalDecision::Rejected)
}

#[tauri::command]
pub fn repository_trust_revoke(
    input: RepositoryTrustRevokeInput,
) -> Result<RepositoryTrustReview, String> {
    let project_id = clean_id(&input.project_id, "projectId")?;
    let operation_id = clean_id(&input.operation_id, "operationId")?;
    let (_project, root) = project(&project_id)?;
    let identity_id = local_identity_id();
    let operation = begin_host_operation(OperationBeginInput {
        operation_id: operation_id.clone(),
        kind: "repository.trust.revoke".into(),
        project_id: project_id.clone(),
        session_id: None,
        payload: json!({ "root": root.to_string_lossy() }),
    })?;
    if let Some(review) = completed_review(&operation)? {
        return Ok(review);
    }
    if operation.status != OperationStatus::Pending {
        return Err(format!(
            "OPERATION_RECONCILIATION_REQUIRED: {:?}",
            operation.status
        ));
    }
    let path = store_path();
    let write_result = crate::store_lock::with_exclusive_lock(&path, || {
        let mut store = load_store(&path)?;
        store.approvals.retain(|approval| {
            !(approval.root == root.to_string_lossy() && approval.identity_id == identity_id)
        });
        save_store_under_lock(&path, &store)
    });
    if let Ok(mut approvals) = once_approvals().lock() {
        let prefix = format!("{}\0", root.to_string_lossy());
        approvals.retain(|key| !key.starts_with(&prefix));
    }
    if let Err(error) = write_result {
        let _ = transition_host_operation(OperationTransitionInput {
            operation_id,
            expected_revision: operation.revision,
            status: OperationStatus::Failed,
            result: None,
            recoverable_error: Some(error.clone()),
        });
        return Err(error);
    }
    // No repository-owned process is launched by this module. Future process
    // brokers must register here and synchronously terminate matching handles.
    let review = current_review(&project_id)?;
    let result = serde_json::to_value(&review)
        .map_err(|error| format!("REPOSITORY_TRUST_RESULT_SERIALIZE: {error}"))?;
    transition_host_operation(OperationTransitionInput {
        operation_id,
        expected_revision: operation.revision,
        status: OperationStatus::Completed,
        result: Some(result),
        recoverable_error: None,
    })?;
    Ok(review)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use uuid::Uuid;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "pi-repository-trust-{name}-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        fs::create_dir_all(root.join(".pi")).unwrap();
        root
    }

    fn executable(root: &Path) -> PathBuf {
        let bin = root.join("bin");
        fs::create_dir_all(&bin).unwrap();
        let command = bin.join("server");
        fs::write(&command, b"#!/bin/sh\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&command).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&command, permissions).unwrap();
        }
        command
    }

    fn valid_config(root: &Path) -> PathBuf {
        executable(root);
        fs::create_dir_all(root.join("skills/demo")).unwrap();
        fs::write(root.join("skills/demo/SKILL.md"), b"# Demo\n").unwrap();
        let path = root.join(CONFIG_RELATIVE_PATH);
        fs::write(
            &path,
            br#"{
  "version": 1,
  "mcpServers": [{
    "id": "local.demo",
    "command": "./bin/server",
    "args": ["--stdio"],
    "cwd": ".",
    "env": ["DEMO_TOKEN"],
    "networkHosts": ["api.example.com"]
  }],
  "skills": [{"id": "skill.demo", "path": "skills/demo"}],
  "scripts": []
}"#,
        )
        .unwrap();
        path
    }

    #[test]
    fn valid_config_is_reviewed_without_execution() {
        let root = temp_root("valid");
        let config = valid_config(&root);
        let validated = validate_config(&root, &config).unwrap();
        assert_eq!(validated.contributions.len(), 2);
        assert!(validated.digest.starts_with("sha256:"));
        assert!(validated
            .contributions
            .iter()
            .any(|entry| entry.kind == "mcp" && entry.env_names == ["DEMO_TOKEN"]));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn one_byte_config_change_invalidates_digest() {
        let root = temp_root("digest");
        let config = valid_config(&root);
        let before = validate_config(&root, &config).unwrap().digest;
        let mut file = fs::OpenOptions::new().append(true).open(&config).unwrap();
        file.write_all(b"\n").unwrap();
        let after = validate_config(&root, &config).unwrap().digest;
        assert_ne!(before, after);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn referenced_skill_change_invalidates_digest() {
        let root = temp_root("skill-digest");
        let config = valid_config(&root);
        let before = validate_config(&root, &config).unwrap().digest;
        fs::write(root.join("skills/demo/SKILL.md"), b"# Changed\n").unwrap();
        let after = validate_config(&root, &config).unwrap().digest;
        assert_ne!(before, after);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn inline_environment_values_are_rejected() {
        let root = temp_root("inline-env");
        executable(&root);
        let config = root.join(CONFIG_RELATIVE_PATH);
        fs::write(
            &config,
            br#"{"version":1,"mcpServers":[{"id":"x","command":"./bin/server","env":{"TOKEN":"secret"}}]}"#,
        )
        .unwrap();
        let error = validate_config(&root, &config).unwrap_err();
        assert!(error.contains("REPOSITORY_CONFIG_INVALID"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn wildcard_network_access_is_rejected() {
        let root = temp_root("wildcard");
        executable(&root);
        let config = root.join(CONFIG_RELATIVE_PATH);
        fs::write(
            &config,
            br#"{"version":1,"mcpServers":[{"id":"x","command":"./bin/server","networkHosts":["*.example.com"]}]}"#,
        )
        .unwrap();
        assert!(validate_config(&root, &config)
            .unwrap_err()
            .contains("network host"));
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected() {
        use std::os::unix::fs::symlink;
        let root = temp_root("symlink");
        let outside = temp_root("outside");
        fs::write(outside.join("SKILL.md"), b"# Outside\n").unwrap();
        symlink(&outside, root.join("skills")).unwrap();
        let config = root.join(CONFIG_RELATIVE_PATH);
        fs::write(
            &config,
            br#"{"version":1,"skills":[{"id":"x","path":"skills"}]}"#,
        )
        .unwrap();
        assert!(validate_config(&root, &config)
            .unwrap_err()
            .contains("PATH_ESCAPE"));
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn prior_digest_is_reported_as_changed() {
        let root = temp_root("changed");
        let config = valid_config(&root);
        let validated = validate_config(&root, &config).unwrap();
        let approvals = vec![RepositoryApproval {
            root: root.to_string_lossy().to_string(),
            config_digest: format!("sha256:{}", "a".repeat(64)),
            identity_id: "identity".into(),
            decision: ApprovalDecision::Approved,
            updated_at: Utc::now(),
        }];
        let review = review_with("project", true, &root, &approvals, "identity");
        assert_eq!(review.status, "changed");
        assert_eq!(review.digest.as_deref(), Some(validated.digest.as_str()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn corrupt_store_is_quarantined() {
        let root = temp_root("store");
        let path = root.join("trust.json");
        fs::write(&path, b"{broken").unwrap();
        let store = load_store(&path).unwrap();
        assert!(store.approvals.is_empty());
        assert!(!path.exists());
        assert!(fs::read_dir(&root)
            .unwrap()
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().contains("corrupt-")));
        let _ = fs::remove_dir_all(root);
    }
}
