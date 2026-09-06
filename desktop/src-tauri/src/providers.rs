//! Custom OpenAI-compatible providers → agent-readable config.toml under PI_AGENT_HOME.
//! Intentionally original implementation (not ported from other desktops).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::paths::{ensure_app_dirs, resolve_agent_pi_home};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProvider {
    pub id: String,
    pub model: String,
    pub base_url: String,
    pub name: String,
    pub has_api_key: bool,
    pub api_backend: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertProviderInput {
    pub id: String,
    pub model: String,
    pub base_url: String,
    pub name: Option<String>,
    /// Empty / omitted = keep existing key on edit.
    pub api_key: Option<String>,
    pub api_backend: Option<String>,
    pub set_as_default: Option<bool>,
    pub create_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvidersListResult {
    pub providers: Vec<CustomProvider>,
    pub default_model: Option<String>,
    /// `official` = built-in Pi official account path; `custom` = a config.toml model with base_url.
    pub active_source: String,
    /// When `active_source == "custom"`, the selected provider id.
    pub active_provider_id: Option<String>,
    pub config_path: String,
    pub agent_home: String,
}

/// Built-in model id used when routing back to official Pi.
pub const OFFICIAL_DEFAULT_MODEL: &str = "pi-4.5";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPingResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub endpoint: String,
    pub status: Option<u16>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModelsResult {
    pub endpoint: String,
    pub models: Vec<RemoteModel>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModel {
    pub id: String,
    pub owned_by: Option<String>,
}

struct Section {
    id: String,
    start: usize,
    end: usize,
    fields: std::collections::HashMap<String, String>,
}

fn active_agent_home() -> PathBuf {
    let settings = crate::store::load_settings();
    resolve_agent_pi_home(&settings.session_data_mode)
}

fn active_config_toml() -> PathBuf {
    active_agent_home().join("config.toml")
}

fn unquote(v: &str) -> String {
    let t = v.trim();
    if (t.starts_with('"') && t.ends_with('"')) || (t.starts_with('\'') && t.ends_with('\'')) {
        t[1..t.len().saturating_sub(1)].to_string()
    } else {
        t.to_string()
    }
}

fn quote(v: &str) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| format!("\"{v}\""))
}

fn sanitize_id(raw: &str) -> Result<String, String> {
    let id = raw
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if id.is_empty() || !id.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) {
        return Err("provider id must start with a letter or digit".into());
    }
    Ok(id)
}

fn normalize_backend(v: Option<&str>) -> String {
    match v.unwrap_or("").trim() {
        "responses" => "responses".into(),
        "messages" => "messages".into(),
        _ => "chat_completions".into(),
    }
}

/// Pi joins `{base_url}/chat/completions` (or `/responses`).
/// OpenAI-compatible relays almost always expect `…/v1` as the base.
/// Without it, requests can hit `https://host/chat/completions` instead.
pub fn normalize_openai_base_url(raw: &str, api_backend: &str) -> String {
    let mut base = raw.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return base;
    }
    // Anthropic-style messages often use bare host or /v1 already; still prefer /v1.
    let lower = base.to_ascii_lowercase();
    let needs_v1 = matches!(
        api_backend,
        "chat_completions" | "responses" | "messages" | ""
    );
    if needs_v1
        && !lower.ends_with("/v1")
        && !lower.contains("/v1/")
        && !lower.ends_with("/chat/completions")
        && !lower.ends_with("/responses")
        && !lower.ends_with("/messages")
    {
        base.push_str("/v1");
    }
    base
}

