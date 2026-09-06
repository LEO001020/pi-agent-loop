//! Local, opt-in MCP control plane for Pi Desktop.
//!
//! The desktop process owns the session manager, so an external MCP client
//! cannot control it by opening a second Tauri instance. Instead, the desktop
//! exposes a short-lived, loopback-only JSONL endpoint. `pi-app mcp serve` is
//! the standard MCP stdio adapter that authenticates to that endpoint.
//!
//! Security boundaries are intentionally narrow:
//! - the listener binds only to 127.0.0.1;
//! - every request carries a random bearer token stored in a 0600 endpoint file;
//! - projects must already be trusted in Pi Desktop;
//! - task starts force the session permission policy to `ask`;
//! - request ids are fingerprinted and persisted for idempotent retries;
//! - the audit trail contains ids and outcomes, never prompts or credentials.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::net::SocketAddr;
use std::path::Path;
use std::time::{Duration, Instant};

use chrono::Utc;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use uuid::Uuid;

use crate::session_fsm::SessionState;
use crate::session_manager::{SessionManager, SessionSnapshot};
use crate::store::{self, ChatMessageStored, Project, SessionMeta};

const MCP_PROTOCOL_VERSION: &str = "2024-11-05";
const ENDPOINT_VERSION: u32 = 1;
const MAX_FRAME_BYTES: usize = 256 * 1024;
const MAX_PROMPT_CHARS: usize = 32_000;
const MAX_READ_MESSAGES: usize = 200;
const MAX_READ_MESSAGE_CHARS: usize = 24_000;
const MAX_WAIT_MS: u64 = 60_000;
const REQUEST_JOURNAL_LIMIT: usize = 512;
const MCP_RATE_LIMIT_REQUESTS: usize = 120;
const MCP_RATE_LIMIT_WINDOW: Duration = Duration::from_secs(60);
const MCP_RECONNECT_DELAYS: [Duration; 3] = [
    Duration::from_millis(100),
    Duration::from_millis(250),
    Duration::from_millis(500),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EndpointFile {
    version: u32,
    address: String,
    token: String,
    pid: u32,
    started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestRecord {
    request_id: String,
    fingerprint: String,
    session_id: String,
    created_at: String,
    #[serde(default = "default_request_status")]
    status: String,
}

fn default_request_status() -> String {
    "accepted".into()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct RequestJournal {
    records: Vec<RequestRecord>,
}

struct Runtime {
    token: String,
    requests: tokio::sync::Mutex<RequestJournal>,
    rate_limit: tokio::sync::Mutex<RateLimitState>,
}

#[derive(Debug)]
struct RateLimitState {
    window_started: Instant,
    requests: usize,
}

impl Default for RateLimitState {
    fn default() -> Self {
        Self {
            window_started: Instant::now(),
            requests: 0,
        }
    }
}

impl RateLimitState {
    fn allow(&mut self, now: Instant) -> bool {
        if now.duration_since(self.window_started) >= MCP_RATE_LIMIT_WINDOW {
            self.window_started = now;
            self.requests = 0;
        }
        if self.requests >= MCP_RATE_LIMIT_REQUESTS {
            return false;
        }
        self.requests += 1;
        true
    }
}

#[derive(Debug, Deserialize)]
struct LocalRequest {
    id: Value,
    token: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Deserialize, Serialize)]
struct LocalResponse {
    jsonrpc: String,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<LocalError>,
}

#[derive(Debug, Deserialize, Serialize)]
struct LocalError {
    code: i64,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListSessionsArgs {
    project_id: Option<String>,
    limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadSessionArgs {
    session_id: String,
    include_thoughts: Option<bool>,
    limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartTaskArgs {
    project_id: String,
    prompt: String,
    model: Option<String>,
    request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WaitTaskArgs {
    session_id: String,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelTaskArgs {
    session_id: String,
}

#[derive(Debug, Deserialize)]
struct StdioRequest {
    jsonrpc: Option<String>,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

pub const SERVER_NAME: &str = "pi-app";

/// Start the authenticated loopback endpoint owned by the desktop process.
pub fn start_loopback(app: AppHandle, mgr: std::sync::Arc<SessionManager>) {
    let endpoint_path = crate::paths::mcp_endpoint_file();
    if !mcp_enabled() {
        // Do not leave a previous launch's token usable when the feature is off.
        let _ = fs::remove_file(endpoint_path);
        let _ = fs::remove_file(crate::paths::mcp_revocation_file());
        tracing::debug!("MCP bridge disabled; set PI_APP_ENABLE_MCP=1 to enable");
        return;
    }
    tauri::async_runtime::spawn(async move {
        if let Err(error) = serve_loopback(app, mgr).await {
            tracing::warn!("MCP loopback server stopped: {error}");
        }
    });
}

fn mcp_enabled() -> bool {
    std::env::var("PI_APP_ENABLE_MCP")
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .unwrap_or(false)
}

/// Entry point for `pi-app mcp serve`.
pub fn run_stdio() -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("MCP runtime: {error}"))?;
    runtime.block_on(run_stdio_async())
}

/// Revoke the currently published loopback credential without stopping the
/// desktop process. The server checks this marker at request ingress.
pub fn revoke_runtime_token() -> Result<(), String> {
    let endpoint = load_endpoint()?;
    write_private_json(
        &crate::paths::mcp_revocation_file(),
        &json!({
            "tokenHash": token_hash(&endpoint.token),
            "revokedAt": Utc::now().to_rfc3339(),
        }),
    )
}

/// Clear a local revocation marker. A future desktop launch still rotates the
/// endpoint token, so this only restores the current running endpoint.
pub fn clear_runtime_token_revocation() -> Result<(), String> {
    match fs::remove_file(crate::paths::mcp_revocation_file()) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("MCP revocation clear: {error}")),
    }
}

async fn serve_loopback(app: AppHandle, mgr: std::sync::Arc<SessionManager>) -> Result<(), String> {
    let _ = crate::paths::ensure_app_dirs();
    let endpoint_path = crate::paths::mcp_endpoint_file();
    // A stale endpoint must never be trusted after a desktop restart.
    let _ = fs::remove_file(&endpoint_path);
    let _ = fs::remove_file(crate::paths::mcp_revocation_file());

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("MCP loopback bind: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("MCP loopback address: {error}"))?
        .to_string();
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let endpoint = EndpointFile {
        version: ENDPOINT_VERSION,
        address,
        token: token.clone(),
        pid: std::process::id(),
        started_at: Utc::now().to_rfc3339(),
    };
    write_private_json(&endpoint_path, &endpoint)?;

    let runtime = std::sync::Arc::new(Runtime {
        token,
        requests: tokio::sync::Mutex::new(load_request_journal()),
        rate_limit: tokio::sync::Mutex::new(RateLimitState::default()),
    });

    loop {
        let (stream, peer) = listener
            .accept()
            .await
            .map_err(|error| format!("MCP loopback accept: {error}"))?;
        if !peer.ip().is_loopback() {
            tracing::warn!("MCP rejected non-loopback peer {}", peer.ip());
            continue;
        }
        let app = app.clone();
        let mgr = std::sync::Arc::clone(&mgr);
        let runtime = std::sync::Arc::clone(&runtime);
        tauri::async_runtime::spawn(async move {
            if let Err(error) = serve_connection(stream, app, mgr, runtime).await {
                tracing::debug!("MCP connection closed: {error}");
            }
        });
    }
}

async fn serve_connection(
    stream: TcpStream,
    app: AppHandle,
    mgr: std::sync::Arc<SessionManager>,
    runtime: std::sync::Arc<Runtime>,
) -> Result<(), String> {
    let (read_half, mut write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);
    let mut line = String::new();

    loop {
        line.clear();
        let read = reader
            .read_line(&mut line)
            .await
            .map_err(|error| format!("MCP read: {error}"))?;
        if read == 0 {
            return Ok(());
        }
        if read > MAX_FRAME_BYTES {
            write_local_response(
                &mut write_half,
                LocalResponse::error(Value::Null, -32600, "request too large"),
            )
            .await?;
            return Err("request too large".into());
        }

        if !runtime.rate_limit.lock().await.allow(Instant::now()) {
            write_local_response(
                &mut write_half,
                LocalResponse::error(Value::Null, -32029, "rate limit exceeded"),
            )
            .await?;
            return Err("MCP rate limit exceeded".into());
        }

        let request: LocalRequest = match serde_json::from_str(line.trim()) {
            Ok(request) => request,
            Err(error) => {
                write_local_response(
                    &mut write_half,
                    LocalResponse::error(Value::Null, -32700, format!("invalid JSON: {error}")),
                )
                .await?;
                continue;
            }
        };

        if !constant_time_eq(&runtime.token, &request.token) {
            write_local_response(
                &mut write_half,
                LocalResponse::error(Value::Null, -32001, "unauthorized"),
            )
            .await?;
            return Err("unauthorized MCP request".into());
        }
        if token_is_revoked(&runtime.token) {
            write_local_response(
                &mut write_half,
                LocalResponse::error(Value::Null, -32003, "MCP token revoked"),
            )
            .await?;
            return Err("MCP token revoked".into());
        }

        let response = match dispatch(&request.method, request.params, &app, &mgr, &runtime).await {
            Ok(result) => LocalResponse::ok(request.id, result),
            Err(error) => LocalResponse::error(request.id, -32000, error),
        };
        write_local_response(&mut write_half, response).await?;
    }
}

async fn write_local_response(
    writer: &mut tokio::net::tcp::OwnedWriteHalf,
    response: LocalResponse,
) -> Result<(), String> {
    let body = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    writer
        .write_all(body.as_bytes())
        .await
        .map_err(|error| format!("MCP write: {error}"))?;
    writer
        .write_all(b"\n")
        .await
        .map_err(|error| format!("MCP write newline: {error}"))?;
    writer
        .flush()
        .await
        .map_err(|error| format!("MCP flush: {error}"))
}

impl LocalResponse {
    fn ok(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: Some(result),
            error: None,
        }
    }

    fn error(id: Value, code: i64, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: None,
            error: Some(LocalError {
                code,
                message: message.into(),
                data: None,
            }),
        }
    }
}

async fn dispatch(
    method: &str,
    params: Value,
    app: &AppHandle,
    mgr: &std::sync::Arc<SessionManager>,
    runtime: &std::sync::Arc<Runtime>,
) -> Result<Value, String> {
    match method {
        "pi_overview" => Ok(overview(mgr)),
        "pi_list_allowed_projects" => Ok(list_allowed_projects()),
        "pi_list_sessions" => list_sessions(params, mgr),
        "pi_read_session" => read_session(params),
        "pi_start_task" => start_task(params, app, mgr, runtime).await,
        "pi_wait_for_task" => wait_for_task(params, mgr).await,
        "pi_cancel_task" => cancel_task(params, app, mgr).await,
        _ => Err(format!("unknown tool: {method}")),
    }
}

fn overview(mgr: &SessionManager) -> Value {
    json!({
        "server": SERVER_NAME,
        "protocolVersion": MCP_PROTOCOL_VERSION,
        "appVersion": env!("CARGO_PKG_VERSION"),
        "loopbackOnly": true,
        "approvalRequiredByDefault": true,
        "capabilities": tool_definitions()
            .as_array()
            .map(|tools| tools.iter().filter_map(|tool| tool.get("name")).cloned().collect::<Vec<_>>())
            .unwrap_or_default(),
        "projectCount": store::load_projects().len(),
        "sessionCount": store::load_sessions_index().len(),
        "runningTaskCount": mgr.running_sessions().len(),
    })
}

fn list_allowed_projects() -> Value {
    let projects = store::load_projects()
        .into_iter()
        .filter(project_is_allowed)
        .map(|project| {
            json!({
                "id": project.id,
                "name": project.name,
                "path": project.path,
                "trusted": project.trusted,
            })
        })
        .collect::<Vec<_>>();
    Value::Array(projects)
}

fn list_sessions(params: Value, mgr: &SessionManager) -> Result<Value, String> {
    let args: ListSessionsArgs = parse_params(params)?;
    let limit = args.limit.unwrap_or(50).clamp(1, MAX_READ_MESSAGES as u32) as usize;
    let sessions = store::load_sessions_index()
        .into_iter()
        .filter(|session| {
            args.project_id
                .as_deref()
                .is_none_or(|project_id| session.project_id.as_deref() == Some(project_id))
        })
        .filter(|session| {
            session
                .project_id
                .as_deref()
                .and_then(find_allowed_project)
                .is_some()
        })
        .take(limit)
        .map(|session| {
            let snapshot = mgr.snapshot_for(&session.id);
            json!({
                "id": session.id,
                "title": session.title,
                "projectId": session.project_id,
                "modelId": session.model_id,
                "updatedAt": session.updated_at,
                "archived": session.archived,
                "status": snapshot
                    .as_ref()
                    .map(session_status)
                    .unwrap_or("idle"),
            })
        })
        .collect::<Vec<_>>();
    Ok(Value::Array(sessions))
}

fn read_session(params: Value) -> Result<Value, String> {
    let args: ReadSessionArgs = parse_params(params)?;
    let session = find_session(&args.session_id)?;
    ensure_session_allowed(&session)?;
    let include_thoughts = args.include_thoughts.unwrap_or(false);
    let limit = args.limit.unwrap_or(50).clamp(1, MAX_READ_MESSAGES as u32) as usize;
    let messages = store::load_messages(&session.id);
    let start = messages.len().saturating_sub(limit);
    let rows = messages[start..]
        .iter()
        .map(|message| message_for_external(message, include_thoughts))
        .collect::<Vec<_>>();
    Ok(json!({
        "sessionId": session.id,
        "title": session.title,
        "projectId": session.project_id,
        "messages": rows,
    }))
}

async fn start_task(
    params: Value,
    app: &AppHandle,
    mgr: &std::sync::Arc<SessionManager>,
    runtime: &std::sync::Arc<Runtime>,
) -> Result<Value, String> {
    let args: StartTaskArgs = parse_params(params)?;
    let project_id = args.project_id.trim().to_string();
    let prompt = args.prompt.trim().to_string();
    if project_id.is_empty() {
        return Err("projectId is required".into());
    }
    if prompt.is_empty() {
        return Err("prompt is required".into());
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(format!("prompt exceeds {MAX_PROMPT_CHARS} characters"));
    }
    let project = find_allowed_project(&project_id)
        .ok_or_else(|| "project is not trusted or no longer available".to_string())?;
    let model = args
        .model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if model
        .as_ref()
        .is_some_and(|value| value.chars().count() > 200)
    {
        return Err("model is too long".into());
    }
    let request_id = args
        .request_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if request_id
        .as_ref()
        .is_some_and(|value| value.chars().count() > 128)
    {
        return Err("requestId is too long".into());
    }
    let fingerprint = task_fingerprint(&project_id, &prompt, model.as_deref());

    // Serialise task admission so two concurrent retries cannot create two
    // sessions for the same request id.
    let mut requests = runtime.requests.lock().await;
    if let Some(request_id) = request_id.as_deref() {
        if let Some(existing) = requests
            .records
            .iter()
            .find(|record| record.request_id == request_id)
        {
            if existing.fingerprint != fingerprint {
                audit(
                    "start_task",
                    "rejected_request_reuse",
                    Some(request_id),
                    Some(&project_id),
                    Some(&existing.session_id),
                    None,
                );
                return Err("requestId was already used with different task arguments".into());
            }
            audit(
                "start_task",
                "reused",
                Some(request_id),
                Some(&project_id),
                Some(&existing.session_id),
                None,
            );
            return Ok(json!({
                "sessionId": existing.session_id,
                "requestId": request_id,
                "reused": true,
                "status": existing.status,
                "approvalRequired": true,
            }));
        }
    }

    let title = task_title(&prompt);
    let mut session = store::create_session(Some(project.id.clone()), Some(title), false)?;
    // External control must never inherit a desktop-wide dontAsk/alwaysApprove
    // setting. This session-level value wins the normal permission cascade.
    session.permission_policy = Some("ask".into());
    if let Some(model) = model.as_deref() {
        session.model_id = Some(model.to_string());
    }
    store::update_session_meta(&session)?;

    // Reserve the request before any connection or prompt side effect. If the
    // desktop crashes between these steps, a retry reuses this session instead
    // of creating a second task with the same request id.
    if let Some(request_id) = request_id.as_deref() {
        requests.records.push(RequestRecord {
            request_id: request_id.to_string(),
            fingerprint: fingerprint.clone(),
            session_id: session.id.clone(),
            created_at: Utc::now().to_rfc3339(),
            status: "starting".into(),
        });
        if requests.records.len() > REQUEST_JOURNAL_LIMIT {
            let remove = requests.records.len() - REQUEST_JOURNAL_LIMIT;
            requests.records.drain(0..remove);
        }
        persist_request_journal(&requests)?;
    }

    let previous_focus = focused_session(mgr);
    let connect = mgr
        .connect(
            app.clone(),
            Some(project.path.clone()),
            None,
            Some(session.id.clone()),
            None,
        )
        .await;
    if let Err(error) = connect {
        if let Some(request_id) = request_id.as_deref() {
            let _ = set_request_status(&mut requests, request_id, "failed");
        }
        audit(
            "start_task",
            "connect_failed",
            request_id.as_deref(),
            Some(&project_id),
            Some(&session.id),
            Some(&error),
        );
        return Err(error);
    }
    if let Some(model) = model.clone() {
        if let Err(error) = mgr.set_model(model).await {
            if let Some(request_id) = request_id.as_deref() {
                let _ = set_request_status(&mut requests, request_id, "failed");
            }
            audit(
                "start_task",
                "model_failed",
                request_id.as_deref(),
                Some(&project_id),
                Some(&session.id),
                Some(&error),
            );
            restore_focus(app, mgr, previous_focus).await;
            return Err(error);
        }
    }
    let send = mgr
        .send_message(app.clone(), prompt, None, None, Some(session.id.clone()))
        .await;
    restore_focus(app, mgr, previous_focus).await;
    if let Err(error) = send {
        if let Some(request_id) = request_id.as_deref() {
            let _ = set_request_status(&mut requests, request_id, "failed");
        }
        audit(
            "start_task",
            "send_failed",
            request_id.as_deref(),
            Some(&project_id),
            Some(&session.id),
            Some(&error),
        );
        return Err(error);
    }

    if let Some(request_id) = request_id {
        set_request_status(&mut requests, &request_id, "accepted")?;
        persist_request_journal(&requests)?;
        audit(
            "start_task",
            "accepted",
            Some(&request_id),
            Some(&project_id),
            Some(&session.id),
            None,
        );
        Ok(json!({
            "sessionId": session.id,
            "requestId": request_id,
            "reused": false,
            "status": "accepted",
            "approvalRequired": true,
        }))
    } else {
        audit(
            "start_task",
            "accepted",
            None,
            Some(&project_id),
            Some(&session.id),
            None,
        );
        Ok(json!({
            "sessionId": session.id,
            "reused": false,
            "status": "accepted",
            "approvalRequired": true,
        }))
    }
}

async fn wait_for_task(params: Value, mgr: &SessionManager) -> Result<Value, String> {
    let args: WaitTaskArgs = parse_params(params)?;
    let session = find_session(&args.session_id)?;
    ensure_session_allowed(&session)?;
    let timeout_ms = args.timeout_ms.unwrap_or(30_000).min(MAX_WAIT_MS);
    let deadline = tokio::time::Instant::now() + Duration::from_millis(timeout_ms);

    loop {
        let messages = store::load_messages(&session.id);
        let snapshot = mgr.snapshot_for(&session.id);
        let status = task_status(snapshot.as_ref(), &messages);
        if !matches!(status, "running" | "connecting") {
            let response = task_result(&session, snapshot.as_ref(), &messages, status);
            audit(
                "wait_for_task",
                status,
                None,
                session.project_id.as_deref(),
                Some(&session.id),
                None,
            );
            return Ok(response);
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(json!({
                "sessionId": session.id,
                "status": status,
                "state": snapshot.map(|value| value.state),
                "timedOut": true,
            }));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn cancel_task(
    params: Value,
    app: &AppHandle,
    mgr: &std::sync::Arc<SessionManager>,
) -> Result<Value, String> {
    let args: CancelTaskArgs = parse_params(params)?;
    let session = find_session(&args.session_id)?;
    ensure_session_allowed(&session)?;
    let previous_focus = focused_session(mgr);
    let snapshot = mgr
        .connect(
            app.clone(),
            find_allowed_project(session.project_id.as_deref().unwrap_or_default())
                .map(|project| project.path),
            None,
            Some(session.id.clone()),
            None,
        )
        .await?;
    let stopped = mgr.stop(app.clone(), Some(session.id.clone())).await?;
    restore_focus(app, mgr, previous_focus).await;
    audit(
        "cancel_task",
        "accepted",
        None,
        session.project_id.as_deref(),
        Some(&session.id),
        None,
    );
    Ok(json!({
        "sessionId": session.id,
        "previousState": snapshot.state,
        "state": stopped.state,
        "cancelled": true,
    }))
}

fn parse_params<T: DeserializeOwned>(params: Value) -> Result<T, String> {
    serde_json::from_value(params).map_err(|error| format!("invalid tool arguments: {error}"))
}

fn find_allowed_project(id: &str) -> Option<Project> {
    let id = id.trim();
    if id.is_empty() {
        return None;
    }
    store::load_projects()
        .into_iter()
        .find(|project| project.id == id && project_is_allowed(project))
}

fn project_is_allowed(project: &Project) -> bool {
    project.trusted && project.path_ok && Path::new(&project.path).is_dir()
}

fn find_session(id: &str) -> Result<SessionMeta, String> {
    store::load_sessions_index()
        .into_iter()
        .find(|session| session.id == id.trim())
        .ok_or_else(|| "session not found".into())
}

fn ensure_session_allowed(session: &SessionMeta) -> Result<(), String> {
    if session
        .project_id
        .as_deref()
        .and_then(find_allowed_project)
        .is_some()
    {
        Ok(())
    } else {
        Err("session project is not trusted or no longer available".into())
    }
}

fn focused_session(mgr: &SessionManager) -> Option<(String, Option<String>)> {
    let snapshot = mgr.snapshot();
    let id = snapshot.session_id?;
    let path = store::load_sessions_index()
        .into_iter()
        .find(|session| session.id == id)
        .and_then(|session| {
            session
                .project_id
                .as_deref()
                .and_then(find_allowed_project)
                .map(|project| project.path)
        });
    Some((id, path))
}

async fn restore_focus(
    app: &AppHandle,
    mgr: &std::sync::Arc<SessionManager>,
    previous: Option<(String, Option<String>)>,
) {
    let Some((session_id, project_path)) = previous else {
        return;
    };
    if let Err(error) = mgr
        .connect(app.clone(), project_path, None, Some(session_id), None)
        .await
    {
        tracing::debug!("MCP could not restore focused session: {error}");
    }
}

fn session_status(snapshot: &SessionSnapshot) -> &'static str {
    match snapshot.state {
        SessionState::Connecting => "connecting",
        SessionState::Ready => "ready",
        SessionState::Streaming => "running",
        SessionState::AwaitingPermission => "waiting_for_approval",
        SessionState::Disconnected => {
            if snapshot.last_error.is_some() {
                "failed"
            } else {
                "disconnected"
            }
        }
        SessionState::Idle => "idle",
    }
}

fn task_status(snapshot: Option<&SessionSnapshot>, messages: &[ChatMessageStored]) -> &'static str {
    if let Some(snapshot) = snapshot {
        match snapshot.state {
            SessionState::Connecting => return "connecting",
            SessionState::Streaming => return "running",
            SessionState::AwaitingPermission => return "waiting_for_approval",
            SessionState::Disconnected if snapshot.last_error.is_some() => return "failed",
            _ => {}
        }
    }
    if messages
        .iter()
        .rev()
        .find(|message| message.role == "assistant")
        .is_some_and(|message| message.is_error)
    {
        return "failed";
    }
    if messages
        .iter()
        .rev()
        .any(|message| message.role == "assistant")
    {
        return "completed";
    }
    if messages.iter().rev().any(|message| message.role == "user") {
        return "queued";
    }
    "idle"
}

fn task_result(
    session: &SessionMeta,
    snapshot: Option<&SessionSnapshot>,
    messages: &[ChatMessageStored],
    status: &str,
) -> Value {
    let latest_assistant = messages
        .iter()
        .rev()
        .find(|message| message.role == "assistant")
        .map(|message| message_for_external(message, false));
    json!({
        "sessionId": session.id,
        "status": status,
        "state": snapshot.map(|value| value.state),
        "modelId": snapshot.and_then(|value| value.model_id.clone()).or_else(|| session.model_id.clone()),
        "message": latest_assistant,
    })
}

fn message_for_external(message: &ChatMessageStored, include_thoughts: bool) -> Value {
    let mut value = json!({
        "id": message.id,
        "role": message.role,
        "content": truncate(&message.content, MAX_READ_MESSAGE_CHARS),
        "modelId": message.model_id,
        "effort": message.effort,
        "createdAt": message.created_at,
        "isError": message.is_error,
        "marker": message.marker,
    });
    if include_thoughts {
        value["thought"] = message
            .thought
            .as_deref()
            .map(|thought| Value::String(truncate(thought, MAX_READ_MESSAGE_CHARS)))
            .unwrap_or(Value::Null);
    }
    value
}

fn task_title(prompt: &str) -> String {
    let first_line = prompt.lines().next().unwrap_or(prompt).trim();
    let title = truncate(first_line, 80);
    if title.is_empty() {
        "External task".into()
    } else {
        title
    }
}

fn truncate(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let out = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{out}…")
    } else {
        out
    }
}

fn task_fingerprint(project_id: &str, prompt: &str, model: Option<&str>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(project_id.as_bytes());
    hasher.update([0]);
    hasher.update(prompt.as_bytes());
    hasher.update([0]);
    if let Some(model) = model {
        hasher.update(model.as_bytes());
    }
    hex::encode(hasher.finalize())
}

fn load_request_journal() -> RequestJournal {
    let path = crate::paths::mcp_requests_file();
    fs::read_to_string(path)
        .ok()
        .and_then(|body| serde_json::from_str(&body).ok())
        .unwrap_or_default()
}

fn persist_request_journal(journal: &RequestJournal) -> Result<(), String> {
    let body = serde_json::to_vec_pretty(journal).map_err(|error| error.to_string())?;
    let path = crate::paths::mcp_requests_file();
    crate::store_lock::write_bytes_atomic(&path, &body)?;
    set_private_permissions(&path);
    Ok(())
}

fn set_request_status(
    journal: &mut RequestJournal,
    request_id: &str,
    status: &str,
) -> Result<(), String> {
    let record = journal
        .records
        .iter_mut()
        .find(|record| record.request_id == request_id)
        .ok_or_else(|| "MCP request receipt is missing".to_string())?;
    record.status = status.to_string();
    persist_request_journal(journal)
}

fn write_private_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let body = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    crate::store_lock::write_bytes_atomic(path, &body)?;
    set_private_permissions(path);
    Ok(())
}

fn set_private_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(path) {
            let mut permissions = metadata.permissions();
            permissions.set_mode(0o600);
            let _ = fs::set_permissions(path, permissions);
        }
    }
}

