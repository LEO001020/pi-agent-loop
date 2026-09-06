//! Import conversation transcripts into a new App session journal.
//!
//! Supported formats:
//! - JSON array: `[{ "role": "user"|"assistant", "content": "..." }, ...]`
//! - Markdown-ish:
//!   ```text
//!   ## User
//!   hello
//!   ## Assistant
//!   hi
//!   ```
//!
//! Pi.com cloud web history is not exposed by Pi CLI CLI; file import is
//! the supported migration path.

use chrono::Utc;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::store::{self, ChatMessageStored, SessionMeta};

#[derive(Debug, Clone, Deserialize)]
struct JsonMsg {
    role: String,
    content: String,
}

/// Parse free-form transcript text into ordered (role, content) pairs.
pub fn parse_transcript(raw: &str) -> Result<Vec<(String, String)>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty transcript".into());
    }

    // JSON array?
    if trimmed.starts_with('[') {
        return parse_json_transcript(trimmed);
    }
    // JSON object with messages key
    if trimmed.starts_with('{') {
        if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
            if let Some(arr) = v
                .get("messages")
                .or_else(|| v.get("conversation"))
                .or_else(|| v.get("items"))
                .and_then(|x| x.as_array())
            {
                return parse_json_value_array(arr);
            }
        }
    }

    parse_markdown_transcript(trimmed)
}

fn parse_json_transcript(raw: &str) -> Result<Vec<(String, String)>, String> {
    // Try typed array first
    if let Ok(list) = serde_json::from_str::<Vec<JsonMsg>>(raw) {
        let out: Vec<_> = list
            .into_iter()
            .filter_map(|m| normalize_role_content(&m.role, &m.content))
            .collect();
        if out.is_empty() {
            return Err("JSON array had no user/assistant messages".into());
        }
        return Ok(out);
    }
    let v: Value = serde_json::from_str(raw).map_err(|e| format!("invalid JSON: {e}"))?;
    let arr = v
        .as_array()
        .ok_or_else(|| "JSON root must be an array of messages".to_string())?;
    parse_json_value_array(arr)
}

fn parse_json_value_array(arr: &[Value]) -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    for item in arr {
        let role = item
            .get("role")
            .or_else(|| item.get("author"))
            .and_then(|x| x.as_str())
            .unwrap_or("");
        let content = item
            .get("content")
            .or_else(|| item.get("text"))
            .or_else(|| item.get("message"))
            .and_then(|x| {
                if let Some(s) = x.as_str() {
                    Some(s.to_string())
                } else if x.is_array() {
                    // OpenAI-style content parts
                    let parts: Vec<String> = x
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter_map(|p| {
                            p.get("text")
                                .and_then(|t| t.as_str())
                                .map(|s| s.to_string())
                                .or_else(|| p.as_str().map(|s| s.to_string()))
                        })
                        .collect();
                    if parts.is_empty() {
                        None
                    } else {
                        Some(parts.join("\n"))
                    }
                } else {
                    None
                }
            })
            .unwrap_or_default();
        if let Some(pair) = normalize_role_content(role, &content) {
            out.push(pair);
        }
    }
    if out.is_empty() {
        return Err("No user/assistant messages found in JSON".into());
    }
    Ok(out)
}

fn normalize_role_content(role: &str, content: &str) -> Option<(String, String)> {
    let content = content.trim();
    if content.is_empty() {
        return None;
    }
    let r = role.trim().to_ascii_lowercase();
    let role = match r.as_str() {
        "user" | "human" | "me" | "prompt" => "user",
        "assistant" | "ai" | "bot" | "model" | "pi" | "agent" => "assistant",
        _ => return None,
    };
    Some((role.into(), content.to_string()))
}

