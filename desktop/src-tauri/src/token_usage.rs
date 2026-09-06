//! Real token usage reported by Pi, including cache reads and writes.
//!
//! The shell has been estimating tokens as `chars / 4` while Pi hands it exact
//! figures on every `message_end` / `turn_end`:
//!
//! ```json
//! "usage": { "input": 1200, "output": 340, "cacheRead": 9800,
//!            "cacheWrite": 0, "totalTokens": 11340,
//!            "cost": { "total": 0.0031, … } }
//! ```
//!
//! Parsing it turns a guess into a measurement — and makes the cache hit rate
//! observable, which is the number that decides whether a long session is
//! cheap or ruinous.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    /// Fresh prompt tokens the provider charged full price for.
    pub input: u64,
    pub output: u64,
    /// Prompt tokens served from cache — the ones that were nearly free.
    pub cache_read: u64,
    /// Tokens written into the cache for later turns to reuse.
    pub cache_write: u64,
    pub total_tokens: u64,
    /// Provider cost in their billing currency; `None` when not reported.
    pub cost_total: Option<f64>,
}

impl TokenUsage {
    /// Share of prompt tokens served from cache, `0.0..=1.0`.
    ///
    /// Measured against `input + cache_read`, which is what the prompt cost:
    /// output tokens are generated fresh every time and can never be cached,
    /// so including them would understate a session that answers at length.
    /// Returns `None` when no prompt tokens were counted, rather than a
    /// misleading zero.
    pub fn cache_hit_rate(&self) -> Option<f64> {
        let prompt = self.input + self.cache_read;
        if prompt == 0 {
            return None;
        }
        Some(self.cache_read as f64 / prompt as f64)
    }

    /// Fold another turn's usage in, for a session total.
    pub fn add(&mut self, other: &TokenUsage) {
        self.input += other.input;
        self.output += other.output;
        self.cache_read += other.cache_read;
        self.cache_write += other.cache_write;
        self.total_tokens += other.total_tokens;
        self.cost_total = match (self.cost_total, other.cost_total) {
            (Some(a), Some(b)) => Some(a + b),
            (Some(a), None) => Some(a),
            (None, b) => b,
        };
    }
}

/// Read the `usage` object out of a Pi message payload.
///
/// Returns `None` when the message carries none — a user turn, or a request
/// that failed before the provider billed anything. Absent is deliberately
/// distinct from all-zero: the first means "not measured", the second means
/// "measured, and it cost nothing".
pub fn parse_usage(message: &Value) -> Option<TokenUsage> {
    let u = message.get("usage")?;
    if !u.is_object() {
        return None;
    }
    let num = |key: &str| u.get(key).and_then(Value::as_u64).unwrap_or(0);
    Some(TokenUsage {
        input: num("input"),
        output: num("output"),
        cache_read: num("cacheRead"),
        cache_write: num("cacheWrite"),
        total_tokens: num("totalTokens"),
        cost_total: u
            .pointer("/cost/total")
            .and_then(Value::as_f64)
            .filter(|c| c.is_finite()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Shape captured from a live `pi --mode rpc` turn.
    fn live_shape(input: u64, cache_read: u64) -> Value {
        json!({
            "role": "assistant",
            "usage": {
                "input": input, "output": 42,
                "cacheRead": cache_read, "cacheWrite": 7,
                "totalTokens": input + cache_read + 42,
                "cost": { "input": 0.1, "output": 0.2, "cacheRead": 0.01,
                          "cacheWrite": 0.0, "total": 0.31 }
            }
        })
    }

    #[test]
    fn reads_the_shape_pi_actually_sends() {
        let u = parse_usage(&live_shape(1200, 9800)).expect("usage");
        assert_eq!(u.input, 1200);
        assert_eq!(u.output, 42);
        assert_eq!(u.cache_read, 9800);
        assert_eq!(u.cache_write, 7);
        assert_eq!(u.cost_total, Some(0.31));
    }

    #[test]
    fn a_message_without_usage_is_not_measured() {
        assert!(parse_usage(&json!({ "role": "user", "content": "hi" })).is_none());
        assert!(parse_usage(&json!({ "usage": "nonsense" })).is_none());
        assert!(parse_usage(&json!({})).is_none());
    }

    /// A failed request reports zeros; that is a measurement, not an absence.
    #[test]
    fn all_zero_usage_still_parses() {
        let u = parse_usage(&json!({
            "usage": { "input": 0, "output": 0, "cacheRead": 0,
                       "cacheWrite": 0, "totalTokens": 0,
                       "cost": { "total": 0 } }
        }))
        .expect("zeros are still usage");
        assert_eq!(u.total_tokens, 0);
        assert_eq!(u.cache_hit_rate(), None);
    }

    #[test]
    fn missing_fields_default_to_zero_rather_than_failing() {
        let u = parse_usage(&json!({ "usage": { "input": 5 } })).expect("usage");
        assert_eq!(u.input, 5);
        assert_eq!(u.cache_read, 0);
        assert_eq!(u.cost_total, None);
    }

    #[test]
    fn cache_rate_measures_the_prompt_only() {
        let u = TokenUsage {
            input: 200,
            output: 100_000, // A long answer must not dilute the rate.
            cache_read: 800,
            ..Default::default()
        };
        assert_eq!(u.cache_hit_rate(), Some(0.8));
    }

    #[test]
    fn cache_rate_covers_both_extremes() {
        let cold = TokenUsage {
            input: 1000,
            ..Default::default()
        };
        assert_eq!(cold.cache_hit_rate(), Some(0.0));

        let warm = TokenUsage {
            cache_read: 1000,
            ..Default::default()
        };
        assert_eq!(warm.cache_hit_rate(), Some(1.0));
    }

    #[test]
    fn totals_accumulate_across_turns() {
        let mut total = TokenUsage::default();
        total.add(&parse_usage(&live_shape(100, 900)).unwrap());
        total.add(&parse_usage(&live_shape(300, 700)).unwrap());

        assert_eq!(total.input, 400);
        assert_eq!(total.cache_read, 1600);
        assert_eq!(total.cache_hit_rate(), Some(0.8));
        assert_eq!(total.cost_total, Some(0.62));
    }

    /// One turn without a cost must not erase the cost already accumulated.
    #[test]
    fn a_turn_with_no_cost_leaves_the_running_total_alone() {
        let mut total = TokenUsage {
            cost_total: Some(1.5),
            ..Default::default()
        };
        total.add(&TokenUsage {
            cost_total: None,
            input: 10,
            ..Default::default()
        });
        assert_eq!(total.cost_total, Some(1.5));
        assert_eq!(total.input, 10);
    }
}