/// One-shot repair: rewrite stored custom base_url values that omit /v1.
pub fn repair_custom_base_urls() -> Result<bool, String> {
    let path = active_config_toml();
    if !path.is_file() {
        return Ok(false);
    }
    let text = read_text(&path);
    let sections = parse_model_sections(&text);
    let mut changed = false;
    let mut out = text.clone();
    for s in sections {
        if !is_custom(&s.fields) {
            continue;
        }
        let backend = normalize_backend(s.fields.get("api_backend").map(|x| x.as_str()));
        let Some(old) = s.fields.get("base_url").cloned() else {
            continue;
        };
        let new = normalize_openai_base_url(&old, &backend);
        if new != old.trim().trim_end_matches('/') && new != old {
            // Re-write whole section via remove + append to keep format stable.
            let model = s
                .fields
                .get("model")
                .cloned()
                .unwrap_or_else(|| s.id.clone());
            let name = s
                .fields
                .get("name")
                .cloned()
                .unwrap_or_else(|| s.id.clone());
            let key = s.fields.get("api_key").cloned().unwrap_or_default();
            out = remove_section(&out, &s.id);
            out = append_section(
                &out,
                &s.id,
                &[
                    ("model".into(), model),
                    ("base_url".into(), new),
                    ("name".into(), name),
                    ("api_key".into(), key),
                    ("api_backend".into(), backend),
                ],
            );
            changed = true;
            tracing::info!(
                target: "providers",
                id = %s.id,
                "repaired base_url to include /v1"
            );
        }
    }
    if changed {
        // Preserve [models].default
        let def = get_models_default(&text);
        if let Some(d) = def {
            out = set_models_default(&out, &d);
        }
        write_text(&path, &out)?;
    }
    Ok(changed)
}

fn model_header(id: &str) -> String {
    if id
        .chars()
        .any(|c| !(c.is_ascii_alphanumeric() || c == '_' || c == '-'))
    {
        format!("[model.{}]", quote(id))
    } else {
        format!("[model.{id}]")
    }
}

fn parse_model_header_id(trimmed: &str) -> Option<String> {
    let rest = trimmed.strip_prefix("[model.")?.strip_suffix(']')?;
    Some(unquote(rest).trim().to_string()).filter(|s| !s.is_empty())
}

fn read_text(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

fn write_text(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, text).map_err(|e| e.to_string())
}

fn parse_model_sections(text: &str) -> Vec<Section> {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut sections = Vec::new();
    let mut cur: Option<Section> = None;
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if let Some(hid) = parse_model_header_id(trimmed) {
            if let Some(mut c) = cur.take() {
                c.end = i;
                sections.push(c);
            }
            cur = Some(Section {
                id: hid,
                start: i,
                end: lines.len(),
                fields: std::collections::HashMap::new(),
            });
            continue;
        }
        if trimmed.starts_with('[') {
            if let Some(mut c) = cur.take() {
                c.end = i;
                sections.push(c);
            }
            continue;
        }
        if let Some(ref mut c) = cur {
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some(eq) = trimmed.find('=') {
                let key = trimmed[..eq].trim().to_string();
                let val = unquote(trimmed[eq + 1..].trim());
                c.fields.insert(key, val);
            }
        }
    }
    if let Some(c) = cur {
        sections.push(c);
    }
    sections
}

fn get_models_default(text: &str) -> Option<String> {
    let mut in_models = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_models = trimmed == "[models]";
            continue;
        }
        if !in_models || trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("default") {
            let rest = rest.trim().strip_prefix('=')?.trim();
            return Some(unquote(rest));
        }
    }
    None
}

fn set_models_default(text: &str, model_id: &str) -> String {
    let mut lines: Vec<String> = text.lines().map(|s| s.to_string()).collect();
    let mut in_models = false;
    let mut models_start: Option<usize> = None;
    for i in 0..lines.len() {
        let trimmed = lines[i].trim().to_string();
        if trimmed.starts_with('[') {
            if trimmed == "[models]" {
                in_models = true;
                models_start = Some(i);
            } else if in_models {
                lines.insert(i, format!("default = {}", quote(model_id)));
                return lines.join("\n");
            } else {
                in_models = false;
            }
            continue;
        }
        if in_models && trimmed.starts_with("default") && trimmed.contains('=') {
            lines[i] = format!("default = {}", quote(model_id));
            return lines.join("\n");
        }
    }
    if let Some(start) = models_start {
        lines.insert(start + 1, format!("default = {}", quote(model_id)));
        return lines.join("\n");
    }
    let block = format!("\n[models]\ndefault = {}\n", quote(model_id));
    let base = text.trim_end();
    if base.is_empty() {
        block.trim_start().to_string()
    } else {
        format!("{base}{block}")
    }
}

