//! Live model catalog from `pi --list-models`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::store;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningEffort {
    pub id: String,
    pub value: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModel {
    pub id: String,
    pub label: String,
    /// Catalog source, usually a Pi provider id or "custom" for app-configured providers.
    pub source: String,
    /// Context window in tokens, read from the CLI's own `context` column.
    /// Falls back to a small table only for entries the CLI does not list,
    /// such as app-configured custom providers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    /// The last turn on this model was refused for balance or entitlement, so
    /// choosing it will cost a wait and another refusal rather than an answer.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub blocked: bool,
    #[serde(default)]
    pub is_default: bool,
    /// Per-model reasoning efforts from CLI `info.reasoning_efforts` (may be empty).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reasoning_efforts: Vec<ReasoningEffort>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModelsResult {
    pub models: Vec<AvailableModel>,
    pub default_model_id: String,
    pub origin: Option<String>,
    pub fetched_at: Option<String>,
}

/// Models the user can select in the composer.
///
/// Official Pi CLI ids plus configured custom provider ids. Custom entries are
/// deliberately marked as `custom` so a per-session choice cannot be mistaken
/// for an official catalog model.
pub fn list_available_models() -> AvailableModelsResult {
    let settings = store::load_settings();
    // Read once: the ledger is a file, and the catalog can hold many models.
    let blocked = crate::usage_ledger::blocked_models();
    let mut by_id: BTreeMap<String, AvailableModel> = BTreeMap::new();
    by_id.insert(
        "auto".into(),
        AvailableModel {
            id: "auto".into(),
            label: "Pi default".into(),
            source: "pi".into(),
            context_window: Some(context_window_for("auto")),
            // `auto` is whatever Pi picks; there is no single channel to block.
            blocked: false,
            is_default: true,
            reasoning_efforts: pi_thinking_efforts(),
        },
    );

    let probe = crate::cli_probe::probe_cli(settings.manual_cli_path.as_deref());
    if let Some(path) = probe.path {
        let mut cmd = std::process::Command::new(path);
        cmd.arg("--list-models");
        crate::process_util::apply_no_window_std(&mut cmd);
        if let Some(path) = crate::process_util::enriched_path_env() {
            cmd.env("PATH", path);
        }
        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines().skip(1) {
                    let cols = line.split_whitespace().collect::<Vec<_>>();
                    if cols.len() < 2 {
                        continue;
                    }
                    let provider = cols[0];
                    let model = cols[1];
                    let id = format!("{provider}/{model}");
                    let reasoning = cols.get(4).is_some_and(|v| *v == "yes");
                    // The CLI reports the real window in the `context` column.
                    // Guessing it from the id instead was wrong for every model
                    // outside a four-name table — a 1M-context model shown as
                    // 128K reads as full at an eighth of its actual capacity.
                    let context_window = cols
                        .get(2)
                        .and_then(|raw| parse_context_window(raw))
                        .unwrap_or_else(|| context_window_for(&id));
                    by_id.insert(
                        id.clone(),
                        AvailableModel {
                            id: id.clone(),
                            label: model.to_string(),
                            source: provider.to_string(),
                            context_window: Some(context_window),
                            blocked: blocked.contains(&id),
                            is_default: false,
                            reasoning_efforts: if reasoning {
                                pi_thinking_efforts()
                            } else {
                                vec![ReasoningEffort {
                                    id: "off".into(),
                                    value: "off".into(),
                                    label: "Off".into(),
                                    description: String::new(),
                                    is_default: true,
                                }]
                            },
                        },
                    );
                }
            }
        }
    }

    let preferred = settings
        .model_id
        .clone()
        .filter(|s| by_id.contains_key(s))
        .unwrap_or_else(|| "auto".into());

    let mut models: Vec<AvailableModel> = by_id.into_values().collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    for m in &mut models {
        m.is_default = m.id == preferred;
    }

    if let Ok(custom) = crate::providers::list_custom_providers() {
        for provider in custom.providers {
            if models.iter().any(|model| model.id == provider.id) {
                continue;
            }
            models.push(AvailableModel {
                id: provider.id.clone(),
                label: format!("{} · {}", provider.name, provider.model),
                source: "custom".into(),
                context_window: Some(context_window_for(&provider.id)),
                blocked: blocked.contains(&provider.id),
                is_default: provider.is_default,
                reasoning_efforts: pi_thinking_efforts(),
            });
        }
        models.sort_by(|a, b| a.source.cmp(&b.source).then_with(|| a.id.cmp(&b.id)));
    }

    AvailableModelsResult {
        models,
        default_model_id: preferred,
        origin: Some("pi --list-models".into()),
        fetched_at: None,
    }
}

