//! Host permission decision integration tests (no AppHandle).
//! Drives shipped may_auto_allow + pick_option_id + extract_path_target.

#[cfg(test)]
mod host_permission_e2e {
    use crate::permission::{
        extract_path_target, is_outside_project, may_auto_allow, pick_option_id, scope_key,
        PermissionPolicy, SessionAllowCache,
    };
    use std::path::PathBuf;

    #[test]
    fn host_maps_once_session_deny_from_agent_options() {
        let options = serde_json::json!([
            {"optionId": "allow-once", "name": "Allow once", "kind": "allow_once"},
            {"optionId": "allow-always", "name": "Allow always", "kind": "allow_always"},
            {"optionId": "reject-once", "name": "Reject", "kind": "reject_once"}
        ]);
        assert_eq!(
            pick_option_id(&options, "allow_once").as_deref(),
            Some("allow-once")
        );
        assert_eq!(
            pick_option_id(&options, "allow_always").as_deref(),
            Some("allow-always")
        );
        assert_eq!(
            pick_option_id(&options, "reject_once").as_deref(),
            Some("reject-once")
        );
    }

    #[test]
    fn h05_ask_plus_session_cache_auto_then_outside_blocked() {
        let root = std::env::temp_dir().join("pi-app-host-h05");
        let _ = std::fs::create_dir_all(root.join("src"));
        let inside = root.join("src/in.txt");
        let _ = std::fs::write(&inside, "ok");

        let mut cache = SessionAllowCache::default();
        let sk_in = scope_key("write", &inside.to_string_lossy());
        // Simulate UI "Allow for session" under Ask chip
        cache.allow(sk_in.clone());

        assert!(
            may_auto_allow(
                PermissionPolicy::Ask,
                &cache,
                &sk_in,
                Some(&root),
                &inside.to_string_lossy(),
                "write",
                "",
            ),
            "H05: Ask + session cache + in-project → auto"
        );

        let outside = "/tmp/outside-pi-app-secret.txt";
        let sk_out = scope_key("write", outside);
        cache.allow(sk_out.clone());
        assert!(
            !may_auto_allow(
                PermissionPolicy::Ask,
                &cache,
                &sk_out,
                Some(&root),
                outside,
                "write",
                "",
            ),
            "H05/§17.3: outside never session-allowed"
        );
    }

    #[test]
    fn relative_dotdot_escape_outside() {
        let root = std::env::temp_dir().join("pi-app-host-escape");
        let _ = std::fs::create_dir_all(&root);
        assert!(is_outside_project(&root, "../../.ssh/id_rsa"));
        assert!(is_outside_project(
            &root,
            &format!("{}/../.ssh/id_rsa", root.display())
        ));
    }

    #[test]
    fn extract_path_from_pi_write_raw_input() {
        let raw = serde_json::json!({
            "toolCall": {
                "toolCallId": "call-1",
                "title": "write",
                "rawInput": {
                    "file_path": "/Users/me/proj/SPIKE_PERM.txt",
                    "content": "PERM_OK\n"
                }
            }
        });
        assert_eq!(extract_path_target(&raw), "/Users/me/proj/SPIKE_PERM.txt");
    }

    #[test]
    fn ask_without_cache_prompts() {
        let cache = SessionAllowCache::default();
        assert!(!may_auto_allow(
            PermissionPolicy::Ask,
            &cache,
            "write:/x",
            Some(&PathBuf::from("/tmp")),
            "/tmp/x",
            "write",
            "",
        ));
    }
}