fn remove_section(text: &str, id: &str) -> String {
    let sections = parse_model_sections(text);
    let Some(hit) = sections.iter().find(|s| s.id == id) else {
        return text.to_string();
    };
    let mut lines: Vec<String> = text.lines().map(|s| s.to_string()).collect();
    lines.drain(hit.start..hit.end);
    let joined = lines.join("\n");
    // collapse excess blank lines
    let mut out = String::new();
    let mut blanks = 0;
    for line in joined.lines() {
        if line.trim().is_empty() {
            blanks += 1;
            if blanks <= 2 {
                out.push('\n');
            }
        } else {
            blanks = 0;
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

fn append_section(text: &str, id: &str, fields: &[(String, String)]) -> String {
    let body: String = fields
        .iter()
        .filter(|(_, v)| !v.is_empty())
        .map(|(k, v)| format!("{k} = {}", quote(v)))
        .collect::<Vec<_>>()
        .join("\n");
    let block = format!("\n{}\n{body}\n", model_header(id));
    let base = text.trim_end();
    if base.is_empty() {
        block.trim_start().to_string()
    } else {
        format!("{base}\n{block}")
    }
}

fn is_custom(fields: &std::collections::HashMap<String, String>) -> bool {
    fields
        .get("base_url")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}

fn ensure_agent_home() -> Result<PathBuf, String> {
    ensure_app_dirs().map_err(|e| e.to_string())?;
    let home = active_agent_home();
    fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    Ok(home)
}

fn route_from_default(def: Option<&str>, providers: &[CustomProvider]) -> (String, Option<String>) {
    if let Some(d) = def {
        if providers.iter().any(|p| p.id == d) {
            return ("custom".into(), Some(d.to_string()));
        }
    }
    ("official".into(), None)
}

fn build_list_result(home: PathBuf, path: PathBuf, text: &str) -> ProvidersListResult {
    let def = get_models_default(text);
    let mut providers = Vec::new();
    for s in parse_model_sections(text) {
        if !is_custom(&s.fields) {
            continue;
        }
        let model = s
            .fields
            .get("model")
            .cloned()
            .unwrap_or_else(|| s.id.clone());
        let base_url = s.fields.get("base_url").cloned().unwrap_or_default();
        let name = s
            .fields
            .get("name")
            .cloned()
            .unwrap_or_else(|| s.id.clone());
        let has_api_key = s
            .fields
            .get("api_key")
            .map(|k| !k.trim().is_empty())
            .unwrap_or(false);
        let api_backend = normalize_backend(s.fields.get("api_backend").map(|s| s.as_str()));
        let is_default = def.as_deref() == Some(s.id.as_str());
        providers.push(CustomProvider {
            id: s.id,
            model,
            base_url,
            name,
            has_api_key,
            api_backend,
            is_default,
        });
    }
    let (active_source, active_provider_id) = route_from_default(def.as_deref(), &providers);
    ProvidersListResult {
        providers,
        default_model: def,
        active_source,
        active_provider_id,
        config_path: path.display().to_string(),
        agent_home: home.display().to_string(),
    }
}

pub fn list_custom_providers() -> Result<ProvidersListResult, String> {
    let home = ensure_agent_home()?;
    let path = active_config_toml();
    let text = read_text(&path);
    Ok(build_list_result(home, path, &text))
}

/// Switch active route: `official` or `custom` (+ provider_id).
pub fn activate_provider(
    source: &str,
    provider_id: Option<&str>,
) -> Result<ProvidersListResult, String> {
    let source = source.trim().to_ascii_lowercase();
    match source.as_str() {
        "official" => set_default_model_id(OFFICIAL_DEFAULT_MODEL),
        "custom" => {
            let id = provider_id
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "providerId is required for custom source".to_string())?;
            let list = list_custom_providers()?;
            if !list.providers.iter().any(|p| p.id == id) {
                return Err(format!("unknown provider `{id}`"));
            }
            set_default_model_id(id)
        }
        _ => Err(format!("unknown source `{source}` (use official|custom)")),
    }
}

pub fn upsert_custom_provider(input: UpsertProviderInput) -> Result<ProvidersListResult, String> {
    let id = sanitize_id(&input.id)?;
    let model = {
        let m = input.model.trim();
        if m.is_empty() {
            id.clone()
        } else {
            m.to_string()
        }
    };
    let api_backend = normalize_backend(input.api_backend.as_deref());
    let base_url = normalize_openai_base_url(input.base_url.trim(), &api_backend);
    if base_url.is_empty() {
        return Err("base_url is required".into());
    }
    if !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
        return Err("base_url must start with http:// or https://".into());
    }

    let _ = ensure_agent_home()?;
    let path = active_config_toml();
    let mut text = read_text(&path);
    let sections = parse_model_sections(&text);
    let existing = sections.iter().find(|s| s.id == id);
    if input.create_only.unwrap_or(false) && existing.is_some() {
        return Err(format!("provider id `{id}` already exists"));
    }
    let prev_key = existing
        .and_then(|s| s.fields.get("api_key"))
        .cloned()
        .unwrap_or_default();
    let next_key = match input.api_key.as_deref() {
        None | Some("") => prev_key,
        Some(k) => k.trim().to_string(),
    };
    if next_key.is_empty() {
        return Err("api_key is required for custom providers".into());
    }

    let name = input
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(id.as_str())
        .to_string();

    text = remove_section(&text, &id);
    text = append_section(
        &text,
        &id,
        &[
            ("model".into(), model),
            ("base_url".into(), base_url),
            ("name".into(), name),
            ("api_key".into(), next_key),
            ("api_backend".into(), api_backend),
        ],
    );

    if input.set_as_default.unwrap_or(false) {
        text = set_models_default(&text, &id);
    }

    write_text(&path, &text)?;
    list_custom_providers()
}

pub fn remove_custom_provider(id: &str) -> Result<ProvidersListResult, String> {
    let id = sanitize_id(id)?;
    let path = active_config_toml();
    let mut text = read_text(&path);
    let def = get_models_default(&text);
    text = remove_section(&text, &id);
    if def.as_deref() == Some(id.as_str()) {
        text = set_models_default(&text, OFFICIAL_DEFAULT_MODEL);
    }
    write_text(&path, &text)?;
    list_custom_providers()
}

pub fn set_default_model_id(model_id: &str) -> Result<ProvidersListResult, String> {
    let id = model_id.trim();
    if id.is_empty() {
        return Err("modelId is required".into());
    }
    let path = active_config_toml();
    let mut text = read_text(&path);
    text = set_models_default(&text, id);
    write_text(&path, &text)?;
    list_custom_providers()
}

fn resolve_stored_key(provider_id: Option<&str>) -> String {
    let Some(pid) = provider_id.map(str::trim).filter(|s| !s.is_empty()) else {
        return String::new();
    };
    let Ok(sid) = sanitize_id(pid) else {
        return String::new();
    };
    let text = read_text(&active_config_toml());
    parse_model_sections(&text)
        .into_iter()
        .find(|s| s.id == sid)
        .and_then(|s| s.fields.get("api_key").cloned())
        .unwrap_or_default()
}

fn resolve_stored_base(provider_id: Option<&str>) -> String {
    let Some(pid) = provider_id.map(str::trim).filter(|s| !s.is_empty()) else {
        return String::new();
    };
    let Ok(sid) = sanitize_id(pid) else {
        return String::new();
    };
    let text = read_text(&active_config_toml());
    parse_model_sections(&text)
        .into_iter()
        .find(|s| s.id == sid)
        .and_then(|s| s.fields.get("base_url").cloned())
        .unwrap_or_default()
}

pub fn models_list_endpoint(base_url: &str) -> Result<String, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("base_url is required".into());
    }
    if base.to_ascii_lowercase().ends_with("/models") {
        return Ok(base.to_string());
    }
    Ok(format!("{base}/models"))
}

