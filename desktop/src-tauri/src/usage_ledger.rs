//! Durable, append-only token usage ledger.
//!
//! A session's live total is useful for the composer, but it is not a history.
//! Keep one measured row per completed Pi turn so usage survives process recycle
//! and restart without making the session journal carry billing data.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

use crate::paths;
use crate::token_usage::TokenUsage;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageLedgerRow {
    pub id: String,
    pub session_id: String,
    pub project_id: Option<String>,
    pub model_id: Option<String>,
    pub recorded_at: DateTime<Utc>,
    pub usage: TokenUsage,
    /// Wall-clock time from prompt dispatch to provider completion.
    #[serde(default)]
    pub latency_ms: Option<u64>,
    /// `success` for measured turns, `failure` for a provider/process error.
    #[serde(default = "default_outcome")]
    pub outcome: String,
    /// `AgentErrorCode` for a failure row, so a channel that refuses for
    /// balance can be told apart from one that blipped. `None` on success and
    /// on rows written before this field existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<String>,
}

/// Failure codes that mean the channel cannot run at all until the user does
/// something about it — as opposed to a timeout or a provider hiccup, which
/// says nothing about whether the next attempt will work.
///
/// Marking a model on a transient failure would be worse than not marking it:
/// the mark would be wrong most of the time and people would learn to ignore it.
pub fn is_blocking_failure(code: &str) -> bool {
    matches!(code, "QUOTA_EXCEEDED" | "AUTH_FAILED")
}

fn default_outcome() -> String {
    "success".into()
}

pub fn append_with_metadata(
    session_id: &str,
    project_id: Option<&str>,
    model_id: Option<&str>,
    usage: TokenUsage,
    latency_ms: Option<u64>,
    outcome: &str,
) -> Result<UsageLedgerRow, String> {
    append_failure_aware(
        session_id, project_id, model_id, usage, latency_ms, outcome, None,
    )
}

/// As [`append_with_metadata`], carrying the `AgentErrorCode` of a failure.
#[allow(clippy::too_many_arguments)]
pub fn append_failure_aware(
    session_id: &str,
    project_id: Option<&str>,
    model_id: Option<&str>,
    usage: TokenUsage,
    latency_ms: Option<u64>,
    outcome: &str,
    failure_code: Option<&str>,
) -> Result<UsageLedgerRow, String> {
    let failed = outcome == "failure";
    let row = UsageLedgerRow {
        id: uuid::Uuid::new_v4().to_string(),
        session_id: session_id.to_string(),
        project_id: project_id.map(str::to_string),
        model_id: model_id.map(str::to_string),
        recorded_at: Utc::now(),
        usage,
        latency_ms,
        outcome: if failed {
            "failure".into()
        } else {
            "success".into()
        },
        // A code on a success row would be meaningless; drop it rather than
        // store something a later query has to know to ignore.
        failure_code: failed.then(|| failure_code.map(str::to_string)).flatten(),
    };
    append_to(&paths::usage_ledger_file(), &row)?;
    Ok(row)
}

pub fn append_to(path: &Path, row: &UsageLedgerRow) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, row).map_err(|e| e.to_string())?;
    file.write_all(b"\n").map_err(|e| e.to_string())
}

pub fn load() -> Vec<UsageLedgerRow> {
    load_from(&paths::usage_ledger_file())
}

pub fn load_from(path: &Path) -> Vec<UsageLedgerRow> {
    let Ok(file) = fs::File::open(path) else {
        return Vec::new();
    };
    // `map_while`, not `filter_map`: a read error means the rest of the file is
    // unreadable too, so skipping past it would spin rather than terminate.
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str(&line).ok())
        .collect()
}

/// Models whose most recent turn was refused for balance or entitlement.
///
/// Only the *latest* row per model decides. A model that refused last week and
/// has worked since is fine, and a menu that kept flagging it would be telling
/// the user something that stopped being true — the failure log is a history,
/// but the question here is about the present.
pub fn blocked_models() -> Vec<String> {
    blocked_models_in(&load())
}

pub fn blocked_models_in(rows: &[UsageLedgerRow]) -> Vec<String> {
    let mut latest: std::collections::HashMap<&str, (&DateTime<Utc>, bool)> =
        std::collections::HashMap::new();
    for row in rows {
        let Some(model) = row.model_id.as_deref().filter(|id| !id.is_empty()) else {
            continue;
        };
        let blocking = row.outcome == "failure"
            && row
                .failure_code
                .as_deref()
                .is_some_and(is_blocking_failure);
        match latest.get(model) {
            Some((seen, _)) if **seen >= row.recorded_at => {}
            _ => {
                latest.insert(model, (&row.recorded_at, blocking));
            }
        }
    }
    let mut blocked: Vec<String> = latest
        .into_iter()
        .filter(|(_, (_, blocking))| *blocking)
        .map(|(model, _)| model.to_string())
        .collect();
    blocked.sort();
    blocked
}

