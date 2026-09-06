//! Project rule / instruction files under a trusted project root.
//!
//! Detects AGENTS.md, CLAUDE.md, `.pi/rules*`, and `.pi/**/AGENTS.md`.
//! Management is list + ensure AGENTS.md template — editing happens in the
//! resource pane (or OS open / reveal).

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// One existing rule file on disk.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuleEntry {
    /// Path relative to project root (`AGENTS.md`, `.pi/rules/x.md`, …).
    pub relative_path: String,
    /// Absolute filesystem path.
    pub absolute_path: String,
    /// `agents_md` | `claude_md` | `pi_rules` | `nested_agents`.
    pub kind: String,
    /// Basename for display.
    pub name: String,
    /// Byte size.
    pub size: u64,
    /// Last modified (ms since UNIX epoch); 0 when unavailable.
    pub mtime_ms: u64,
}

/// Result of scanning a project for rule files.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRulesListResult {
    pub project_path: String,
    pub rules: Vec<ProjectRuleEntry>,
    /// True when any root-level AGENTS / AGENT.md exists.
    pub has_agents_md: bool,
    /// Preferred relative path for the primary agents file (existing or `AGENTS.md`).
    pub preferred_agents_path: String,
}

/// Result of ensuring the AGENTS.md template.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRulesEnsureResult {
    pub project_path: String,
    pub relative_path: String,
    pub absolute_path: String,
    /// True when the file was created by this call.
    pub created: bool,
    /// True when a root agents file already existed (no write).
    pub already_existed: bool,
}

const AGENTS_TEMPLATE: &str = "\
# Project rules

Instructions for coding agents in this repository.

## Layout

- Describe important directories and entry points.

## Commands

- test:
- build:
- lint:

## Conventions

- Prefer small, reviewable changes.
- Match existing style; avoid unrelated refactors.
- Do not commit secrets, auth tokens, or local credentials.
";

const ROOT_AGENTS_NAMES: &[&str] = &[
    "AGENTS.md",
    "Agents.md",
    "agents.md",
    "AGENT.md",
    "Agent.md",
];

const ROOT_CLAUDE_NAMES: &[&str] = &["CLAUDE.md", "Claude.md", "claude.md"];

/// Max depth when walking `.pi/` for nested AGENTS.md / rules trees.
const PI_WALK_MAX_DEPTH: usize = 6;
/// Cap listed rule files to avoid huge trees.
const MAX_RULE_ENTRIES: usize = 200;

