//! Honest local activity summary derived from the app-owned session journal.

use chrono::{Datelike, Duration, Local, NaiveDate};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::store;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDay {
    pub date: String,
    pub activities: u64,
    pub tokens: u64,
    pub cost_total: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTool {
    pub name: String,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageModel {
    pub model_id: String,
    pub tokens: u64,
    pub cost_total: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageProject {
    pub project_id: String,
    pub tokens: u64,
    pub cost_total: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageCacheDay {
    pub date: String,
    pub cache_read: u64,
    pub input: u64,
    pub hit_rate: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTurn {
    pub session_id: String,
    pub model_id: Option<String>,
    pub recorded_at: String,
    pub cost_total: f64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageAdoption {
    pub model_id: String,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageProviderHealth {
    pub provider_id: String,
    pub model_id: Option<String>,
    pub sample_count: u64,
    pub success_count: u64,
    pub failure_count: u64,
    pub average_latency_ms: Option<f64>,
    /// Deliberately absent until the ledger contains an error row. A success-only
    /// history is not evidence that a provider never fails outside the app.
    pub failure_rate: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageProfile {
    pub days: Vec<UsageDay>,
    pub measured_tokens: u64,
    pub measured_cost_total: Option<f64>,
    pub max_measured_session_tokens: u64,
    pub models: Vec<UsageModel>,
    pub total_estimated_tokens: u64,
    pub max_session_tokens: u64,
    pub longest_activity_secs: u64,
    pub current_streak_days: u64,
    pub longest_streak_days: u64,
    pub total_sessions: u64,
    pub total_turns: u64,
    pub total_tool_calls: u64,
    pub models_used: u64,
    pub most_used_effort: Option<String>,
    pub top_tools: Vec<UsageTool>,
    pub projects: Vec<UsageProject>,
    pub cache_days: Vec<UsageCacheDay>,
    pub most_expensive_turn: Option<UsageTurn>,
    pub adoptions: Vec<UsageAdoption>,
}

fn estimated_tokens(text: &str) -> u64 {
    if text.is_empty() {
        return 0;
    }
    (text.chars().count() as u64).div_ceil(4)
}

fn tool_name(line: &str) -> Option<&str> {
    let mut parts = line.trim().split('|');
    if parts.next()? != "tool_step" {
        return None;
    }
    let _status = parts.next()?;
    parts.next().map(str::trim).filter(|name| !name.is_empty())
}

fn streaks(days: &BTreeSet<NaiveDate>) -> (u64, u64) {
    let mut longest = 0_u64;
    let mut run = 0_u64;
    let mut previous: Option<NaiveDate> = None;
    for day in days {
        run = if previous
            .map(|value| *day == value + Duration::days(1))
            .unwrap_or(false)
        {
            run + 1
        } else {
            1
        };
        longest = longest.max(run);
        previous = Some(*day);
    }

    let today = Local::now().date_naive();
    let anchor = if days.contains(&today) {
        today
    } else if days.contains(&(today - Duration::days(1))) {
        today - Duration::days(1)
    } else {
        return (0, longest);
    };
    let mut current = 0_u64;
    let mut cursor = anchor;
    while days.contains(&cursor) {
        current += 1;
        cursor -= Duration::days(1);
    }
    (current, longest)
}

#[tauri::command]
pub async fn usage_profile() -> Result<UsageProfile, String> {
    let sessions = store::load_sessions_index();
    let mut days: BTreeMap<NaiveDate, (u64, u64)> = BTreeMap::new();
    let mut active_days = BTreeSet::new();
    let mut models = BTreeSet::new();
    let mut efforts: HashMap<String, u64> = HashMap::new();
    let mut tools: HashMap<String, u64> = HashMap::new();
    let ledger = crate::usage_ledger::load();
    let mut measured_by_day: BTreeMap<NaiveDate, (u64, Option<f64>)> = BTreeMap::new();
    let mut measured_by_model: HashMap<String, (u64, Option<f64>)> = HashMap::new();
    let mut measured_tokens = 0_u64;
    let mut measured_cost_total = None;
    let mut measured_by_session: HashMap<String, u64> = HashMap::new();
    let mut measured_by_project: HashMap<String, (u64, Option<f64>)> = HashMap::new();
    let mut cache_by_day: BTreeMap<NaiveDate, (u64, u64)> = BTreeMap::new();
    let mut most_expensive_turn: Option<UsageTurn> = None;
    for row in &ledger {
        let tokens = row.usage.total_tokens;
        let cost = row.usage.cost_total;
        measured_tokens += tokens;
        *measured_by_session
            .entry(row.session_id.clone())
            .or_default() += tokens;
        let project_key = row.project_id.clone().unwrap_or_else(|| "orphan".into());
        let project_entry = measured_by_project.entry(project_key).or_default();
        project_entry.0 += tokens;
        project_entry.1 = add_cost(project_entry.1, cost);
        measured_cost_total = add_cost(measured_cost_total, cost);
        let day = row.recorded_at.with_timezone(&Local).date_naive();
        let day_entry = measured_by_day.entry(day).or_default();
        day_entry.0 += tokens;
        day_entry.1 = add_cost(day_entry.1, cost);
        let cache = cache_by_day.entry(day).or_default();
        cache.0 += row.usage.cache_read;
        cache.1 += row.usage.input;
        if let Some(turn_cost) = cost.filter(|v| v.is_finite()) {
            if most_expensive_turn
                .as_ref()
                .map(|turn| turn_cost > turn.cost_total)
                .unwrap_or(true)
            {
                most_expensive_turn = Some(UsageTurn {
                    session_id: row.session_id.clone(),
                    model_id: row.model_id.clone(),
                    recorded_at: row.recorded_at.to_rfc3339(),
                    cost_total: turn_cost,
                    total_tokens: tokens,
                });
            }
        }
        if let Some(model) = row.model_id.as_deref().filter(|value| !value.is_empty()) {
            let entry = measured_by_model.entry(model.to_string()).or_default();
            entry.0 += tokens;
            entry.1 = add_cost(entry.1, cost);
            models.insert(model.to_string());
        }
    }
    let mut total_estimated_tokens = 0_u64;
    let mut max_session_tokens = 0_u64;
    let mut longest_activity_secs = 0_u64;
    let mut total_turns = 0_u64;
    let mut total_tool_calls = 0_u64;
    let mut adoptions: HashMap<String, u64> = HashMap::new();

    for session in &sessions {
        if let Some(model) = session
            .model_id
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            models.insert(model.to_string());
        }
        if let Some(effort) = session.effort.as_deref().filter(|value| !value.is_empty()) {
            *efforts.entry(effort.to_string()).or_default() += 1;
        }

        let messages = store::load_messages(&session.id);
        let mut session_tokens = 0_u64;
        let mut first = None;
        let mut last = None;
        for message in messages {
            if let Some(model) = message
                .marker
                .as_deref()
                .and_then(|marker| marker.strip_prefix("adopted_from:"))
            {
                if !model.trim().is_empty() {
                    *adoptions.entry(model.trim().to_string()).or_default() += 1;
                }
            }
            first.get_or_insert(message.created_at);
            last = Some(message.created_at);
            let tokens = estimated_tokens(&message.content)
                + message
                    .thought
                    .as_deref()
                    .map(estimated_tokens)
                    .unwrap_or(0);
            session_tokens += tokens;
            let day = message.created_at.with_timezone(&Local).date_naive();
            let entry = days.entry(day).or_default();
            entry.1 += tokens;
            if message.role == "user" {
                entry.0 += 1;
                total_turns += 1;
                active_days.insert(day);
            }
            for line in message.content.lines() {
                if let Some(name) = tool_name(line) {
                    *tools.entry(name.to_string()).or_default() += 1;
                    total_tool_calls += 1;
                }
            }
        }
        total_estimated_tokens += session_tokens;
        max_session_tokens = max_session_tokens.max(session_tokens);
        if let (Some(start), Some(end)) = (first, last) {
            longest_activity_secs =
                longest_activity_secs.max((end - start).num_seconds().max(0) as u64);
        }
    }

    // Ledger rows remain available after the live process is gone, so expose
    // days that have measured usage even when their session is not loaded.
    for (date, (tokens, _)) in &measured_by_day {
        days.entry(*date).or_insert((0, *tokens));
        active_days.insert(*date);
    }

    let (current_streak_days, longest_streak_days) = streaks(&active_days);
    let mut top_tools: Vec<UsageTool> = tools
        .into_iter()
        .map(|(name, count)| UsageTool { name, count })
        .collect();
    top_tools.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    top_tools.truncate(5);
    let most_used_effort = efforts
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
        .map(|(name, _)| name);
    let mut adoption_rows: Vec<UsageAdoption> = adoptions
        .into_iter()
        .map(|(model_id, count)| UsageAdoption { model_id, count })
        .collect();
    adoption_rows.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| a.model_id.cmp(&b.model_id))
    });

    let mut model_rows: Vec<UsageModel> = measured_by_model
        .into_iter()
        .map(|(model_id, (tokens, cost_total))| UsageModel {
            model_id,
            tokens,
            cost_total,
        })
        .collect();
    model_rows.sort_by(|a, b| {
        b.tokens
            .cmp(&a.tokens)
            .then_with(|| a.model_id.cmp(&b.model_id))
    });

    let mut project_rows: Vec<UsageProject> = measured_by_project
        .into_iter()
        .map(|(project_id, (tokens, cost_total))| UsageProject {
            project_id,
            tokens,
            cost_total,
        })
        .collect();
    project_rows.sort_by(|a, b| {
        b.tokens
            .cmp(&a.tokens)
            .then_with(|| a.project_id.cmp(&b.project_id))
    });

    let cache_days = cache_by_day
        .into_iter()
        .map(|(date, (cache_read, input))| UsageCacheDay {
            date: date.format("%Y-%m-%d").to_string(),
            cache_read,
            input,
            hit_rate: if input + cache_read == 0 {
                0.0
            } else {
                cache_read as f64 / (input + cache_read) as f64
            },
        })
        .collect();

    Ok(UsageProfile {
        days: days
            .into_iter()
            .map(|(date, (activities, _legacy_tokens))| {
                let (tokens, cost_total) = measured_by_day.get(&date).copied().unwrap_or_default();
                UsageDay {
                    date: date.format("%Y-%m-%d").to_string(),
                    activities,
                    tokens,
                    cost_total,
                }
            })
            .collect(),
        measured_tokens,
        measured_cost_total,
        max_measured_session_tokens: measured_by_session.values().copied().max().unwrap_or(0),
        models: model_rows,
        total_estimated_tokens,
        max_session_tokens,
        longest_activity_secs,
        current_streak_days,
        longest_streak_days,
        total_sessions: sessions.len() as u64,
        total_turns,
        total_tool_calls,
        models_used: models.len() as u64,
        most_used_effort,
        top_tools,
        projects: project_rows,
        cache_days,
        most_expensive_turn,
        adoptions: adoption_rows,
    })
}

fn model_tier(model_id: &str) -> &'static str {
    let id = model_id.to_ascii_lowercase();
    if id.contains("ollama") || id.contains("lmstudio") || id.starts_with("local/") {
        "local"
    } else if id.contains("haiku")
        || id.contains("mini")
        || id.contains("flash")
        || id.contains("small")
        || id.contains("deepseek")
    {
        "cheap"
    } else if id.contains("opus")
        || id.contains("o1")
        || id.contains("o3")
        || id.contains("gpt-5")
        || id.contains("sonnet")
    {
        "premium"
    } else {
        "default"
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBudgetStatus {
    pub tier: String,
    pub month_cost: f64,
    pub session_cost: f64,
    pub monthly_limit: Option<f64>,
    pub session_limit: Option<f64>,
    pub warning: bool,
    pub requires_confirm: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCacheStanding {
    pub session_id: String,
    pub cache_read: u64,
    pub input: u64,
    pub hit_rate: f64,
}

#[tauri::command]
pub async fn session_cache_standings() -> Result<Vec<SessionCacheStanding>, String> {
    let mut by_session: HashMap<String, (u64, u64)> = HashMap::new();
    for row in crate::usage_ledger::load() {
        let entry = by_session.entry(row.session_id).or_default();
        entry.0 += row.usage.cache_read;
        entry.1 += row.usage.input;
    }
    Ok(by_session
        .into_iter()
        .map(|(session_id, (cache_read, input))| SessionCacheStanding {
            session_id,
            cache_read,
            input,
            hit_rate: if cache_read + input == 0 {
                0.0
            } else {
                cache_read as f64 / (cache_read + input) as f64
            },
        })
        .collect())
}

#[tauri::command]
pub async fn usage_session_summary(
    session_id: String,
) -> Result<crate::token_usage::TokenUsage, String> {
    let rows = crate::usage_ledger::load();
    Ok(crate::usage_ledger::sum_usage(
        &rows
            .into_iter()
            .filter(|row| row.session_id == session_id)
            .collect::<Vec<_>>(),
    ))
}

fn provider_key(model_id: Option<&str>) -> String {
    let model = model_id.unwrap_or("unknown").trim();
    model
        .split_once('/')
        .map(|(provider, _)| provider)
        .filter(|provider| !provider.is_empty())
        .unwrap_or(if model.is_empty() { "unknown" } else { model })
        .to_string()
}

#[derive(Default)]
struct HealthBucket {
    rows: Vec<crate::usage_ledger::UsageLedgerRow>,
}

/// Rolling provider/model health from measured turns and explicit failure rows.
/// The command is cheap enough for the model menu and keeps the aggregation out
/// of the React tree. Old ledgers without outcome/latency remain valid.
#[tauri::command]
pub async fn usage_provider_health() -> Result<Vec<UsageProviderHealth>, String> {
    let mut buckets: HashMap<(String, Option<String>), HealthBucket> = HashMap::new();
    for row in crate::usage_ledger::load() {
        let key = (provider_key(row.model_id.as_deref()), row.model_id.clone());
        buckets.entry(key).or_default().rows.push(row);
    }
    let mut result = Vec::with_capacity(buckets.len());
    for ((provider_id, model_id), mut bucket) in buckets {
        bucket.rows.sort_by_key(|row| row.recorded_at);
        let rows = bucket.rows.into_iter().rev().take(40).collect::<Vec<_>>();
        let sample_count = rows.len() as u64;
        let success_count = rows.iter().filter(|row| row.outcome != "failure").count() as u64;
        let failure_count = rows.iter().filter(|row| row.outcome == "failure").count() as u64;
        let latencies = rows
            .iter()
            .filter_map(|row| row.latency_ms)
            .collect::<Vec<_>>();
        let average_latency_ms = (!latencies.is_empty()).then(|| {
            latencies.iter().map(|value| *value as f64).sum::<f64>() / latencies.len() as f64
        });
        let failure_rate = (failure_count > 0 && sample_count > 0)
            .then(|| failure_count as f64 / sample_count as f64);
        result.push(UsageProviderHealth {
            provider_id,
            model_id,
            sample_count,
            success_count,
            failure_count,
            average_latency_ms,
            failure_rate,
        });
    }
    result.sort_by(|a, b| {
        a.provider_id
            .cmp(&b.provider_id)
            .then_with(|| a.model_id.cmp(&b.model_id))
    });
    Ok(result)
}

/// Budget status is deliberately advisory. At the ceiling the UI asks for an
/// explicit confirmation; it never silently discards a user's turn.
#[tauri::command]
pub async fn usage_budget_status(
    session_id: Option<String>,
    model_id: String,
) -> Result<UsageBudgetStatus, String> {
    let settings = store::load_settings();
    let tier = model_tier(&model_id).to_string();
    let monthly_limit = settings
        .budget_monthly_by_tier
        .get(&tier)
        .copied()
        .filter(|v| *v > 0.0);
    let session_limit = settings
        .budget_session_by_tier
        .get(&tier)
        .copied()
        .filter(|v| *v > 0.0);
    let now = Local::now();
    let month_cost = crate::usage_ledger::load()
        .into_iter()
        .filter(|row| {
            let local = row.recorded_at.with_timezone(&Local);
            local.year() == now.year()
                && local.month() == now.month()
                && model_tier(row.model_id.as_deref().unwrap_or("auto")) == tier
        })
        .filter_map(|row| row.usage.cost_total)
        .sum::<f64>();
    let session_cost = session_id
        .as_deref()
        .map(|sid| {
            crate::usage_ledger::load()
                .into_iter()
                .filter(|row| {
                    row.session_id == sid
                        && model_tier(row.model_id.as_deref().unwrap_or("auto")) == tier
                })
                .filter_map(|row| row.usage.cost_total)
                .sum::<f64>()
        })
        .unwrap_or(0.0);
    let monthly_ratio = monthly_limit.map(|limit| month_cost / limit).unwrap_or(0.0);
    let session_ratio = session_limit
        .map(|limit| session_cost / limit)
        .unwrap_or(0.0);
    Ok(UsageBudgetStatus {
        tier,
        month_cost,
        session_cost,
        monthly_limit,
        session_limit,
        warning: monthly_ratio >= 0.8 || session_ratio >= 0.8,
        requires_confirm: monthly_ratio >= 1.0 || session_ratio >= 1.0,
    })
}

fn add_cost(current: Option<f64>, next: Option<f64>) -> Option<f64> {
    match (current, next) {
        (Some(a), Some(b)) => Some(a + b),
        (Some(a), None) => Some(a),
        (None, value) => value,
    }
}

#[cfg(test)]
mod tests {
    use super::{estimated_tokens, provider_key, streaks, tool_name};
    use chrono::NaiveDate;
    use std::collections::BTreeSet;

    #[test]
    fn token_estimate_and_tool_parser_are_stable() {
        assert_eq!(estimated_tokens("12345"), 2);
        assert_eq!(
            tool_name("tool_step|completed|run_terminal_command|pnpm test"),
            Some("run_terminal_command")
        );
        assert_eq!(tool_name("ordinary text"), None);
    }

    #[test]
    fn longest_streak_counts_consecutive_days() {
        let days = ["2026-07-20", "2026-07-21", "2026-07-23"]
            .into_iter()
            .map(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap())
            .collect::<BTreeSet<_>>();
        let (_, longest) = streaks(&days);
        assert_eq!(longest, 2);
    }

    #[test]
    fn provider_health_key_prefers_provider_prefix_without_inventing_one() {
        assert_eq!(provider_key(Some("anthropic/claude-sonnet")), "anthropic");
        assert_eq!(provider_key(Some("local-model")), "local-model");
        assert_eq!(provider_key(None), "unknown");
    }
}