fn audit(
    operation: &str,
    outcome: &str,
    request_id: Option<&str>,
    project_id: Option<&str>,
    session_id: Option<&str>,
    error: Option<&str>,
) {
    let path = crate::paths::mcp_audit_file();
    let Ok(_lock) = crate::store_lock::lock_exclusive(&path) else {
        tracing::warn!("MCP audit lock unavailable");
        return;
    };
    let record = json!({
        "at": Utc::now(),
        "operation": operation,
        "outcome": outcome,
        "requestId": request_id,
        "projectId": project_id,
        "sessionId": session_id,
        "error": error.map(|value| truncate(&store::redact_text(value), 500)),
    });
    let Ok(line) = serde_json::to_string(&record) else {
        return;
    };
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{line}");
        set_private_permissions(&path);
    }
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let mut diff = left.len() ^ right.len();
    for index in 0..left.len().max(right.len()) {
        diff |= left.get(index).copied().unwrap_or(0) as usize
            ^ right.get(index).copied().unwrap_or(0) as usize;
    }
    diff == 0
}

fn token_hash(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

fn token_is_revoked(token: &str) -> bool {
    let path = crate::paths::mcp_revocation_file();
    let Ok(body) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<Value>(&body) else {
        return false;
    };
    value
        .get("tokenHash")
        .and_then(Value::as_str)
        .is_some_and(|hash| constant_time_eq(hash, &token_hash(token)))
}

async fn run_stdio_async() -> Result<(), String> {
    // Resolve the endpoint for every tool call. The desktop rotates its
    // loopback token on restart, so a long-lived MCP client must not keep a
    // stale address or bearer in memory forever.
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();
    let mut reader = BufReader::new(stdin);
    let mut writer = tokio::io::BufWriter::new(stdout);
    let mut line = String::new();

    loop {
        line.clear();
        let read = reader
            .read_line(&mut line)
            .await
            .map_err(|error| format!("MCP stdio read: {error}"))?;
        if read == 0 {
            return Ok(());
        }
        if read > MAX_FRAME_BYTES {
            return Err("MCP stdio request too large".into());
        }
        let request: StdioRequest = serde_json::from_str(line.trim())
            .map_err(|error| format!("invalid MCP JSON-RPC request: {error}"))?;
        if request
            .jsonrpc
            .as_deref()
            .is_some_and(|version| version != "2.0")
        {
            write_stdio_error(&mut writer, request.id, -32600, "jsonrpc must be 2.0").await?;
            continue;
        }
        if request.id.is_none() {
            // MCP notifications (notably notifications/initialized) have no response.
            continue;
        }
        let id = request.id.clone().unwrap_or(Value::Null);
        let result = match request.method.as_str() {
            "initialize" => Ok(json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": {
                    "name": SERVER_NAME,
                    "version": env!("CARGO_PKG_VERSION"),
                },
            })),
            "tools/list" => Ok(json!({ "tools": tool_definitions() })),
            "tools/call" => {
                let name = request
                    .params
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "tools/call requires a tool name".to_string());
                match name {
                    Ok(name) => {
                        let params = request
                            .params
                            .get("arguments")
                            .cloned()
                            .unwrap_or_else(|| json!({}));
                        match call_loopback(name, params).await {
                            Ok(value) => Ok(tool_call_result(value, false)),
                            Err(error) => Ok(tool_call_result(json!({ "error": error }), true)),
                        }
                    }
                    Err(error) => Err(error),
                }
            }
            "ping" => Ok(json!({})),
            _ => Err(format!("method not found: {}", request.method)),
        };

        match result {
            Ok(result) => write_stdio_result(&mut writer, id, result).await?,
            Err(error) => write_stdio_error(&mut writer, Some(id), -32000, error).await?,
        }
    }
}

