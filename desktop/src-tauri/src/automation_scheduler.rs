//! Host-side automation scheduler.
//!
//! Scheduling belongs to the host, not the webview. The webview can disappear
//! when the window is hidden and a closed app cannot run a JavaScript timer.

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Datelike, Local, TimeZone, Utc};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::session_manager::SessionManager;
use crate::store::{self, Automation};

const TICK: Duration = Duration::from_secs(30);

pub fn start(app: AppHandle, manager: Arc<SessionManager>) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(TICK);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        // Run immediately after setup so work missed while the app was closed
        // is caught up without waiting for the first 30-second tick.
        loop {
            ticker.tick().await;
            run_due(&app, &manager).await;
        }
    });
}

async fn run_due(app: &AppHandle, manager: &Arc<SessionManager>) {
    let now = Utc::now();
    let rows = store::load_automations();
    for automation in rows.into_iter().filter(|row| is_due(row, now)) {
        let claim_path = crate::paths::automation_claim_file(&automation.id);
        let Ok(_claim) = crate::store_lock::lock_exclusive(&claim_path) else {
            tracing::debug!(
                automation = %automation.id,
                "scheduled automation is already claimed by another runner"
            );
            continue;
        };
        let scheduled_at = automation.next_run_at.unwrap_or(now);
        let ran_late = now.signed_duration_since(scheduled_at).num_seconds() > 90;
        match run_one(app, manager, &automation, ran_late).await {
            Ok(()) => tracing::info!(automation = %automation.id, "scheduled automation ran"),
            Err(error) => {
                tracing::warn!(automation = %automation.id, "scheduled automation failed: {error}");
                let next = next_run_at(&automation, now);
                let failed = store::mark_automation_failure(
                    &automation.id,
                    now,
                    next,
                    ran_late,
                    &error,
                    automation.frequency.eq_ignore_ascii_case("once"),
                );
                let _ = app.emit(
                    "automation://failed",
                    json!({
                        "automationId": automation.id,
                        "message": error,
                        "nextRunAt": failed.as_ref().ok().and_then(|row| row.next_run_at),
                        "ranLate": ran_late,
                    }),
                );
                if let Err(mark_error) = failed {
                    tracing::warn!(
                        automation = %automation.id,
                        "could not persist scheduled automation failure: {mark_error}"
                    );
                }
            }
        }
    }
}

async fn run_one(
    app: &AppHandle,
    manager: &Arc<SessionManager>,
    automation: &Automation,
    ran_late: bool,
) -> Result<(), String> {
    let scheduled_at = automation.next_run_at;
    let run = crate::automation_ledger::start(
        &automation.id,
        None,
        "schedule",
        None,
        scheduled_at,
        ran_late,
        automation.model_id.as_deref(),
        automation.effort.as_deref(),
    )?;
    let run_id = run.id.clone();
    let result = async {
        let project = automation.project_id.as_deref().and_then(|id| {
            store::load_projects()
                .into_iter()
                .find(|project| project.id == id)
        });
        if project.as_ref().is_some_and(|value| !value.trusted) {
            return Err("project is not trusted".into());
        }

        let session = store::create_session(
            automation.project_id.clone(),
            Some(automation.title.clone()),
            true,
        )?;
        crate::automation_ledger::attach_session(&run_id, &session.id)?;
        store::attach_automation_run(&session.id, &automation.id, &run_id)?;
        store::set_session_agent_prefs(
            &session.id,
            automation.model_id.as_deref(),
            automation.effort.as_deref(),
        )?;

        let connected = manager
            .connect(
                app.clone(),
                project.as_ref().map(|value| value.path.clone()),
                None,
                Some(session.id.clone()),
                Some("agent".into()),
            )
            .await?;
        if connected.state != crate::session_fsm::SessionState::Ready {
            return Err(connected
                .last_error
                .map(|error| error.message)
                .unwrap_or_else(|| "agent did not become ready".into()));
        }

        let body = if automation.repo.trim().is_empty() {
            automation.prompt.clone()
        } else {
            format!(
                "Repository: {}\n\n{}",
                automation.repo.trim(),
                automation.prompt
            )
        };
        let prompt = format!("[Scheduled: {}]\n\n{}", automation.title, body);
        manager
            .send_message(app.clone(), prompt, None, None, Some(session.id.clone()))
            .await
            .map_err(|error| error.to_string())?;

        crate::automation_ledger::mark_dispatched(&run_id)?;
        let last = Utc::now();
        let next = next_run_at(automation, last);
        let updated = store::mark_automation_run(&automation.id, last, next, ran_late)?;
        if automation.frequency.eq_ignore_ascii_case("once") {
            store::set_automation_enabled(&automation.id, false)?;
        }
        let _ = app.emit(
            "automation://ran",
            json!({
                "automationId": updated.id,
                "runId": run_id.clone(),
                "sessionId": session.id,
                "status": "dispatched",
                "ranLate": ran_late,
                "nextRunAt": updated.next_run_at,
            }),
        );
        Ok(())
    }
    .await;

    if let Err(error) = &result {
        let _ = crate::automation_ledger::finish(&run_id, "failed", None, Some(error));
    }
    result
}

