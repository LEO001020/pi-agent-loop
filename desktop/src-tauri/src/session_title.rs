//! Auto-title sessions from the first user message.
//! Instant, local heuristic naming. Pi packages may provide richer workflows.

use tauri::AppHandle;

use crate::store::{self, SessionMeta};

const PLACEHOLDERS: &[&str] = &["New chat", "Untitled", "New conversation"];

pub fn is_placeholder_title(title: &str) -> bool {
    let t = title.trim();
    t.is_empty() || PLACEHOLDERS.iter().any(|p| p.eq_ignore_ascii_case(t))
}

/// Offline title: first non-empty line, collapsed whitespace, max ~28 display chars.
pub fn heuristic_title(message: &str) -> String {
    let line = message
        .lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .unwrap_or("Chat");
    let collapsed: String = line.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate_chars(&collapsed, 28)
}

fn truncate_chars(s: &str, max: usize) -> String {
    let count = s.chars().count();
    if count <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Immediate heuristic rename when the title is still a placeholder.
pub fn auto_title_session_fast(id: &str, first_message: &str) -> Result<SessionMeta, String> {
    let list = store::load_sessions_index();
    let current = list
        .iter()
        .find(|s| s.id == id)
        .cloned()
        .ok_or_else(|| "session not found".to_string())?;

    if !is_placeholder_title(&current.title) {
        return Ok(current);
    }

    let heuristic = heuristic_title(first_message);
    store::rename_session(id, &heuristic)
}

/// Pi RPC intentionally has no hidden second model turn for title generation.
/// Keep this compatibility hook as a no-op so extensions can own richer naming.
pub fn refine_title_in_background(
    _app: AppHandle,
    _mgr: std::sync::Arc<crate::session_manager::SessionManager>,
    _id: String,
    _first_message: String,
) {
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholders() {
        assert!(is_placeholder_title("New chat"));
        assert!(is_placeholder_title("Untitled"));
        assert!(!is_placeholder_title("fix the permission bar bug"));
    }

    /// The UI is English-only, but prompts are not: titles must survive
    /// multi-byte input. `heuristic_title` caps on chars, never bytes.
    #[test]
    fn heuristic_uses_first_line_and_counts_chars() {
        let t = heuristic_title("  restyle the login page\nsecond line");
        assert!(t.contains("login"));
        assert!(!t.contains("second"));

        let cjk = heuristic_title("帮我改一下登录页样式\n第二行");
        assert!(cjk.contains("登录"));
        assert!(!cjk.contains("第二行"));
        assert!(cjk.chars().count() <= 28);
    }
}