async fn call_loopback(name: &str, params: Value) -> Result<Value, String> {
    let mut last_error = None;
    for (attempt, delay) in MCP_RECONNECT_DELAYS.iter().copied().enumerate() {
        let endpoint = match load_endpoint() {
            Ok(endpoint) => endpoint,
            Err(error) => {
                last_error = Some(error);
                if attempt + 1 < MCP_RECONNECT_DELAYS.len() {
                    tokio::time::sleep(delay).await;
                    continue;
                }
                break;
            }
        };
        match call_loopback_once(&endpoint, name, &params).await {
            Ok(value) => return Ok(value),
            Err(error) if is_retryable_loopback_error(&error) => {
                last_error = Some(error);
                if attempt + 1 < MCP_RECONNECT_DELAYS.len() {
                    tokio::time::sleep(delay).await;
                    continue;
                }
            }
            Err(error) => return Err(error),
        }
    }
    Err(last_error.unwrap_or_else(|| "cannot connect to Pi Desktop".into()))
}

async fn call_loopback_once(
    endpoint: &EndpointFile,
    name: &str,
    params: &Value,
) -> Result<Value, String> {
    if endpoint.version != ENDPOINT_VERSION {
        return Err("unsupported Pi App MCP endpoint version".into());
    }
    let stream = tokio::time::timeout(
        Duration::from_secs(3),
        TcpStream::connect(&endpoint.address),
    )
    .await
    .map_err(|_| "timed out connecting to Pi Desktop".to_string())?
    .map_err(|error| format!("cannot connect to Pi Desktop: {error}"))?;
    let (read_half, mut write_half) = stream.into_split();
    let request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "token": endpoint.token,
        "method": name,
        "params": params,
    });
    let body = serde_json::to_string(&request).map_err(|error| error.to_string())?;
    write_half
        .write_all(body.as_bytes())
        .await
        .map_err(|error| format!("MCP proxy write: {error}"))?;
    write_half
        .write_all(b"\n")
        .await
        .map_err(|error| format!("MCP proxy newline: {error}"))?;
    write_half
        .flush()
        .await
        .map_err(|error| format!("MCP proxy flush: {error}"))?;

    let mut reader = BufReader::new(read_half);
    let mut line = String::new();
    tokio::time::timeout(Duration::from_secs(65), reader.read_line(&mut line))
        .await
        .map_err(|_| "timed out waiting for Pi Desktop".to_string())?
        .map_err(|error| format!("MCP proxy read: {error}"))?;
    if line.len() > MAX_FRAME_BYTES {
        return Err("Pi Desktop MCP response too large".into());
    }
    let response: LocalResponse = serde_json::from_str(line.trim())
        .map_err(|error| format!("invalid MCP response: {error}"))?;
    if let Some(error) = response.error {
        return Err(error.message);
    }
    response
        .result
        .ok_or_else(|| "Pi Desktop returned an empty MCP result".into())
}