pub async fn ping_provider(
    base_url: Option<String>,
    api_key: Option<String>,
    provider_id: Option<String>,
) -> Result<ProviderPingResult, String> {
    let mut base = base_url.unwrap_or_default().trim().to_string();
    if base.is_empty() {
        base = resolve_stored_base(provider_id.as_deref());
    }
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err("base_url must start with http:// or https://".into());
    }
    let mut key = api_key.unwrap_or_default().trim().to_string();
    if key.is_empty() {
        key = resolve_stored_key(provider_id.as_deref());
    }
    let endpoint = models_list_endpoint(&base)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;
    let t0 = Instant::now();
    let mut req = client.get(&endpoint).header("Accept", "application/json");
    if !key.is_empty() {
        req = req.header("Authorization", format!("Bearer {key}"));
    }
    match req.send().await {
        Ok(res) => {
            let status = res.status().as_u16();
            let _ = res.bytes().await;
            Ok(ProviderPingResult {
                ok: true,
                latency_ms: t0.elapsed().as_millis() as u64,
                endpoint,
                status: Some(status),
                error: None,
            })
        }
        Err(e) => Ok(ProviderPingResult {
            ok: false,
            latency_ms: t0.elapsed().as_millis() as u64,
            endpoint,
            status: None,
            error: Some(e.to_string()),
        }),
    }
}