fn file_mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn normalize_rel(path: &str) -> String {
    path.trim()
        .trim_start_matches("./")
        .trim_start_matches('/')
        .trim_start_matches('\\')
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

fn is_agents_name(name: &str) -> bool {
    let n = name.trim().to_ascii_lowercase();
    n == "agents.md" || n == "agent.md"
}

fn is_claude_name(name: &str) -> bool {
    name.trim().eq_ignore_ascii_case("claude.md")
}

/// Pure: classify a project-relative path (mirrors TS `classifyProjectRulePath`).
pub fn classify_rule_path(relative: &str) -> Option<(&'static str, String)> {
    let p = normalize_rel(relative);
    if p.is_empty() {
        return None;
    }
    let name = Path::new(&p)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    if !p.contains('/') {
        if is_agents_name(&name) {
            return Some(("agents_md", name));
        }
        if is_claude_name(&name) {
            return Some(("claude_md", name));
        }
        return None;
    }

    let lower = p.to_ascii_lowercase();
    if lower == ".pi/rules" || lower.starts_with(".pi/rules.") || lower.starts_with(".pi/rules/") {
        return Some(("pi_rules", name));
    }

    if lower.starts_with(".pi/") && is_agents_name(&name) {
        // Nested agents under .pi, excluding the rules tree (already pi_rules).
        if !(lower == ".pi/rules"
            || lower.starts_with(".pi/rules.")
            || lower.starts_with(".pi/rules/"))
        {
            return Some(("nested_agents", name));
        }
    }

    None
}

fn kind_order(kind: &str) -> u8 {
    match kind {
        "agents_md" => 0,
        "claude_md" => 1,
        "pi_rules" => 2,
        "nested_agents" => 3,
        _ => 9,
    }
}

fn ensure_project_root(project_path: &str) -> Result<PathBuf, String> {
    let root = project_path.trim();
    if root.is_empty() {
        return Err("empty project path".into());
    }
    let pb = PathBuf::from(root);
    if !pb.is_dir() {
        return Err(format!("project path is not a directory: {root}"));
    }
    Ok(pb)
}

fn push_file_entry(
    out: &mut Vec<ProjectRuleEntry>,
    seen: &mut std::collections::HashSet<String>,
    root: &Path,
    relative: &str,
) {
    if out.len() >= MAX_RULE_ENTRIES {
        return;
    }
    let rel = normalize_rel(relative);
    if rel.is_empty() || !seen.insert(rel.clone()) {
        return;
    }
    let Some((kind, name)) = classify_rule_path(&rel) else {
        return;
    };
    let abs = root.join(Path::new(&rel));
    let meta = match fs::metadata(&abs) {
        Ok(m) if m.is_file() => m,
        _ => return,
    };
    out.push(ProjectRuleEntry {
        relative_path: rel,
        absolute_path: abs.to_string_lossy().into_owned(),
        kind: kind.to_string(),
        name,
        size: meta.len(),
        mtime_ms: file_mtime_ms(&meta),
    });
}

/// Walk a directory under project root; collect classified rule files.
fn walk_rules(
    out: &mut Vec<ProjectRuleEntry>,
    seen: &mut std::collections::HashSet<String>,
    root: &Path,
    dir_rel: &str,
    depth: usize,
) {
    if depth > PI_WALK_MAX_DEPTH || out.len() >= MAX_RULE_ENTRIES {
        return;
    }
    let abs_dir = if dir_rel.is_empty() {
        root.to_path_buf()
    } else {
        root.join(Path::new(dir_rel))
    };
    let Ok(rd) = fs::read_dir(&abs_dir) else {
        return;
    };
    let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());

    for ent in entries {
        if out.len() >= MAX_RULE_ENTRIES {
            break;
        }
        let name = ent.file_name().to_string_lossy().into_owned();
        // Skip hidden junk except `.pi` at root of walk when dir_rel empty is not used for root walk.
        if name == "." || name == ".." {
            continue;
        }
        if name.starts_with('.') && name != ".pi" && dir_rel.is_empty() {
            continue;
        }
        let child_rel = if dir_rel.is_empty() {
            name.clone()
        } else {
            format!("{dir_rel}/{name}")
        };
        // Reject path traversal components.
        if Path::new(&child_rel).components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            continue;
        }
        let Ok(ft) = ent.file_type() else { continue };
        if ft.is_file() {
            push_file_entry(out, seen, root, &child_rel);
        } else if ft.is_dir() {
            // Only recurse into .pi and under .pi/rules (and nested .pi paths).
            let lower = child_rel.to_ascii_lowercase();
            let under_pi = lower == ".pi" || lower.starts_with(".pi/");
            if under_pi {
                walk_rules(out, seen, root, &child_rel, depth + 1);
            }
        }
    }
}

/// List existing project rule files under `project_path`.
pub fn list_project_rules(project_path: &str) -> Result<ProjectRulesListResult, String> {
    let root = ensure_project_root(project_path)?;
    let mut rules: Vec<ProjectRuleEntry> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // Root AGENTS / CLAUDE probes (explicit + case variants).
    for name in ROOT_AGENTS_NAMES.iter().chain(ROOT_CLAUDE_NAMES.iter()) {
        push_file_entry(&mut rules, &mut seen, &root, name);
    }

    // Also scan project root for any case variant the probes missed (e.g. AgEnTs.md).
    if let Ok(rd) = fs::read_dir(&root) {
        for ent in rd.filter_map(|e| e.ok()) {
            let name = ent.file_name().to_string_lossy().into_owned();
            if is_agents_name(&name) || is_claude_name(&name) {
                push_file_entry(&mut rules, &mut seen, &root, &name);
            }
        }
    }

    // Walk `.pi/` for rules* and nested AGENTS.md.
    let pi = root.join(".pi");
    if pi.is_dir() {
        walk_rules(&mut rules, &mut seen, &root, ".pi", 0);
    }

    rules.sort_by(|a, b| {
        kind_order(&a.kind)
            .cmp(&kind_order(&b.kind))
            .then_with(|| a.relative_path.cmp(&b.relative_path))
    });

    let has_agents_md = rules.iter().any(|r| r.kind == "agents_md");
    let preferred_agents_path = rules
        .iter()
        .find(|r| r.kind == "agents_md")
        .map(|r| r.relative_path.clone())
        .unwrap_or_else(|| "AGENTS.md".to_string());

    Ok(ProjectRulesListResult {
        project_path: root.to_string_lossy().into_owned(),
        rules,
        has_agents_md,
        preferred_agents_path,
    })
}