/// Parse the `context` column of `pi --list-models` — `500K`, `1M`, `204.8K`.
///
/// The CLI prints binary window sizes in decimal notation (`131.1K` for
/// 131,072), so this reads a little low. That is the right direction to be
/// wrong in for a gauge that answers "how full am I": it warns marginally
/// early rather than claiming room that is not there.
fn parse_context_window(raw: &str) -> Option<u64> {
    let trimmed = raw.trim();
    let (digits, multiplier) = match trimmed.as_bytes().last()? {
        b'K' | b'k' => (&trimmed[..trimmed.len() - 1], 1_000.0_f64),
        b'M' | b'm' => (&trimmed[..trimmed.len() - 1], 1_000_000.0_f64),
        _ => (trimmed, 1.0_f64),
    };
    let value: f64 = digits.parse().ok()?;
    if !value.is_finite() || value <= 0.0 {
        return None;
    }
    Some((value * multiplier).round() as u64)
}

/// Last-resort window for entries with no CLI row to read — custom providers,
/// and the synthetic `auto`. Only ever a guess; anything the CLI lists uses
/// [`parse_context_window`] against the real reported figure instead.
fn context_window_for(id: &str) -> u64 {
    let lower = id.to_ascii_lowercase();
    if lower.contains("claude") {
        return 200_000;
    }
    if lower.contains("gpt-5") {
        return 400_000;
    }
    if lower.contains("gemini") {
        return 1_000_000;
    }
    128_000
}

fn pi_thinking_efforts() -> Vec<ReasoningEffort> {
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
        .into_iter()
        .map(|id| ReasoningEffort {
            id: id.into(),
            value: id.into(),
            label: match id {
                "xhigh" => "Extra high".into(),
                _ => {
                    let mut chars = id.chars();
                    chars
                        .next()
                        .map(|c| c.to_uppercase().collect::<String>() + chars.as_str())
                        .unwrap_or_default()
                }
            },
            description: String::new(),
            is_default: id == "medium",
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_suffixes_the_cli_prints() {
        assert_eq!(parse_context_window("500K"), Some(500_000));
        assert_eq!(parse_context_window("1M"), Some(1_000_000));
        assert_eq!(parse_context_window("1.0M"), Some(1_000_000));
        assert_eq!(parse_context_window("204.8K"), Some(204_800));
        assert_eq!(parse_context_window("131.1K"), Some(131_100));
        assert_eq!(parse_context_window(" 128K "), Some(128_000));
        assert_eq!(parse_context_window("65536"), Some(65_536));
    }

    #[test]
    fn refuses_what_it_cannot_read_so_the_caller_can_fall_back() {
        assert_eq!(parse_context_window(""), None);
        assert_eq!(parse_context_window("n/a"), None);
        assert_eq!(parse_context_window("K"), None);
        assert_eq!(parse_context_window("0"), None);
        assert_eq!(parse_context_window("-5K"), None);
    }

    /// Regression: the window was guessed from the model id against a table
    /// naming only claude / gpt-5 / grok / gemini. A catalog of qwen, minimax,
    /// kimi, glm and grok models — an ordinary multi-provider setup — got the
    /// 128K default for almost every entry, so a 1M-context model reported
    /// itself full at an eighth of its capacity.
    #[test]
    fn reads_the_real_window_for_a_multi_provider_catalog() {
        let listing = "\
provider               model                   context  max-out  thinking  images
minimax                MiniMax-M3              1M       128K     yes       yes
qwen-token-plan        kimi-k2.7-code          262.1K   262.1K   yes       yes
qwen-token-plan        qwen3.7-max             1M       131.1K   yes       no
xai-auth               grok-4.5                500K     131.1K   yes       yes
zai                    glm-4.5-air             131.1K   98.3K    yes       no";

        let windows: Vec<u64> = listing
            .lines()
            .skip(1)
            .filter_map(|line| {
                let cols = line.split_whitespace().collect::<Vec<_>>();
                cols.get(2).and_then(|raw| parse_context_window(raw))
            })
            .collect();

        assert_eq!(
            windows,
            vec![1_000_000, 262_100, 1_000_000, 500_000, 131_100]
        );
        // None of them collapse onto the old id-guessed defaults.
        assert!(!windows.contains(&128_000));
        assert!(!windows.contains(&131_072));
    }

    #[test]
    fn the_thinking_column_is_still_read_from_the_same_row() {
        let line = "xai-auth               grok-4.5                500K     131.1K   yes       yes";
        let cols = line.split_whitespace().collect::<Vec<_>>();
        assert_eq!(parse_context_window(cols[2]), Some(500_000));
        assert!(cols.get(4).is_some_and(|v| *v == "yes"));
    }
}