fn parse_markdown_transcript(raw: &str) -> Result<Vec<(String, String)>, String> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut cur_role: Option<String> = None;
    let mut buf: Vec<String> = Vec::new();

    let flush = |role: &Option<String>, buf: &mut Vec<String>, out: &mut Vec<(String, String)>| {
        if let Some(r) = role {
            let text = buf.join("\n").trim().to_string();
            if !text.is_empty() {
                if let Some(pair) = normalize_role_content(r, &text) {
                    out.push(pair);
                }
            }
        }
        buf.clear();
    };

    for line in raw.lines() {
        let t = line.trim();
        let heading = t
            .strip_prefix("### ")
            .or_else(|| t.strip_prefix("## "))
            .or_else(|| t.strip_prefix("# "))
            .or_else(|| t.strip_prefix("**").and_then(|s| s.strip_suffix("**")))
            .map(|s| s.trim().to_string());

        if let Some(h) = heading {
            let hl = h.to_ascii_lowercase();
            if matches!(
                hl.as_str(),
                "user" | "human" | "me" | "assistant" | "ai" | "bot" | "model" | "pi" | "agent"
            ) || hl.starts_with("user")
                || hl.starts_with("assistant")
            {
                flush(&cur_role, &mut buf, &mut out);
                cur_role = Some(
                    if hl.contains("user") || hl.contains("human") || hl == "me" {
                        "user".into()
                    } else {
                        "assistant".into()
                    },
                );
                continue;
            }
        }

        // "User:" / "Assistant:" line prefixes
        if let Some(rest) = t
            .strip_prefix("User:")
            .or_else(|| t.strip_prefix("user:"))
            .or_else(|| t.strip_prefix("Human:"))
        {
            flush(&cur_role, &mut buf, &mut out);
            cur_role = Some("user".into());
            if !rest.trim().is_empty() {
                buf.push(rest.trim().to_string());
            }
            continue;
        }
        if let Some(rest) = t
            .strip_prefix("Assistant:")
            .or_else(|| t.strip_prefix("assistant:"))
            .or_else(|| t.strip_prefix("Pi:"))
            .or_else(|| t.strip_prefix("AI:"))
        {
            flush(&cur_role, &mut buf, &mut out);
            cur_role = Some("assistant".into());
            if !rest.trim().is_empty() {
                buf.push(rest.trim().to_string());
            }
            continue;
        }

        if cur_role.is_some() {
            buf.push(line.to_string());
        }
    }
    flush(&cur_role, &mut buf, &mut out);

    if out.is_empty() {
        return Err(
            "Could not parse transcript. Use JSON messages array or markdown ## User / ## Assistant sections."
                .into(),
        );
    }
    Ok(out)
}

/// Create a new App session and write imported messages to its journal.
pub fn import_transcript_as_session(
    raw: &str,
    title: Option<String>,
    project_id: Option<String>,
) -> Result<SessionMeta, String> {
    let pairs = parse_transcript(raw)?;
    let title = title
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            pairs.iter().find(|(r, _)| r == "user").map(|(_, c)| {
                let line = c.lines().next().unwrap_or(c).trim();
                let mut t: String = line.chars().take(40).collect();
                if line.chars().count() > 40 {
                    t.push('…');
                }
                t
            })
        })
        .unwrap_or_else(|| "Imported chat".into());

    let mut meta = store::create_session(project_id, Some(title), false)?;
    let now = Utc::now();
    let msgs: Vec<ChatMessageStored> = pairs
        .into_iter()
        .map(|(role, content)| ChatMessageStored {
            id: Uuid::new_v4().to_string(),
            role,
            content,
            thought: None,
            model_id: None,
            effort: None,
            created_at: now,
            is_error: false,
            attachments: None,
            marker: None,
        })
        .collect();
    store::save_messages(&meta.id, &msgs)?;
    meta.updated_at = now;
    let _ = store::update_session_meta(&meta);
    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_markdown_roles() {
        let raw = r#"
## User
hello world
## Assistant
hi there
## User
second
## Assistant
ok
"#;
        let pairs = parse_transcript(raw).unwrap();
        assert_eq!(pairs.len(), 4);
        assert_eq!(pairs[0].0, "user");
        assert_eq!(pairs[0].1, "hello world");
        assert_eq!(pairs[1].0, "assistant");
    }

    #[test]
    fn parses_json_array() {
        let raw = r#"[
          {"role":"user","content":"a"},
          {"role":"assistant","content":"b"}
        ]"#;
        let pairs = parse_transcript(raw).unwrap();
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs[1].1, "b");
    }

    #[test]
    fn parses_user_colon_style() {
        let raw = "User: ping\nAssistant: pong\n";
        let pairs = parse_transcript(raw).unwrap();
        assert_eq!(pairs.len(), 2);
    }
}
