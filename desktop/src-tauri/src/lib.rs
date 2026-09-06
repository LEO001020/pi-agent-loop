//! Pi App host — Pi RPC runtime with a Tauri desktop shell.

mod acp_client;
#[cfg(test)]
mod acp_golden_test;
mod agent_context;
mod agent_memory;
mod agent_prefs;
mod agent_subagents;
mod agents_catalog;
mod app_update;
mod artifacts;
mod automation_headless;
mod automation_ledger;
mod automation_scheduler;
mod checkpoints;
mod cli_install;
mod cli_probe;
mod cli_sessions;
mod cli_update;
mod commands;
mod crash_reporting;
mod editors;
mod error;
mod extensions;
mod fs_browser;
mod gh_cli;
mod hooks;
#[cfg(test)]
mod integration_test;
mod journal_throttle;
mod mcp;
mod media_protocol;
mod mock_acp;
mod models_catalog;
mod operation_journal;
mod paths;
mod permission;
#[cfg(test)]
mod permission_auto_policy_test;
#[cfg(test)]
mod permission_host_test;
mod permission_rules;
mod pi_packages;
mod process_limits;
mod process_util;
mod project_rules;
mod providers;
mod remote_runtime;
mod remote_workspace;
mod repository_trust;
mod secrets;
mod session_content_search;
mod session_fsm;
mod session_import;
mod session_manager;
mod session_title;
mod speech;
mod store;
mod store_lock;
mod stream_stall;
mod support_bundle;
mod terminal;
mod token_usage;
mod tray;
mod tray_i18n;
mod turn_complete;
mod usage;
mod usage_ledger;

use std::sync::Arc;

use session_manager::SessionManager;

/// Run the external MCP stdio adapter without starting the desktop window.
/// The adapter talks to the authenticated loopback endpoint owned by a running
/// Pi Desktop process.
pub fn run_mcp_stdio() -> Result<(), String> {
    mcp::run_stdio()
}

pub fn revoke_mcp_runtime_token() -> Result<(), String> {
    mcp::revoke_runtime_token()
}

pub fn clear_mcp_runtime_token_revocation() -> Result<(), String> {
    mcp::clear_runtime_token_revocation()
}