fn is_retryable_loopback_error(error: &str) -> bool {
    error.starts_with("cannot connect to Pi Desktop:")
        || error == "timed out connecting to Pi Desktop"
        || error.starts_with("MCP proxy write:")
        || error.starts_with("MCP proxy read:")
        || error.starts_with("invalid MCP response:")
}

fn load_endpoint() -> Result<EndpointFile, String> {
    let path = crate::paths::mcp_endpoint_file();
    let metadata = fs::symlink_metadata(&path).map_err(|_| {
        format!(
            "Pi Desktop is not running or its MCP endpoint is unavailable ({})",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err("Pi Desktop MCP endpoint is not a regular file".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err("Pi Desktop MCP endpoint permissions are too broad".into());
        }
    }
    let body = fs::read_to_string(&path).map_err(|_| {
        format!(
            "Pi Desktop is not running or its MCP endpoint is unavailable ({})",
            path.display()
        )
    })?;
    let endpoint: EndpointFile = serde_json::from_str(&body)
        .map_err(|error| format!("invalid Pi Desktop MCP endpoint: {error}"))?;
    validate_endpoint(&endpoint)?;
    Ok(endpoint)
}

fn validate_endpoint(endpoint: &EndpointFile) -> Result<(), String> {
    if endpoint.version != ENDPOINT_VERSION {
        return Err(format!(
            "unsupported Pi App MCP endpoint version {}",
            endpoint.version
        ));
    }
    let address: SocketAddr = endpoint
        .address
        .parse()
        .map_err(|_| "Pi Desktop MCP endpoint address is invalid".to_string())?;
    if !address.ip().is_loopback() || address.port() == 0 {
        return Err("refusing a non-loopback Pi Desktop MCP endpoint".into());
    }
    if endpoint.token.len() < 32 {
        return Err("Pi Desktop MCP endpoint token is invalid".into());
    }
    if endpoint.pid == 0 || endpoint.started_at.trim().is_empty() {
        return Err("Pi Desktop MCP endpoint metadata is invalid".into());
    }
    Ok(())
}

async fn write_stdio_result(
    writer: &mut tokio::io::BufWriter<tokio::io::Stdout>,
    id: Value,
    result: Value,
) -> Result<(), String> {
    let response = json!({ "jsonrpc": "2.0", "id": id, "result": result });
    let body = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    writer
        .write_all(body.as_bytes())
        .await
        .map_err(|error| format!("MCP stdio write: {error}"))?;
    writer
        .write_all(b"\n")
        .await
        .map_err(|error| format!("MCP stdio newline: {error}"))?;
    writer
        .flush()
        .await
        .map_err(|error| format!("MCP stdio flush: {error}"))
}

async fn write_stdio_error(
    writer: &mut tokio::io::BufWriter<tokio::io::Stdout>,
    id: Option<Value>,
    code: i64,
    message: impl Into<String>,
) -> Result<(), String> {
    let response = json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "error": { "code": code, "message": message.into() },
    });
    let body = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    writer
        .write_all(body.as_bytes())
        .await
        .map_err(|error| format!("MCP stdio write: {error}"))?;
    writer
        .write_all(b"\n")
        .await
        .map_err(|error| format!("MCP stdio newline: {error}"))?;
    writer
        .flush()
        .await
        .map_err(|error| format!("MCP stdio flush: {error}"))
}

