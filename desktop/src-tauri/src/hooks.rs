//! Pi CLI hooks discovery under `~/.pi/hooks` and `<project>/.pi/hooks`.
//!
//! Management is list / reveal / open-folder only — no visual JSON editor.
//! Hook file format lives in the Pi CLI user guide (`10-hooks.md`).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::process_util::user_home;

/// One on-disk entry under a hooks directory (file or subfolder).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HookEntry {
    /// File or directory name (basename).
    pub name: String,
    /// Absolute path.
    pub path: String,
    /// `user` (global `~/.pi/hooks`) or `project` (`<cwd>/.pi/hooks`).
    pub scope: String,
    /// `file` | `dir`.
    pub kind: String,
    /// Lowercased extension without dot (files only; empty for dirs / no ext).
    pub ext: String,
    /// Byte size (0 for directories).
    pub size: u64,
    /// Last modified time in ms since UNIX epoch (0 when unavailable).
    pub mtime_ms: u64,
}

/// Result of scanning user (+ optional project) hooks directories.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HooksListResult {
    pub hooks: Vec<HookEntry>,
    pub user_dir: String,
    pub user_dir_exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_dir_exists: Option<bool>,
    /// Absolute path to the local Pi CLI hooks user-guide page when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs_path: Option<String>,
}

/// `~/.pi/hooks` — always-trusted personal hooks.
pub fn user_hooks_dir() -> PathBuf {
    user_home().join(".pi").join("hooks")
}

/// `<project>/.pi/hooks` when `project_path` is a non-empty path.
pub fn project_hooks_dir(project_path: &str) -> Option<PathBuf> {
    let root = project_path.trim();
    if root.is_empty() {
        return None;
    }
    Some(PathBuf::from(root).join(".pi").join("hooks"))
}

/// Local user-guide page shipped with the CLI install (optional).
pub fn hooks_docs_path() -> PathBuf {
    user_home()
        .join(".pi")
        .join("docs")
        .join("user-guide")
        .join("10-hooks.md")
}

fn file_mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn entry_ext(name: &str, is_dir: bool) -> String {
    if is_dir {
        return String::new();
    }
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default()
}

/// List top-level entries in a hooks directory (non-recursive).
/// Skips hidden names (leading `.`). Missing / unreadable dirs yield empty vec.
pub fn list_hooks_in_dir(dir: &Path, scope: &str) -> Vec<HookEntry> {
    let Ok(rd) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for ent in rd.flatten() {
        let name = ent.file_name().to_string_lossy().to_string();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        let path = ent.path();
        let meta = match ent.metadata().or_else(|_| fs::metadata(&path)) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = meta.is_dir();
        let kind = if is_dir { "dir" } else { "file" };
        let size = if is_dir { 0 } else { meta.len() };
        out.push(HookEntry {
            name: name.clone(),
            path: path.to_string_lossy().to_string(),
            scope: scope.to_string(),
            kind: kind.to_string(),
            ext: entry_ext(&name, is_dir),
            size,
            mtime_ms: file_mtime_ms(&meta),
        });
    }
    sort_hook_entries(&mut out);
    out
}

/// Stable sort: scope (user then project), then name (case-insensitive).
pub fn sort_hook_entries(entries: &mut [HookEntry]) {
    entries.sort_by(|a, b| {
        let scope_ord = scope_rank(&a.scope).cmp(&scope_rank(&b.scope));
        if scope_ord != std::cmp::Ordering::Equal {
            return scope_ord;
        }
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
            .then_with(|| a.path.cmp(&b.path))
    });
}

fn scope_rank(scope: &str) -> u8 {
    match scope {
        "user" => 0,
        "project" => 1,
        _ => 2,
    }
}

/// Scan user hooks (+ project hooks when `project_path` is set).
pub fn collect_hooks_list(project_path: Option<&str>) -> HooksListResult {
    let user_dir = user_hooks_dir();
    let user_dir_exists = user_dir.is_dir();
    let mut hooks = if user_dir_exists {
        list_hooks_in_dir(&user_dir, "user")
    } else {
        Vec::new()
    };

    let (project_dir, project_dir_exists) = match project_path.and_then(project_hooks_dir) {
        Some(dir) => {
            let exists = dir.is_dir();
            if exists {
                hooks.extend(list_hooks_in_dir(&dir, "project"));
            }
            sort_hook_entries(&mut hooks);
            (Some(dir.to_string_lossy().to_string()), Some(exists))
        }
        None => (None, None),
    };

    let docs = hooks_docs_path();
    let docs_path = if docs.is_file() {
        Some(docs.to_string_lossy().to_string())
    } else {
        None
    };

    HooksListResult {
        hooks,
        user_dir: user_dir.to_string_lossy().to_string(),
        user_dir_exists,
        project_dir,
        project_dir_exists,
        docs_path,
    }
}

