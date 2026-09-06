//! Optional scheduler process for unattended automation runs.
//!
//! The desktop scheduler remains the normal path. This small CLI service is
//! useful when the window has been fully quit: it reuses the same automation
//! store and append-only run ledger, claims each due automation across
//! processes, and records the resulting session for the next desktop launch.
//! It deliberately has no UI and does not upload anything.

use std::path::PathBuf;
use std::time::Duration;

use chrono::Utc;
use tokio::sync::mpsc::UnboundedReceiver;
use uuid::Uuid;

use crate::acp_client::{AcpClient, AcpEvent, SpawnOptions, StreamKind};
use crate::automation_scheduler::{is_due, next_run_at};
use crate::cli_probe;
use crate::store::{self, Automation, ChatMessageStored};

const TICK: Duration = Duration::from_secs(30);
const EVENT_DRAIN_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Default)]
struct CapturedTurn {
    assistant: String,
    thought: String,
    model_id: Option<String>,
    usage: crate::token_usage::TokenUsage,
    saw_usage: bool,
    error: Option<String>,
}

pub fn run() -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("automation daemon runtime: {error}"))?;
    runtime.block_on(run_until_stopped())
}

async fn run_until_stopped() -> Result<(), String> {
    crate::paths::ensure_app_dirs().map_err(|error| error.to_string())?;
    eprintln!("pi-app automation daemon started");
    let mut ticker = tokio::time::interval(TICK);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let stop = tokio::signal::ctrl_c();
    tokio::pin!(stop);
    loop {
        tokio::select! {
            _ = &mut stop => {
                eprintln!("pi-app automation daemon stopped");
                return Ok(());
            }
            _ = ticker.tick() => run_due().await,
        }
    }
}

async fn run_due() {
    let now = Utc::now();
    let rows = store::load_automations();
    for automation in rows.into_iter().filter(|row| is_due(row, now)) {
        let claim_path = crate::paths::automation_claim_file(&automation.id);
        let Ok(_claim) = crate::store_lock::lock_exclusive(&claim_path) else {
            tracing::debug!(
                automation = %automation.id,
                "headless automation is already claimed by another runner"
            );
            continue;
        };

        // Re-read after acquiring the claim. A desktop tick may have advanced
        // this row while the daemon was waiting for the file lock.
        let Some(current) = store::load_automations()
            .into_iter()
            .find(|row| row.id == automation.id && is_due(row, now))
        else {
            continue;
        };
        let scheduled_at = current.next_run_at.unwrap_or(now);
        let ran_late = now.signed_duration_since(scheduled_at).num_seconds() > 90;
        match run_one(&current, ran_late).await {
            Ok(()) => tracing::info!(automation = %current.id, "headless automation ran"),
            Err(error) => {
                tracing::warn!(automation = %current.id, "headless automation failed: {error}");
                let next = next_run_at(&current, Utc::now());
                let _ = store::mark_automation_failure(
                    &current.id,
                    Utc::now(),
                    next,
                    ran_late,
                    &error,
                    current.frequency.eq_ignore_ascii_case("once"),
                );
            }
        }
    }
}

async fn run_one(automation: &Automation, ran_late: bool) -> Result<(), String> {
    let scheduled_at = automation.next_run_at;
    let run = crate::automation_ledger::start(
        &automation.id,
        None,
        "headless",
        None,
        scheduled_at,
        ran_late,
        automation.model_id.as_deref(),
        automation.effort.as_deref(),
    )?;
    let run_id = run.id.clone();
    let started = std::time::Instant::now();
    let result = run_one_inner(automation, &run_id, ran_late).await;
    match &result {
        Ok(()) => {
            let _ = crate::automation_ledger::finish(
                &run_id,
                "completed",
                started.elapsed().as_millis().try_into().ok(),
                None,
            );
        }
        Err(error) => {
            let _ = crate::automation_ledger::finish(
                &run_id,
                "failed",
                started.elapsed().as_millis().try_into().ok(),
                Some(error),
            );
        }
    }
    result
}