/// Fold measured rows for a query scope while preserving the provider's
/// `cost_total: None` semantics.
pub fn sum_usage(rows: &[UsageLedgerRow]) -> TokenUsage {
    let mut total = TokenUsage::default();
    for row in rows {
        total.add(&row.usage);
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "pi-app-usage-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn round_trips_rows_across_a_restart() {
        let path = temp_path("roundtrip");
        let row = UsageLedgerRow {
            id: "turn-1".into(),
            session_id: "session-1".into(),
            project_id: Some("project-1".into()),
            model_id: Some("gpt-5.6".into()),
            recorded_at: Utc::now(),
            usage: TokenUsage {
                input: 12,
                output: 8,
                cache_read: 30,
                total_tokens: 50,
                cost_total: None,
                ..Default::default()
            },
            latency_ms: Some(123),
            outcome: "success".into(),
            failure_code: None,
        };
        append_to(&path, &row).unwrap();
        assert_eq!(load_from(&path), vec![row]);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn ignores_a_torn_last_line() {
        let path = temp_path("torn");
        fs::write(&path, "{\"not-complete\"").unwrap();
        assert!(load_from(&path).is_empty());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn grouping_keeps_known_cost_when_another_row_has_no_cost() {
        let rows = vec![
            UsageLedgerRow {
                id: "a".into(),
                session_id: "s".into(),
                project_id: None,
                model_id: Some("m".into()),
                recorded_at: Utc::now(),
                usage: TokenUsage {
                    total_tokens: 4,
                    cost_total: Some(0.25),
                    ..Default::default()
                },
                latency_ms: None,
                outcome: "success".into(),
                failure_code: None,
            },
            UsageLedgerRow {
                id: "b".into(),
                session_id: "s".into(),
                project_id: None,
                model_id: Some("m".into()),
                recorded_at: Utc::now(),
                usage: TokenUsage {
                    total_tokens: 6,
                    cost_total: None,
                    ..Default::default()
                },
                latency_ms: None,
                outcome: "success".into(),
                failure_code: None,
            },
        ];
        let total = sum_usage(&rows);
        assert_eq!(total.total_tokens, 10);
        assert_eq!(total.cost_total, Some(0.25));
    }

    fn row(model: &str, minutes_ago: i64, outcome: &str, code: Option<&str>) -> UsageLedgerRow {
        UsageLedgerRow {
            id: format!("{model}-{minutes_ago}"),
            session_id: "s".into(),
            project_id: None,
            model_id: Some(model.into()),
            recorded_at: Utc::now() - chrono::Duration::minutes(minutes_ago),
            usage: TokenUsage::default(),
            latency_ms: None,
            outcome: outcome.into(),
            failure_code: code.map(str::to_string),
        }
    }

    #[test]
    fn a_refusal_for_balance_blocks_the_model() {
        let rows = vec![row("zai/glm-4.7", 1, "failure", Some("QUOTA_EXCEEDED"))];
        assert_eq!(blocked_models_in(&rows), vec!["zai/glm-4.7".to_string()]);
    }

    /// A timeout says nothing about whether the next attempt works. Marking on
    /// one would make the mark wrong most of the time, and people would learn
    /// to ignore it.
    #[test]
    fn a_transient_failure_does_not_block() {
        let rows = vec![row("xai-auth/grok-4.5", 1, "failure", Some("NETWORK_PROVIDER"))];
        assert!(blocked_models_in(&rows).is_empty());
    }

    /// The question is about the present, not the history: a model that refused
    /// last week and has worked since is fine.
    #[test]
    fn a_later_success_clears_an_earlier_refusal() {
        let rows = vec![
            row("zai/glm-4.7", 60, "failure", Some("QUOTA_EXCEEDED")),
            row("zai/glm-4.7", 1, "success", None),
        ];
        assert!(blocked_models_in(&rows).is_empty());
    }

    #[test]
    fn a_later_refusal_overrides_an_earlier_success() {
        let rows = vec![
            row("zai/glm-4.7", 60, "success", None),
            row("zai/glm-4.7", 1, "failure", Some("AUTH_FAILED")),
        ];
        assert_eq!(blocked_models_in(&rows), vec!["zai/glm-4.7".to_string()]);
    }

    #[test]
    fn models_are_judged_independently() {
        let rows = vec![
            row("zai/glm-4.7", 2, "failure", Some("QUOTA_EXCEEDED")),
            row("xai-auth/grok-4.5", 1, "success", None),
        ];
        assert_eq!(blocked_models_in(&rows), vec!["zai/glm-4.7".to_string()]);
    }

    /// Rows written before `failure_code` existed carry no code, and guessing
    /// one from a bare "failure" would flag transient errors as dead channels.
    #[test]
    fn a_legacy_failure_row_without_a_code_does_not_block() {
        let rows = vec![row("zai/glm-4.7", 1, "failure", None)];
        assert!(blocked_models_in(&rows).is_empty());
    }

    #[test]
    fn a_success_row_never_carries_a_failure_code() {
        let path = temp_path("nocode");
        let written = append_failure_aware(
            "s", None, Some("m"), TokenUsage::default(), None, "success", Some("QUOTA_EXCEEDED"),
        );
        assert_eq!(written.unwrap().failure_code, None);
        let _ = fs::remove_file(path);
    }
}