pub async fn list_remote_models(
    base_url: String,
    api_key: Option<String>,
    provider_id: Option<String>,
) -> Result<RemoteModelsResult, String> {
    let base = base_url.trim().to_string();
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err("base_url must start with http:// or https://".into());
    }
    let mut key = api_key.unwrap_or_default().trim().to_string();
    if key.is_empty() {
        key = resolve_stored_key(provider_id.as_deref());
    }
    if key.is_empty() {
        return Err("api_key is required to list models".into());
    }
    let endpoint = models_list_endpoint(&base)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(&endpoint)
        .header("Authorization", format!("Bearer {key}"))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "models HTTP {}: {}",
            status.as_u16(),
            text.chars().take(240).collect::<String>()
        ));
    }
    let data: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| "models response is not JSON".to_string())?;
    let arr = if let Some(a) = data.as_array() {
        a.clone()
    } else if let Some(a) = data.get("data").and_then(|d| d.as_array()) {
        a.clone()
    } else {
        Vec::new()
    };
    let mut models = Vec::new();
    for item in arr {
        let id = item
            .get("id")
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let Some(id) = id else { continue };
        models.push(RemoteModel {
            id: id.to_string(),
            owned_by: item
                .get("owned_by")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string()),
        });
    }
    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(RemoteModelsResult { endpoint, models })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_and_endpoint() {
        assert_eq!(sanitize_id("My Relay").unwrap(), "my-relay");
        assert!(models_list_endpoint("https://x.example/v1")
            .unwrap()
            .ends_with("/v1/models"));
    }

    #[test]
    fn normalizes_missing_v1() {
        assert_eq!(
            normalize_openai_base_url("https://api.example.com", "chat_completions"),
            "https://api.example.com/v1"
        );
        assert_eq!(
            normalize_openai_base_url("https://api.example.com/v1", "chat_completions"),
            "https://api.example.com/v1"
        );
        assert_eq!(
            normalize_openai_base_url("https://api.example.com/v1/", "chat_completions"),
            "https://api.example.com/v1"
        );
    }

    #[test]
    fn roundtrip_section_text() {
        let text = "";
        let text = append_section(
            text,
            "demo",
            &[
                ("model".into(), "m1".into()),
                ("base_url".into(), "https://ex/v1".into()),
                ("name".into(), "Demo".into()),
                ("api_key".into(), "sk-test".into()),
                ("api_backend".into(), "chat_completions".into()),
            ],
        );
        let text = set_models_default(&text, "demo");
        let sections = parse_model_sections(&text);
        assert_eq!(sections.len(), 1);
        assert_eq!(get_models_default(&text).as_deref(), Some("demo"));
        assert!(is_custom(&sections[0].fields));
    }
}
