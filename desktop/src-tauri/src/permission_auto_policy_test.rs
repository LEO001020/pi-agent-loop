//! Regression coverage for host-side automatic permission decisions.

#[cfg(test)]
mod tests {
    use crate::permission::{pick_auto_allow_option_id, PermissionPolicy};

    #[test]
    fn full_access_prefers_persistent_allow() {
        let options = serde_json::json!([
            {"optionId": "allow_once", "name": "Allow once", "kind": "allow_once"},
            {"optionId": "allow_command_always", "name": "Always allow command", "kind": "allow_command_always"}
        ]);
        assert_eq!(
            pick_auto_allow_option_id(&options, PermissionPolicy::AlwaysApprove).as_deref(),
            Some("allow_command_always")
        );
    }

    #[test]
    fn non_full_access_keeps_once_as_least_privilege() {
        let options = serde_json::json!([
            {"optionId": "allow_once", "name": "Allow once", "kind": "allow_once"},
            {"optionId": "allow_always", "name": "Always allow", "kind": "allow_always"}
        ]);
        assert_eq!(
            pick_auto_allow_option_id(&options, PermissionPolicy::AcceptEdits).as_deref(),
            Some("allow_once")
        );
    }
}
