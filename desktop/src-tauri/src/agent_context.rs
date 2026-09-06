//! Editable context files in the active Pi agent home.
//!
//! Pi loads `AGENTS.md` as standing instructions and `SYSTEM.md` as a system
//! prompt override/append file. The active home follows `session_data_mode`,
//! exactly like config, extensions, and CLI sessions.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

const MAX_CONTEXT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextFile {
    pub name: String,
    pub path: String,
    pub content: String,
    pub exists: bool,
    pub mtime_ms: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextResult {
    pub home: String,
    pub agents: AgentContextFile,
    pub system: AgentContextFile,
}

fn context_name(kind: &str) -> Result<&'static str, String> {
    match kind.trim().to_ascii_lowercase().as_str() {
        "agents" | "agents.md" => Ok("AGENTS.md"),
        "system" | "system.md" => Ok("SYSTEM.md"),
        _ => Err("context file must be AGENTS.md or SYSTEM.md".into()),
    }
}

fn mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn read_one(home: &Path, name: &str) -> Result<AgentContextFile, String> {
    let path = home.join(name);
    let exists = path.is_file();
    let content = if exists {
        let bytes = fs::read(&path).map_err(|e| format!("read {name}: {e}"))?;
        if bytes.len() > MAX_CONTEXT_BYTES {
            return Err(format!("{name} is larger than 1 MB"));
        }
        String::from_utf8(bytes).map_err(|_| format!("{name} is not valid UTF-8"))?
    } else {
        String::new()
    };
    Ok(AgentContextFile {
        name: name.to_string(),
        path: path.to_string_lossy().into_owned(),
        content,
        exists,
        mtime_ms: mtime_ms(&path),
    })
}

pub fn load_from_home(home: &Path) -> Result<AgentContextResult, String> {
    Ok(AgentContextResult {
        home: home.to_string_lossy().into_owned(),
        agents: read_one(home, "AGENTS.md")?,
        system: read_one(home, "SYSTEM.md")?,
    })
}

pub fn save_to_home(home: &Path, kind: &str, content: &str) -> Result<AgentContextResult, String> {
    let name = context_name(kind)?;
    if content.len() > MAX_CONTEXT_BYTES {
        return Err(format!("{name} is larger than 1 MB"));
    }
    fs::create_dir_all(home).map_err(|e| format!("create agent home: {e}"))?;
    let target = home.join(name);
    let temp = home.join(format!(".{name}.tmp-{}", std::process::id()));
    fs::write(&temp, content.as_bytes()).map_err(|e| format!("write {name}: {e}"))?;
    fs::rename(&temp, &target).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("replace {name}: {e}")
    })?;
    load_from_home(home)
}

pub fn active_home() -> PathBuf {
    let settings = crate::store::load_settings();
    crate::paths::resolve_agent_pi_home(&settings.session_data_mode)
}

pub fn load() -> Result<AgentContextResult, String> {
    load_from_home(&active_home())
}

pub fn save(kind: &str, content: &str) -> Result<AgentContextResult, String> {
    save_to_home(&active_home(), kind, content)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "pi-app-agent-context-{name}-{}",
            std::process::id()
        ))
    }

    #[test]
    fn missing_files_are_editable_empty_documents() {
        let home = temp_home("missing");
        let _ = fs::remove_dir_all(&home);
        let result = load_from_home(&home).unwrap();
        assert!(!result.agents.exists);
        assert!(!result.system.exists);
        assert_eq!(result.agents.content, "");
    }

    #[test]
    fn saves_only_supported_context_files() {
        let home = temp_home("save");
        let _ = fs::remove_dir_all(&home);
        let result = save_to_home(&home, "system", "Keep the prompt small.\n").unwrap();
        assert_eq!(result.system.content, "Keep the prompt small.\n");
        assert!(result.system.exists);
        assert!(save_to_home(&home, "../auth.json", "nope").is_err());
        assert!(!home.join("auth.json").exists());
        let _ = fs::remove_dir_all(&home);
    }
}