async fn run_one_inner(
    automation: &Automation,
    run_id: &str,
    ran_late: bool,
) -> Result<(), String> {
    let settings = store::load_settings();
    let project = automation.project_id.as_deref().and_then(|id| {
        store::load_projects()
            .into_iter()
            .find(|project| project.id == id)
    });
    if project.as_ref().is_some_and(|value| !value.trusted) {
        return Err("project is not trusted".into());
    }
    if settings.remote_runtime.enabled && settings.remote_runtime.transport == "direct" {
        return Err("headless automation does not support direct remote ACP".into());
    }

    let session = store::create_session(
        automation.project_id.clone(),
        Some(automation.title.clone()),
        true,
    )?;
    crate::automation_ledger::attach_session(run_id, &session.id)?;
    store::attach_automation_run(&session.id, &automation.id, run_id)?;
    store::set_session_agent_prefs(
        &session.id,
        automation.model_id.as_deref(),
        automation.effort.as_deref(),
    )?;

    let cwd = project
        .as_ref()
        .map(|value| PathBuf::from(value.path.clone()))
        .unwrap_or_else(crate::process_util::user_home);
    // Project paths belong to the desktop host. For SSH, the configured
    // runtime cwd is the only path we can safely assume exists remotely.
    let remote_cwd = settings.remote_runtime.cwd.clone();
    let (client, mut events) = if settings.remote_runtime.enabled {
        let ssh = PathBuf::from("ssh");
        AcpClient::spawn_with_options(
            ssh,
            cwd.clone(),
            SpawnOptions {
                model_id: automation.model_id.clone(),
                effort: automation.effort.clone(),
                remote_cwd: Some(remote_cwd),
            },
        )
        .map_err(format_agent_error)?
    } else {
        let probe = cli_probe::probe_cli(settings.manual_cli_path.as_deref());
        let cli = probe
            .path
            .map(PathBuf::from)
            .ok_or_else(|| "Pi CLI not found for headless automation".to_string())?;
        AcpClient::spawn_with_options(
            cli,
            cwd.clone(),
            SpawnOptions {
                model_id: automation.model_id.clone(),
                effort: automation.effort.clone(),
                remote_cwd: None,
            },
        )
        .map_err(format_agent_error)?
    };

    let prompt = if automation.repo.trim().is_empty() {
        automation.prompt.clone()
    } else {
        format!(
            "Repository: {}\n\n{}",
            automation.repo.trim(),
            automation.prompt
        )
    };
    let prompt = format!("[Scheduled: {}]\n\n{}", automation.title, prompt);
    store::append_message(
        &session.id,
        ChatMessageStored {
            id: Uuid::new_v4().to_string(),
            role: "user".into(),
            content: prompt.clone(),
            thought: None,
            model_id: automation.model_id.clone(),
            effort: automation.effort.clone(),
            created_at: Utc::now(),
            is_error: false,
            attachments: None,
            marker: None,
        },
    )?;

    client
        .initialize_and_open_session(None)
        .await
        .map_err(format_agent_error)?;
    let collector = tokio::spawn(async move { collect_events(&mut events).await });
    let prompt_result = client.prompt(&prompt, &[]).await;
    // Kill the agent before propagating any of these failures. `?` here used to
    // return past the kill, leaving an orphaned `pi` process behind on every
    // drain timeout — which in a daemon that ticks forever accumulates.
    let drained = tokio::time::timeout(EVENT_DRAIN_TIMEOUT, collector).await;
    client.kill().await;
    let captured = drained
        .map_err(|_| "headless automation event drain timed out".to_string())?
        .map_err(|error| format!("headless automation event collector failed: {error}"))??;

    if let Err(error) = prompt_result {
        return Err(format_agent_error(error));
    }
    if let Some(error) = captured.error.as_deref() {
        return Err(error.to_string());
    }

    let model = captured.model_id.or_else(|| automation.model_id.clone());
    if captured.saw_usage {
        crate::usage_ledger::append_with_metadata(
            &session.id,
            automation.project_id.as_deref(),
            model.as_deref(),
            captured.usage,
            Some(0),
            "success",
        )?;
    }
    if !captured.assistant.trim().is_empty() {
        store::append_message(
            &session.id,
            ChatMessageStored {
                id: Uuid::new_v4().to_string(),
                role: "assistant".into(),
                content: captured.assistant,
                thought: (!captured.thought.trim().is_empty()).then_some(captured.thought),
                model_id: model,
                effort: automation.effort.clone(),
                created_at: Utc::now(),
                is_error: false,
                attachments: None,
                marker: None,
            },
        )?;
    }

    crate::automation_ledger::mark_dispatched(run_id)?;
    let now = Utc::now();
    let next = next_run_at(automation, now);
    // A run that started late is still late when it succeeds — recording it as
    // on-time would erase the one signal that the daemon caught up after a
    // missed window.
    store::mark_automation_run(&automation.id, now, next, ran_late)?;
    if automation.frequency.eq_ignore_ascii_case("once") {
        store::set_automation_enabled(&automation.id, false)?;
    }
    Ok(())
}

async fn collect_events(events: &mut UnboundedReceiver<AcpEvent>) -> Result<CapturedTurn, String> {
    let mut captured = CapturedTurn::default();
    while let Some(event) = events.recv().await {
        match event {
            // Only a State event that names a model updates the capture; one
            // without leaves the previously seen id in place.
            AcpEvent::State {
                model_id: Some(model_id),
                ..
            } => {
                captured.model_id = Some(model_id);
            }
            AcpEvent::Stream { kind, text, .. } => match kind {
                StreamKind::Assistant => captured.assistant.push_str(&text),
                StreamKind::Thought => captured.thought.push_str(&text),
            },
            AcpEvent::Usage { usage } => {
                captured.usage.add(&usage);
                captured.saw_usage = true;
            }
            AcpEvent::Error { error } => {
                captured.error = Some(format_agent_error(error));
                break;
            }
            AcpEvent::ProcessExited => break,
            AcpEvent::PromptComplete { .. } => break,
            _ => {}
        }
    }
    Ok(captured)
}

fn format_agent_error(error: crate::error::AgentError) -> String {
    format!("{}: {}", error.code.as_str(), error.message)
}
