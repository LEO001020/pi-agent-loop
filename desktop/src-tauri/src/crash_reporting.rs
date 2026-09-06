//! Opt-in, local-first crash diagnostics.
//!
//! This module deliberately has no network client. Records are append-only and
//! are included in a support bundle only when the user chooses to export one.

use chrono::Utc;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;

use crate::paths;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashRecord<'a> {
    pub recorded_at: String,
    pub session_id: &'a str,
    pub model_id: Option<&'a str>,
    pub code: &'a str,
    pub detail: &'a str,
    pub latency_ms: Option<u64>,
}

pub fn append(
    session_id: &str,
    model_id: Option<&str>,
    code: &str,
    detail: &str,
    latency_ms: Option<u64>,
) -> Result<(), String> {
    let path = paths::crash_reports_file();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let record = CrashRecord {
        recorded_at: Utc::now().to_rfc3339(),
        session_id,
        model_id,
        code,
        detail,
        latency_ms,
    };
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut file, &record).map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())
}