/// Ensure a hooks directory exists (`user` or `project`). Returns absolute path.
pub fn ensure_hooks_dir(scope: &str, project_path: Option<&str>) -> Result<PathBuf, String> {
    let dir = match scope.trim() {
        "user" | "" => user_hooks_dir(),
        "project" => project_hooks_dir(project_path.unwrap_or(""))
            .ok_or_else(|| "project path required for project hooks".to_string())?,
        other => {
            return Err(format!("unknown hooks scope: {other}"));
        }
    };
    fs::create_dir_all(&dir).map_err(|e| format!("create hooks dir: {e}"))?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn user_hooks_dir_joins_home_dot_pi_hooks() {
        let dir = user_hooks_dir();
        let s = dir.to_string_lossy();
        assert!(s.ends_with(".pi/hooks") || s.ends_with(".pi\\hooks"), "{s}");
    }

    #[test]
    fn project_hooks_dir_joins_project_root() {
        let d = project_hooks_dir("/tmp/my-app").expect("path");
        assert_eq!(d, PathBuf::from("/tmp/my-app/.pi/hooks"));
        assert!(project_hooks_dir("").is_none());
        assert!(project_hooks_dir("   ").is_none());
    }

    #[test]
    fn sort_hook_entries_user_before_project_then_name() {
        let mut items = vec![
            HookEntry {
                name: "z.json".into(),
                path: "/p/z.json".into(),
                scope: "project".into(),
                kind: "file".into(),
                ext: "json".into(),
                size: 1,
                mtime_ms: 0,
            },
            HookEntry {
                name: "b.json".into(),
                path: "/u/b.json".into(),
                scope: "user".into(),
                kind: "file".into(),
                ext: "json".into(),
                size: 1,
                mtime_ms: 0,
            },
            HookEntry {
                name: "a.json".into(),
                path: "/u/a.json".into(),
                scope: "user".into(),
                kind: "file".into(),
                ext: "json".into(),
                size: 1,
                mtime_ms: 0,
            },
        ];
        sort_hook_entries(&mut items);
        assert_eq!(
            items.iter().map(|h| h.name.as_str()).collect::<Vec<_>>(),
            vec!["a.json", "b.json", "z.json"]
        );
        assert_eq!(items[0].scope, "user");
        assert_eq!(items[2].scope, "project");
    }

    #[test]
    fn list_hooks_in_dir_reads_real_files() {
        let tmp = std::env::temp_dir().join(format!("pi-app-hooks-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).expect("mkdir");
        let file = tmp.join("session-start.json");
        {
            let mut f = fs::File::create(&file).expect("create");
            write!(f, r#"{{"hooks":{{}}}}"#).expect("write");
        }
        fs::create_dir(tmp.join("scripts")).expect("subdir");
        // hidden skipped
        let _ = fs::File::create(tmp.join(".hidden"));

        let listed = list_hooks_in_dir(&tmp, "user");
        let names: Vec<_> = listed.iter().map(|h| h.name.as_str()).collect();
        assert!(names.contains(&"session-start.json"), "{names:?}");
        assert!(names.contains(&"scripts"), "{names:?}");
        assert!(!names.iter().any(|n| n.starts_with('.')), "{names:?}");

        let json = listed
            .iter()
            .find(|h| h.name == "session-start.json")
            .expect("json entry");
        assert_eq!(json.kind, "file");
        assert_eq!(json.ext, "json");
        assert_eq!(json.scope, "user");
        assert!(json.size > 0);
        assert!(json.path.ends_with("session-start.json"));

        let dir = listed.iter().find(|h| h.name == "scripts").expect("dir");
        assert_eq!(dir.kind, "dir");
        assert_eq!(dir.size, 0);

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn entry_ext_for_files() {
        assert_eq!(entry_ext("a.json", false), "json");
        assert_eq!(entry_ext("A.JSON", false), "json");
        assert_eq!(entry_ext("noext", false), "");
        assert_eq!(entry_ext("scripts", true), "");
    }
}