/// Run the optional host scheduler without opening the desktop window.
pub fn run_automation_daemon() -> Result<(), String> {
    automation_headless::run()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = paths::ensure_app_dirs();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    if let Err(error) = operation_journal::reconcile_incomplete() {
        tracing::warn!("operation journal startup reconciliation: {error}");
    }
    if let Err(error) = checkpoints::reconcile_incomplete() {
        tracing::warn!("checkpoint startup reconciliation: {error}");
    }
    if let Err(error) = automation_ledger::reconcile_stale(chrono::Duration::minutes(10)) {
        tracing::warn!("automation ledger startup reconciliation: {error}");
    }

    let session_mgr = Arc::new(SessionManager::new());
    tauri::Builder::default()
        // Must be registered first so a second process exits and focuses the primary window.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(session_mgr)
        // Range-capable media streaming (video/audio/pdf) — never loads multi‑GB into RAM.
        .register_asynchronous_uri_scheme_protocol("media", |_ctx, request, responder| {
            std::thread::spawn(move || {
                let response = media_protocol::handle_request(request);
                responder.respond(response);
            });
        })
        // Close button / Alt+F4 → hide to tray only (no Dock / taskbar icon).
        // Full exit: tray "Quit Pi" or Cmd+Q.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                use tauri::Manager;
                api.prevent_close();
                tray::hide_to_tray(window.app_handle());
            }
        })
        .setup(|app| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                {
                    // Transparent layers so CSS backdrop-filter / native vibrancy show through.
                    let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
                    // Frosted glass under transparent regions (sidebar). Solid main CSS covers the rest.
                    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                    if let Err(e) =
                        apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, Some(16.0))
                    {
                        tracing::warn!("window vibrancy: {e}");
                    }
                }
                // Windows / others: solid base matching dark theme (avoids white flash / WebView2 glitches).
                #[cfg(not(target_os = "macos"))]
                {
                    let _ =
                        window.set_background_color(Some(tauri::window::Color(13, 13, 13, 255)));
                }
            }
            // Menu-bar / system tray — logo.svg tray icon (not dock app icon)
            if let Err(e) = tray::setup_tray(app.handle()) {
                tracing::warn!("tray setup: {e}");
            }
            // I03: recycle idle agent processes; session metadata stays on disk.
            // I06: surface cancel UI when a stream is pure-silent for too long.
            {
                use tauri::Manager;
                let mgr = app.state::<Arc<SessionManager>>().inner().clone();
                mgr.start_idle_watchdog(app.handle().clone());
                mgr.start_stream_stall_watchdog(app.handle().clone());
                automation_scheduler::start(app.handle().clone(), Arc::clone(&mgr));
                mcp::start_loopback(app.handle().clone(), mgr);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::session_get_state,
            commands::sessions_running,
            commands::session_connect,
            commands::session_send,
            commands::session_stop,
            commands::session_disconnect,
            commands::session_reattach,
            commands::session_resolve_permission,
            commands::session_resolve_plan,
            commands::session_resolve_ask_user,
            commands::probe_cli,
            commands::acp_test_connection,
            commands::cli_install_latest,
            commands::cli_install_commands,
            commands::cli_update_check,
            commands::cli_update_install,
            commands::pick_cli_binary,
            commands::open_external_url,
            commands::app_check_update,
            commands::projects_list,
            commands::project_add,
            commands::project_add_dialog,
            commands::project_remove,
            commands::project_relocate,
            commands::project_trust,
            commands::project_set_permission_policy,
            commands::project_rename,
            commands::project_set_pinned,
            commands::project_reveal,
            commands::project_rules_list,
            commands::project_rules_ensure_template,
            commands::project_archive_sessions,
            commands::sessions_list,
            commands::sessions_search,
            commands::session_create,
            commands::session_delete,
            commands::session_rename,
            commands::session_set_archived,
            commands::session_set_pinned,
            commands::session_set_project,
            commands::session_set_remote_cwd,
            commands::session_set_scheduled,
            commands::session_messages,
            commands::session_media_root,
            commands::session_resolve_relative_media,
            commands::settings_get,
            commands::store_take_quarantine,
            commands::settings_set,
            commands::settings_remember_last_session,
            commands::models_list_available,
            commands::providers_list,
            commands::providers_activate,
            commands::providers_upsert,
            commands::providers_remove,
            commands::providers_set_default,
            commands::providers_ping,
            commands::providers_list_models,
            commands::agents_catalog,
            commands::agents_list,
            commands::cli_sessions_list,
            commands::cli_session_import,
            commands::cli_sessions_import_all,
            commands::cli_doctor_fix,
            commands::project_inspect,
            commands::setup_preview,
            commands::setup_install,
            commands::memory_clear,
            commands::permission_rules_get,
            commands::permission_rules_set,
            commands::extensions_get,
            commands::extensions_set_mcp,
            commands::extensions_set_skill,
            commands::extensions_enable_all_mcp,
            commands::extensions_enable_all_skills,
            commands::skills_list,
            commands::inspect_mcp,
            commands::mcp_add,
            commands::mcp_remove,
            commands::mcp_doctor,
            commands::plugins_list,
            commands::plugin_details,
            commands::plugin_enable,
            commands::plugin_disable,
            commands::plugin_install,
            commands::plugin_uninstall,
            commands::plugin_update,
            commands::marketplace_list,
            commands::marketplace_available,
            commands::marketplace_add,
            commands::marketplace_remove,
            commands::marketplace_update,
            commands::hooks_list,
            commands::hooks_ensure_dir,
            commands::hooks_open_dir,
            commands::hooks_reveal,
            commands::leader_list,
            commands::leader_kill_all,
            pi_packages::pi_packages_list,
            pi_packages::pi_package_install,
            pi_packages::pi_package_remove,
            pi_packages::pi_packages_update,
            artifacts::artifacts_list,
            artifacts::artifact_get,
            artifacts::artifact_upsert,
            artifacts::artifact_delete,
            operation_journal::operation_begin,
            operation_journal::operation_transition,
            operation_journal::operation_get,
            operation_journal::operations_list,
            checkpoints::checkpoints_list,
            checkpoints::checkpoint_revert_preview,
            checkpoints::checkpoint_revert_apply,
            checkpoints::checkpoints_gc,
            repository_trust::repository_trust_review,
            repository_trust::repository_trust_approve,
            repository_trust::repository_trust_reject,
            repository_trust::repository_trust_revoke,
            commands::composer_prefs_resolve,
            commands::composer_prefs_set,
            commands::agent_context_get,
            commands::agent_context_set,
            commands::session_set_policy,
            commands::session_set_model,
            commands::session_rewind_drop_last_user,
            commands::session_rewind_points,
            commands::session_rewind_execute,
            commands::session_fork,
            commands::session_adopt_answer,
            commands::doctor_report,
            commands::export_support_bundle,
            commands::export_session_bundle,
            commands::reset_app_data,
            commands::pick_directory,
            commands::pick_attach_files,
            commands::pick_attach_folder,
            commands::save_temp_attachment,
            commands::clipboard_paste_image,
            commands::paths_classify,
            commands::path_open,
            commands::path_reveal,
            terminal::terminal_start,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_stop,
            usage::usage_profile,
            usage::usage_budget_status,
            usage::session_cache_standings,
            usage::usage_session_summary,
            usage::usage_provider_health,
            speech::speech_status,
            speech::speech_install,
            speech::speech_transcribe,
            remote_runtime::remote_runtime_test,
            remote_runtime::remote_direct_test,
            remote_runtime::remote_runtime_token_set,
            commands::git_file_diff,
            commands::git_status,
            commands::git_numstat,
            commands::git_stage,
            commands::git_unstage,
            commands::git_commit,
            commands::git_push,
            commands::git_discard,
            commands::git_worktrees_list,
            commands::git_worktree_add,
            commands::git_worktree_remove,
            commands::git_worktree_diff,
            commands::git_worktree_adopt,
            commands::git_worktree_gc,
            commands::git_show_file,
            gh_cli::gh_available,
            gh_cli::gh_repo_list,
            gh_cli::gh_pr_list,
            gh_cli::gh_pr_diff,
            gh_cli::gh_pr_create,
            gh_cli::gh_pr_comment,
            commands::fs_list_dir,
            commands::fs_read_file,
            commands::fs_write_file,
            commands::fs_write_absolute,
            tray::tray_refresh,
            commands::fs_read_absolute,
            commands::fs_open_path,
            commands::session_auto_title,
            commands::automations_list,
            commands::automation_create,
            commands::automation_update,
            commands::automation_set_enabled,
            commands::automation_mark_run,
            commands::automation_run_start,
            commands::automation_run_finish,
            commands::automation_runs_list,
            commands::automation_run_triage,
            commands::automation_delete,
            commands::session_import_transcript,
            commands::session_import_transcript_file,
            commands::editors_list,
            commands::open_in_editor,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Pi App")
        .run(|app, event| {
            // macOS: click Dock icon when all windows hidden → show main window again.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    tray::show_main_window(app);
                }
            }
            let _ = (app, &event);
        });
}