/// Create root `AGENTS.md` with a short stub when no root agents file exists.
/// Idempotent: if any root AGENTS/AGENT.md already exists, returns it without writing.
pub fn ensure_agents_template(project_path: &str) -> Result<ProjectRulesEnsureResult, String> {
    let root = ensure_project_root(project_path)?;

    // Prefer an existing root agents file (any case).
    if let Ok(rd) = fs::read_dir(&root) {
        for ent in rd.filter_map(|e| e.ok()) {
            let name = ent.file_name().to_string_lossy().into_owned();
            if !is_agents_name(&name) {
                continue;
            }
            let abs = root.join(&name);
            if abs.is_file() {
                return Ok(ProjectRulesEnsureResult {
                    project_path: root.to_string_lossy().into_owned(),
                    relative_path: name,
                    absolute_path: abs.to_string_lossy().into_owned(),
                    created: false,
                    already_existed: true,
                });
            }
        }
    }

    let rel = "AGENTS.md".to_string();
    let abs = root.join(&rel);
    if abs.exists() {
        return Ok(ProjectRulesEnsureResult {
            project_path: root.to_string_lossy().into_owned(),
            relative_path: rel,
            absolute_path: abs.to_string_lossy().into_owned(),
            created: false,
            already_existed: true,
        });
    }

    let mut f = fs::File::create(&abs).map_err(|e| format!("create AGENTS.md: {e}"))?;
    f.write_all(AGENTS_TEMPLATE.as_bytes())
        .map_err(|e| format!("write AGENTS.md: {e}"))?;
    f.sync_all().ok();

    Ok(ProjectRulesEnsureResult {
        project_path: root.to_string_lossy().into_owned(),
        relative_path: rel,
        absolute_path: abs.to_string_lossy().into_owned(),
        created: true,
        already_existed: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn classify_root_and_pi_paths() {
        assert_eq!(
            classify_rule_path("AGENTS.md").map(|x| x.0),
            Some("agents_md")
        );
        assert_eq!(
            classify_rule_path("Agents.md").map(|x| x.0),
            Some("agents_md")
        );
        assert_eq!(
            classify_rule_path("CLAUDE.md").map(|x| x.0),
            Some("claude_md")
        );
        assert_eq!(
            classify_rule_path(".pi/rules.md").map(|x| x.0),
            Some("pi_rules")
        );
        assert_eq!(
            classify_rule_path(".pi/rules/a.md").map(|x| x.0),
            Some("pi_rules")
        );
        assert_eq!(
            classify_rule_path(".pi/x/AGENTS.md").map(|x| x.0),
            Some("nested_agents")
        );
        assert!(classify_rule_path("README.md").is_none());
        assert!(classify_rule_path("docs/AGENTS.md").is_none());
        assert!(classify_rule_path(".pi/config.toml").is_none());
    }

    #[test]
    fn list_and_ensure_template() {
        let dir = std::env::temp_dir().join(format!("pi-app-rules-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".pi/rules")).unwrap();
        fs::create_dir_all(dir.join(".pi/team")).unwrap();
        fs::write(dir.join("CLAUDE.md"), "# c\n").unwrap();
        fs::write(dir.join(".pi/rules/base.md"), "rule\n").unwrap();
        fs::write(dir.join(".pi/team/AGENTS.md"), "nested\n").unwrap();

        let listed = list_project_rules(dir.to_str().unwrap()).unwrap();
        assert!(!listed.has_agents_md);
        let paths: Vec<_> = listed
            .rules
            .iter()
            .map(|r| r.relative_path.as_str())
            .collect();
        assert!(paths.contains(&"CLAUDE.md"));
        assert!(paths.contains(&".pi/rules/base.md"));
        assert!(paths.contains(&".pi/team/AGENTS.md"));

        let ensured = ensure_agents_template(dir.to_str().unwrap()).unwrap();
        assert!(ensured.created);
        assert_eq!(ensured.relative_path, "AGENTS.md");
        assert!(dir.join("AGENTS.md").is_file());

        let again = ensure_agents_template(dir.to_str().unwrap()).unwrap();
        assert!(!again.created);
        assert!(again.already_existed);

        let listed2 = list_project_rules(dir.to_str().unwrap()).unwrap();
        assert!(listed2.has_agents_md);

        let _ = fs::remove_dir_all(&dir);
    }
}