pub(crate) fn is_due(automation: &Automation, now: DateTime<Utc>) -> bool {
    automation.enabled && automation.next_run_at.is_some_and(|next| next <= now)
}

pub(crate) fn next_run_at(automation: &Automation, from: DateTime<Utc>) -> Option<DateTime<Utc>> {
    if automation.frequency.eq_ignore_ascii_case("once") || !automation.enabled {
        return None;
    }
    let local_from = from.with_timezone(&Local);
    let (hour, minute) = automation
        .time
        .split_once(':')
        .and_then(|(h, m)| Some((h.parse::<u32>().ok()?, m.parse::<u32>().ok()?)))?;
    if hour > 23 || minute > 59 {
        return None;
    }
    for offset in 0..15 {
        let date = local_from.date_naive() + chrono::Duration::days(offset);
        let candidate = date.and_hms_opt(hour, minute, 0)?;
        let local = Local.from_local_datetime(&candidate).single()?;
        if local <= local_from {
            continue;
        }
        let weekday = local.weekday().num_days_from_sunday() as u8;
        let matches = match automation.frequency.to_ascii_lowercase().as_str() {
            "weekdays" => (1..=5).contains(&weekday),
            "weekly" => automation.weekdays.is_empty() || automation.weekdays.contains(&weekday),
            _ => true,
        };
        if matches {
            return Some(local.with_timezone(&Utc));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn row(next_run_at: Option<DateTime<Utc>>) -> Automation {
        Automation {
            id: "a".into(),
            title: "test".into(),
            prompt: "run".into(),
            enabled: true,
            repo: String::new(),
            project_id: None,
            model_id: None,
            effort: None,
            frequency: "daily".into(),
            time: "09:00".into(),
            weekdays: vec![],
            notify: "all".into(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_run_at: None,
            next_run_at,
            last_run_late: false,
            last_run_error: None,
            last_run_error_at: None,
        }
    }

    #[test]
    fn only_past_enabled_slots_are_due() {
        let now = Utc.with_ymd_and_hms(2026, 8, 3, 10, 0, 0).unwrap();
        assert!(is_due(&row(Some(now - chrono::Duration::minutes(1))), now));
        assert!(!is_due(&row(Some(now + chrono::Duration::minutes(1))), now));
        let mut disabled = row(Some(now - chrono::Duration::minutes(1)));
        disabled.enabled = false;
        assert!(!is_due(&disabled, now));
    }

    #[test]
    fn failure_cursor_moves_to_the_next_slot() {
        let now = Utc.with_ymd_and_hms(2026, 8, 3, 10, 0, 0).unwrap();
        let auto = row(Some(now - chrono::Duration::minutes(2)));
        let next = next_run_at(&auto, now).expect("daily automation has a next slot");
        assert!(next > now);
        let mut advanced = auto;
        advanced.next_run_at = Some(next);
        assert!(!is_due(&advanced, next - chrono::Duration::seconds(1)));
    }
}
