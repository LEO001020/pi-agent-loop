//! When to finish a turn after `_x.ai/session/prompt_complete` (issue #52).
//!
//! Agents sometimes emit prompt_complete while tools are still running, or while
//! the host is waiting on permission / ask_user / plan review. Ending the UI
//! turn early makes long tasks look "interrupted" even though the agent is busy.

/// Terminal tool statuses — not counted as in-flight.
pub fn is_terminal_tool_status(status: &str) -> bool {
    let s = if status.is_empty() {
        "in_progress"
    } else {
        status
    };
    let lower = s.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "completed" | "complete" | "failed" | "error" | "cancelled" | "canceled" | "rejected"
    )
}

/// Whether PromptComplete should wait before calling `end_stream`.
pub fn should_defer_prompt_complete(
    awaiting_permission: bool,
    pending_plan: bool,
    pending_ask_user: bool,
    open_tool_count: usize,
) -> bool {
    awaiting_permission || pending_plan || pending_ask_user || open_tool_count > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_statuses() {
        assert!(is_terminal_tool_status("completed"));
        assert!(is_terminal_tool_status("FAILED"));
        assert!(is_terminal_tool_status("cancelled"));
        assert!(!is_terminal_tool_status("in_progress"));
        assert!(!is_terminal_tool_status(""));
        assert!(!is_terminal_tool_status("pending"));
    }

    #[test]
    fn defer_while_tools_or_gates() {
        assert!(!should_defer_prompt_complete(false, false, false, 0));
        assert!(should_defer_prompt_complete(true, false, false, 0));
        assert!(should_defer_prompt_complete(false, true, false, 0));
        assert!(should_defer_prompt_complete(false, false, true, 0));
        assert!(should_defer_prompt_complete(false, false, false, 2));
    }
}
