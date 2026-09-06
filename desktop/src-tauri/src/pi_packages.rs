use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::process::Command;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiPackageContributions {
    #[serde(default)]
    pub commands: Vec<CommandContribution>,
    #[serde(default)]
    pub surfaces: Vec<SurfaceContribution>,
    #[serde(default)]
    pub artifact_kinds: Vec<ArtifactKindContribution>,
    #[serde(default)]
    pub workflows: Vec<WorkflowContribution>,
    #[serde(default)]
    pub hooks: Vec<HookContribution>,
    #[serde(default)]
    pub native_capabilities: Vec<NativeCapabilityRequest>,
    #[serde(default)]
    pub keybindings: Vec<KeybindingContribution>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandContribution {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activation_event: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceContribution {
    pub id: String,
    pub title: String,
    pub placement: String,
    #[serde(default)]
    pub keep_alive: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activation_event: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactKindContribution {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowContribution {
    pub id: String,
    pub title: String,
    pub entry: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activation_event: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookContribution {
    pub id: String,
    pub event: String,
    #[serde(default)]
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCapabilityRequest {
    pub capability: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingContribution {
    pub command: String,
    pub keys: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiPackage {
    pub source: String,
    pub path: Option<String>,
    pub scope: String,
    pub name: Option<String>,
    pub version: Option<String>,
    pub manifest_digest: Option<String>,
    pub manifest_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest_error: Option<String>,
    pub contributions: PiPackageContributions,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiPackagesResult {
    pub packages: Vec<PiPackage>,
    pub config_dir: String,
}

#[derive(Debug, Default, Deserialize)]
struct PackageJson {
    name: Option<String>,
    version: Option<String>,
    #[serde(default)]
    pi: Option<PiManifest>,
}

#[derive(Debug, Default, Deserialize)]
struct PiManifest {
    #[serde(default)]
    contributions: Option<PiPackageContributions>,
}

#[derive(Debug, Default)]
struct ManifestInspection {
    name: Option<String>,
    version: Option<String>,
    status: String,
    error: Option<String>,
    manifest_digest: Option<String>,
    contributions: PiPackageContributions,
}

fn digest_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn valid_namespaced_id(value: &str) -> bool {
    let value = value.trim();
    value.len() <= 180
        && value.split('.').count() >= 3
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn bounded_text(value: &str, max_chars: usize) -> bool {
    let value = value.trim();
    !value.is_empty() && value.chars().count() <= max_chars && !value.chars().any(char::is_control)
}

fn valid_relative_entry(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 1_024
        || value.contains('\\')
        || Path::new(value).is_absolute()
    {
        return false;
    }
    Path::new(value).components().all(|component| {
        matches!(
            component,
            std::path::Component::Normal(_) | std::path::Component::CurDir
        )
    })
}

fn validate_contributions(value: &PiPackageContributions) -> Result<(), String> {
    let total = value.commands.len()
        + value.surfaces.len()
        + value.artifact_kinds.len()
        + value.workflows.len()
        + value.hooks.len()
        + value.native_capabilities.len()
        + value.keybindings.len();
    if total > 256 {
        return Err("too many contributions".into());
    }
    for id in value
        .commands
        .iter()
        .map(|item| item.id.as_str())
        .chain(value.surfaces.iter().map(|item| item.id.as_str()))
        .chain(value.artifact_kinds.iter().map(|item| item.id.as_str()))
        .chain(value.workflows.iter().map(|item| item.id.as_str()))
        .chain(value.hooks.iter().map(|item| item.id.as_str()))
        .chain(value.keybindings.iter().map(|item| item.command.as_str()))
    {
        if !valid_namespaced_id(id) {
            return Err(format!("contribution id must be namespaced: {id}"));
        }
    }
    for command in &value.commands {
        if !bounded_text(&command.title, 240)
            || command
                .description
                .as_deref()
                .is_some_and(|text| !bounded_text(text, 1_000))
            || command
                .activation_event
                .as_deref()
                .is_some_and(|text| !bounded_text(text, 240))
        {
            return Err(format!("invalid command contribution: {}", command.id));
        }
    }
    for artifact in &value.artifact_kinds {
        if !bounded_text(&artifact.title, 240) {
            return Err(format!(
                "invalid artifact kind contribution: {}",
                artifact.id
            ));
        }
    }
    for workflow in &value.workflows {
        if !bounded_text(&workflow.title, 240)
            || !valid_relative_entry(&workflow.entry)
            || workflow
                .activation_event
                .as_deref()
                .is_some_and(|text| !bounded_text(text, 240))
        {
            return Err(format!("invalid workflow contribution: {}", workflow.id));
        }
    }
    for hook in &value.hooks {
        if !matches!(
            hook.event.as_str(),
            "UserPromptSubmit"
                | "TurnStart"
                | "PreToolUse"
                | "PostToolUse"
                | "TurnEnd"
                | "PreCompact"
                | "SessionClose"
        ) {
            return Err(format!("unsupported hook event: {}", hook.event));
        }
    }
    for request in &value.native_capabilities {
        let capability = request.capability.trim();
        if capability.is_empty()
            || capability.len() > 160
            || capability.contains('*')
            || !capability
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-'))
        {
            return Err(format!("invalid native capability: {capability}"));
        }
        if request.reason.trim().is_empty() || request.reason.chars().count() > 500 {
            return Err(format!(
                "native capability requires a bounded reason: {capability}"
            ));
        }
    }
    for surface in &value.surfaces {
        if !bounded_text(&surface.title, 240)
            || surface
                .activation_event
                .as_deref()
                .is_some_and(|text| !bounded_text(text, 240))
            || !matches!(
                surface.placement.as_str(),
                "dock" | "settings" | "composerAbove" | "composerBelow" | "artifact"
            )
        {
            return Err(format!(
                "unsupported surface placement: {}",
                surface.placement
            ));
        }
    }
    for keybinding in &value.keybindings {
        if !bounded_text(&keybinding.keys, 120)
            || keybinding
                .when
                .as_deref()
                .is_some_and(|text| !bounded_text(text, 500))
        {
            return Err(format!(
                "invalid keybinding contribution: {}",
                keybinding.command
            ));
        }
    }
    Ok(())
}

fn inspect_package_manifest(package_path: &Path) -> ManifestInspection {
    let manifest_path = package_path.join("package.json");
    let metadata = match std::fs::metadata(&manifest_path) {
        Ok(metadata) => metadata,
        Err(error) => {
            return ManifestInspection {
                status: "missing".into(),
                error: Some(format!("package.json: {error}")),
                ..ManifestInspection::default()
            }
        }
    };
    if metadata.len() > 1_048_576 {
        return ManifestInspection {
            status: "invalid".into(),
            error: Some("package.json exceeds 1 MiB".into()),
            ..ManifestInspection::default()
        };
    }
    let text = match std::fs::read_to_string(&manifest_path) {
        Ok(text) => text,
        Err(error) => {
            return ManifestInspection {
                status: "invalid".into(),
                error: Some(format!("read package.json: {error}")),
                ..ManifestInspection::default()
            }
        }
    };
    let manifest_digest = Some(digest_bytes(text.as_bytes()));
    let manifest: PackageJson = match serde_json::from_str(&text) {
        Ok(manifest) => manifest,
        Err(error) => {
            return ManifestInspection {
                status: "invalid".into(),
                error: Some(format!("parse package.json: {error}")),
                manifest_digest,
                ..ManifestInspection::default()
            }
        }
    };
    let Some(contributions) = manifest.pi.and_then(|pi| pi.contributions) else {
        return ManifestInspection {
            name: manifest.name,
            version: manifest.version,
            status: "none".into(),
            manifest_digest,
            ..ManifestInspection::default()
        };
    };
    match validate_contributions(&contributions) {
        Ok(()) => ManifestInspection {
            name: manifest.name,
            version: manifest.version,
            status: "valid".into(),
            manifest_digest,
            contributions,
            ..ManifestInspection::default()
        },
        Err(error) => ManifestInspection {
            name: manifest.name,
            version: manifest.version,
            status: "invalid".into(),
            error: Some(error),
            manifest_digest,
            ..ManifestInspection::default()
        },
    }
}

fn pi_binary() -> Result<String, String> {
    let settings = crate::store::load_settings();
    crate::cli_probe::probe_cli(settings.manual_cli_path.as_deref())
        .path
        .ok_or_else(|| "Pi CLI not found".to_string())
}

fn validate_source(source: &str) -> Result<&str, String> {
    let source = source.trim();
    if source.is_empty() {
        return Err("Package source is required".into());
    }
    if source.len() > 512 || source.starts_with('-') || source.chars().any(|c| c.is_control()) {
        return Err("Invalid Pi package source".into());
    }
    Ok(source)
}

async fn run_pi(args: &[&str], cwd: Option<&str>) -> Result<String, String> {
    let binary = pi_binary()?;
    let mut cmd = Command::new(binary);
    cmd.args(args);
    if let Some(cwd) = cwd.map(str::trim).filter(|s| !s.is_empty()) {
        cmd.current_dir(cwd);
    }
    crate::process_util::apply_no_window_tokio(&mut cmd);
    if let Some(path) = crate::process_util::enriched_path_env() {
        cmd.env("PATH", path);
    }
    let output = cmd.output().await.map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if stderr.is_empty() { stdout } else { stderr });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn parse_list(output: &str) -> Vec<PiPackage> {
    let mut scope = "user".to_string();
    let mut packages = Vec::new();
    let lines = output.lines().collect::<Vec<_>>();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        if trimmed.ends_with("packages:") {
            scope = if trimmed.to_ascii_lowercase().starts_with("project") {
                "project".into()
            } else {
                "user".into()
            };
            i += 1;
            continue;
        }
        if line.starts_with("  ") && !line.starts_with("    ") && !trimmed.is_empty() {
            let path = lines
                .get(i + 1)
                .filter(|next| next.starts_with("    "))
                .map(|next| next.trim().to_string());
            let inspection = path
                .as_deref()
                .map(Path::new)
                .map(inspect_package_manifest)
                .unwrap_or_else(|| ManifestInspection {
                    status: "missing".into(),
                    error: Some("Pi did not report an installed package path".into()),
                    ..ManifestInspection::default()
                });
            packages.push(PiPackage {
                source: trimmed.to_string(),
                path,
                scope: scope.clone(),
                name: inspection.name,
                version: inspection.version,
                manifest_digest: inspection.manifest_digest,
                manifest_status: inspection.status,
                manifest_error: inspection.error,
                contributions: inspection.contributions,
            });
            if packages.last().is_some_and(|p| p.path.is_some()) {
                i += 1;
            }
        }
        i += 1;
    }
    packages
}

#[tauri::command]
pub async fn pi_packages_list(project_path: Option<String>) -> Result<PiPackagesResult, String> {
    let output = run_pi(&["list"], project_path.as_deref()).await?;
    Ok(PiPackagesResult {
        packages: parse_list(&output),
        config_dir: crate::process_util::user_home()
            .join(".pi")
            .join("agent")
            .display()
            .to_string(),
    })
}

#[tauri::command]
pub async fn pi_package_install(
    source: String,
    local: bool,
    project_path: Option<String>,
) -> Result<PiPackagesResult, String> {
    let source = validate_source(&source)?.to_string();
    let mut args = vec!["install", source.as_str()];
    if local {
        args.push("-l");
    }
    run_pi(&args, project_path.as_deref()).await?;
    pi_packages_list(project_path).await
}

#[tauri::command]
pub async fn pi_package_remove(
    source: String,
    local: bool,
    project_path: Option<String>,
) -> Result<PiPackagesResult, String> {
    let source = validate_source(&source)?.to_string();
    let mut args = vec!["remove", source.as_str()];
    if local {
        args.push("-l");
    }
    run_pi(&args, project_path.as_deref()).await?;
    pi_packages_list(project_path).await
}

#[tauri::command]
pub async fn pi_packages_update(project_path: Option<String>) -> Result<PiPackagesResult, String> {
    run_pi(&["update"], project_path.as_deref()).await?;
    pi_packages_list(project_path).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn parses_user_and_project_packages() {
        let output = "User packages:\n  npm:foo\n    /tmp/foo\nProject packages:\n  git:github.com/a/b\n    /work/b\n";
        let packages = parse_list(output);
        assert_eq!(packages.len(), 2);
        assert_eq!(packages[0].scope, "user");
        assert_eq!(packages[1].scope, "project");
        assert_eq!(packages[0].path.as_deref(), Some("/tmp/foo"));
        assert_eq!(packages[0].manifest_status, "missing");
        assert!(packages[1].manifest_digest.is_none());
    }

    #[test]
    fn rejects_flag_injection() {
        assert!(validate_source("--help").is_err());
        assert!(validate_source("npm:ok").is_ok());
    }

    #[test]
    fn reads_valid_optional_contributions_from_pi_manifest() {
        let dir = std::env::temp_dir().join(format!("pi-package-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("package.json"),
            r#"{
              "name": "pi-example",
              "version": "1.2.3",
              "pi": {
                "extensions": ["./index.ts"],
                "contributions": {
                  "commands": [{
                    "id": "example.package.review",
                    "title": "Review"
                  }],
                  "nativeCapabilities": [{
                    "capability": "git.read",
                    "reason": "Read repository status for the review."
                  }]
                }
              }
            }"#,
        )
        .unwrap();

        let inspection = inspect_package_manifest(&dir);
        assert_eq!(inspection.status, "valid");
        assert_eq!(inspection.name.as_deref(), Some("pi-example"));
        assert_eq!(
            inspection
                .manifest_digest
                .as_deref()
                .map(|digest| digest.len()),
            Some(71)
        );
        assert_eq!(inspection.contributions.commands.len(), 1);
        assert_eq!(inspection.contributions.native_capabilities.len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn manifest_digest_changes_when_manifest_bytes_change() {
        let dir = std::env::temp_dir().join(format!("pi-package-digest-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("package.json"),
            r#"{"name":"pi-example","version":"1.0.0"}"#,
        )
        .unwrap();
        let before = inspect_package_manifest(&dir).manifest_digest;
        std::fs::write(
            dir.join("package.json"),
            r#"{"name":"pi-example","version":"1.0.1"}"#,
        )
        .unwrap();
        let after = inspect_package_manifest(&dir).manifest_digest;
        assert!(before.is_some());
        assert_ne!(before, after);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_unnamespaced_contribution_ids_and_wildcards() {
        let unnamespaced = PiPackageContributions {
            commands: vec![CommandContribution {
                id: "review".into(),
                title: "Review".into(),
                description: None,
                activation_event: None,
            }],
            ..PiPackageContributions::default()
        };
        assert!(validate_contributions(&unnamespaced).is_err());

        let wildcard = PiPackageContributions {
            native_capabilities: vec![NativeCapabilityRequest {
                capability: "filesystem.*".into(),
                reason: "Too broad".into(),
            }],
            ..PiPackageContributions::default()
        };
        assert!(validate_contributions(&wildcard).is_err());
    }

    #[test]
    fn rejects_workflow_entry_outside_package() {
        let contributions = PiPackageContributions {
            workflows: vec![WorkflowContribution {
                id: "example.package.workflow".into(),
                title: "Workflow".into(),
                entry: "../outside.yml".into(),
                activation_event: None,
            }],
            ..PiPackageContributions::default()
        };
        assert!(validate_contributions(&contributions).is_err());
    }
}