fn tool_call_result(value: Value, is_error: bool) -> Value {
    let text = serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".into());
    json!({
        "content": [{ "type": "text", "text": text }],
        "structuredContent": value,
        "isError": is_error,
    })
}

fn tool_definitions() -> Value {
    json!([
        {
            "name": "pi_overview",
            "description": "Read Pi Desktop capabilities and current task counts.",
            "inputSchema": { "type": "object", "additionalProperties": false }
        },
        {
            "name": "pi_list_allowed_projects",
            "description": "List projects explicitly trusted in Pi Desktop.",
            "inputSchema": { "type": "object", "additionalProperties": false }
        },
        {
            "name": "pi_list_sessions",
            "description": "List sessions belonging to trusted projects.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "projectId": { "type": "string" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "pi_read_session",
            "description": "Read recent messages from a trusted-project session.",
            "inputSchema": {
                "type": "object",
                "required": ["sessionId"],
                "properties": {
                    "sessionId": { "type": "string" },
                    "includeThoughts": { "type": "boolean", "default": false },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "pi_start_task",
            "description": "Start a task in a trusted project. Permissions remain approval-required by default.",
            "inputSchema": {
                "type": "object",
                "required": ["projectId", "prompt"],
                "properties": {
                    "projectId": { "type": "string" },
                    "prompt": { "type": "string", "minLength": 1, "maxLength": MAX_PROMPT_CHARS },
                    "model": { "type": "string" },
                    "requestId": { "type": "string", "maxLength": 128 }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "pi_wait_for_task",
            "description": "Wait for a task, or return its approval/running status after a bounded timeout.",
            "inputSchema": {
                "type": "object",
                "required": ["sessionId"],
                "properties": {
                    "sessionId": { "type": "string" },
                    "timeoutMs": { "type": "integer", "minimum": 0, "maximum": MAX_WAIT_MS }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "pi_cancel_task",
            "description": "Cancel a task in a trusted project and restore the previously focused chat when possible.",
            "inputSchema": {
                "type": "object",
                "required": ["sessionId"],
                "properties": { "sessionId": { "type": "string" } },
                "additionalProperties": false
            }
        }
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_time_comparison_requires_equal_bytes() {
        assert!(constant_time_eq("abc", "abc"));
        assert!(!constant_time_eq("abc", "abd"));
        assert!(!constant_time_eq("abc", "abcd"));
    }

    #[test]
    fn task_fingerprint_is_stable_without_storing_prompt() {
        let left = task_fingerprint("project", "do the thing", Some("model"));
        let right = task_fingerprint("project", "do the thing", Some("model"));
        let other = task_fingerprint("project", "do another thing", Some("model"));
        assert_eq!(left, right);
        assert_ne!(left, other);
        assert_eq!(left.len(), 64);
    }

    #[test]
    fn truncate_is_utf8_safe() {
        assert_eq!(truncate("ciao", 10), "ciao");
        assert_eq!(truncate("è molto lungo", 3), "è m…");
    }

    #[test]
    fn tool_definitions_are_closed_and_include_control_surface() {
        let definitions = tool_definitions();
        let names = definitions
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str))
            .collect::<Vec<_>>();
        assert!(names.contains(&"pi_overview"));
        assert!(names.contains(&"pi_start_task"));
        assert!(names.contains(&"pi_cancel_task"));
        assert_eq!(names.len(), 7);
    }

    #[test]
    fn tool_call_result_uses_mcp_content_and_structured_content() {
        let result = tool_call_result(json!({ "ok": true }), false);
        assert_eq!(result["isError"], false);
        assert_eq!(result["structuredContent"]["ok"], true);
        assert_eq!(result["content"][0]["type"], "text");
        assert!(result["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("ok"));
    }

    #[test]
    fn endpoint_is_loopback_only() {
        let valid = EndpointFile {
            version: ENDPOINT_VERSION,
            address: "127.0.0.1:1234".into(),
            token: "x".repeat(32),
            pid: 1,
            started_at: Utc::now().to_rfc3339(),
        };
        assert!(validate_endpoint(&valid).is_ok());
        let invalid = EndpointFile {
            address: "0.0.0.0:1234".into(),
            ..valid
        };
        assert!(validate_endpoint(&invalid).is_err());
    }

    #[test]
    fn old_request_receipts_default_to_accepted() {
        let record: RequestRecord = serde_json::from_value(json!({
            "requestId": "r1",
            "fingerprint": "f",
            "sessionId": "s1",
            "createdAt": "2026-08-03T00:00:00Z"
        }))
        .unwrap();
        assert_eq!(record.status, "accepted");
    }

    #[test]
    fn only_transport_failures_are_retried() {
        assert!(is_retryable_loopback_error(
            "cannot connect to Pi Desktop: refused"
        ));
        assert!(is_retryable_loopback_error(
            "timed out connecting to Pi Desktop"
        ));
        assert!(!is_retryable_loopback_error("unauthorized"));
    }

    #[test]
    fn token_hash_is_one_way_and_fixed_length() {
        let first = token_hash("token-a");
        let second = token_hash("token-b");
        assert_eq!(first.len(), 64);
        assert_ne!(first, second);
        assert!(!constant_time_eq(&first, "token-a"));
    }

    #[test]
    fn rate_limit_resets_after_its_window() {
        let start = Instant::now();
        let mut state = RateLimitState {
            window_started: start,
            requests: MCP_RATE_LIMIT_REQUESTS - 1,
        };
        assert!(state.allow(start));
        assert!(!state.allow(start));
        assert!(state.allow(start + MCP_RATE_LIMIT_WINDOW));
    }
}
