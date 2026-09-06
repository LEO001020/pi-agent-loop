//! Host-side error taxonomy. UI maps codes via `src/lib/session.ts` errorCopy.

use serde::{Deserialize, Serialize};

/// Stable error codes for agent / runtime failures.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentErrorCode {
    /// Binary missing or not executable.
    CliNotFound,
    /// 401 / invalid key / not logged in.
    AuthFailed,
    /// DNS / timeout / provider 5xx / model 404.
    NetworkProvider,
    /// Process died or protocol crashed.
    AgentCrashed,
    /// Quota / rate limit / insufficient credits.
    QuotaExceeded,
    /// Could not attach agent to this session (no ACP / connect failed).
    ConnectFailed,
    /// Max concurrent agent processes reached (I02).
    ProcessLimit,
}

impl AgentErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CliNotFound => "CLI_NOT_FOUND",
            Self::AuthFailed => "AUTH_FAILED",
            Self::NetworkProvider => "NETWORK_PROVIDER",
            Self::AgentCrashed => "AGENT_CRASHED",
            Self::QuotaExceeded => "QUOTA_EXCEEDED",
            Self::ConnectFailed => "CONNECT_FAILED",
            Self::ProcessLimit => "PROCESS_LIMIT",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentError {
    pub code: AgentErrorCode,
    pub message: String,
}

impl AgentError {
    pub fn new(code: AgentErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_codes_serialize_to_stable_names() {
        let codes = [
            AgentErrorCode::CliNotFound,
            AgentErrorCode::AuthFailed,
            AgentErrorCode::NetworkProvider,
            AgentErrorCode::AgentCrashed,
            AgentErrorCode::QuotaExceeded,
            AgentErrorCode::ConnectFailed,
            AgentErrorCode::ProcessLimit,
        ];
        let expected = [
            "CLI_NOT_FOUND",
            "AUTH_FAILED",
            "NETWORK_PROVIDER",
            "AGENT_CRASHED",
            "QUOTA_EXCEEDED",
            "CONNECT_FAILED",
            "PROCESS_LIMIT",
        ];
        for (code, name) in codes.into_iter().zip(expected) {
            assert_eq!(code.as_str(), name);
            let json = serde_json::to_string(&code).unwrap();
            assert_eq!(json, format!("\"{name}\""));
        }
    }
}
