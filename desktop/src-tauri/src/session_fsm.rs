//! Pure session FSM owned by Host (§5.2 / §18.1).
//! Frontend only projects snapshots; transitions happen here.

use serde::{Deserialize, Serialize};

use crate::error::{AgentError, AgentErrorCode};

/// Host session lifecycle states (projection targets for UI).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Idle,
    Connecting,
    Ready,
    Streaming,
    AwaitingPermission,
    Disconnected,
}

/// Pure FSM transitions. No I/O.
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(dead_code)] // full transition set for PR3+ (crash/reattach/permission)
pub struct SessionFsm {
    state: SessionState,
    last_error: Option<AgentError>,
}

impl Default for SessionFsm {
    fn default() -> Self {
        Self::new()
    }
}

#[allow(dead_code)] // full transition set for PR3+ (crash/reattach/permission)
impl SessionFsm {
    pub fn new() -> Self {
        Self {
            state: SessionState::Idle,
            last_error: None,
        }
    }

    pub fn state(&self) -> SessionState {
        self.state
    }

    pub fn last_error(&self) -> Option<&AgentError> {
        self.last_error.as_ref()
    }

    pub fn clear_error(&mut self) {
        self.last_error = None;
    }

    /// start/attach → Connecting (from Idle or Disconnected).
    pub fn start_connect(&mut self) -> Result<(), FsmError> {
        match self.state {
            SessionState::Idle | SessionState::Disconnected => {
                self.state = SessionState::Connecting;
                self.last_error = None;
                Ok(())
            }
            other => Err(FsmError::InvalidTransition {
                from: other,
                event: "start_connect",
            }),
        }
    }

    /// Handshake ok → Ready.
    pub fn handshake_ok(&mut self) -> Result<(), FsmError> {
        match self.state {
            SessionState::Connecting => {
                self.state = SessionState::Ready;
                Ok(())
            }
            other => Err(FsmError::InvalidTransition {
                from: other,
                event: "handshake_ok",
            }),
        }
    }

    /// fail/timeout while connecting → Disconnected + error.
    pub fn connect_failed(&mut self, err: AgentError) -> Result<(), FsmError> {
        match self.state {
            SessionState::Connecting => {
                self.state = SessionState::Disconnected;
                self.last_error = Some(err);
                Ok(())
            }
            other => Err(FsmError::InvalidTransition {
                from: other,
                event: "connect_failed",
            }),
        }
    }

    /// user message → Streaming.
    pub fn begin_stream(&mut self) -> Result<(), FsmError> {
        match self.state {
            SessionState::Ready => {
                self.state = SessionState::Streaming;
                Ok(())
            }
            other => Err(FsmError::InvalidTransition {
                from: other,
                event: "begin_stream",
            }),
        }
    }

    /// stream end or stop → Ready.
    pub fn end_stream(&mut self) -> Result<(), FsmError> {
        match self.state {
            SessionState::Streaming | SessionState::AwaitingPermission => {
                self.state = SessionState::Ready;
                Ok(())
            }
            other => Err(FsmError::InvalidTransition {
                from: other,
                event: "end_stream",
            }),
        }
    }

    /// crash/EOF → Disconnected (always AGENT_CRASHED).
    pub fn crash(&mut self, message: impl Into<String>) -> Result<(), FsmError> {
        self.fail_with(AgentError::new(AgentErrorCode::AgentCrashed, message))
    }

    /// Drop live agent without surfacing an error (e.g. prefs changed → respawn).
    pub fn soft_disconnect(&mut self) {
        match self.state {
            SessionState::Ready
            | SessionState::Streaming
            | SessionState::AwaitingPermission
            | SessionState::Connecting => {
                self.state = SessionState::Disconnected;
                self.last_error = None;
            }
            SessionState::Idle | SessionState::Disconnected => {
                self.last_error = None;
            }
        }
    }

    /// Disconnect with a classified error (timeout → NETWORK, auth → AUTH, etc.).
    pub fn fail_with(&mut self, err: AgentError) -> Result<(), FsmError> {
        match self.state {
            SessionState::Ready
            | SessionState::Streaming
            | SessionState::AwaitingPermission
            | SessionState::Connecting => {
                self.state = SessionState::Disconnected;
                self.last_error = Some(err);
                Ok(())
            }
            other => Err(FsmError::InvalidTransition {
                from: other,
                event: "fail_with",
            }),
        }
    }

    /// reattach path → Ready from Disconnected.
    pub fn reattach_ok(&mut self) -> Result<(), FsmError> {
        match self.state {
            SessionState::Disconnected => {
                self.state = SessionState::Ready;
                self.last_error = None;
                Ok(())
            }
            other => Err(FsmError::InvalidTransition {
                from: other,
                event: "reattach_ok",
            }),
        }
    }

    pub fn await_permission(&mut self) -> Result<(), FsmError> {
        match self.state {
            SessionState::Streaming => {
                self.state = SessionState::AwaitingPermission;
                Ok(())
            }
            other => Err(FsmError::InvalidTransition {
                from: other,
                event: "await_permission",
            }),
        }
    }

    /// Permission allow/deny resolved → back to Streaming (or Ready if deny ends turn later).
    pub fn permission_resolved_continue(&mut self) -> Result<(), FsmError> {
        match self.state {
            SessionState::AwaitingPermission => {
                self.state = SessionState::Streaming;
                Ok(())
            }
            other => Err(FsmError::InvalidTransition {
                from: other,
                event: "permission_resolved_continue",
            }),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FsmError {
    InvalidTransition {
        from: SessionState,
        event: &'static str,
    },
}

impl std::fmt::Display for FsmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidTransition { from, event } => {
                write!(f, "invalid transition: {event} from {from:?}")
            }
        }
    }
}

impl std::error::Error for FsmError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn happy_path_connect_stream_stop() {
        let mut fsm = SessionFsm::new();
        assert_eq!(fsm.state(), SessionState::Idle);

        fsm.start_connect().unwrap();
        assert_eq!(fsm.state(), SessionState::Connecting);

        fsm.handshake_ok().unwrap();
        assert_eq!(fsm.state(), SessionState::Ready);

        fsm.begin_stream().unwrap();
        assert_eq!(fsm.state(), SessionState::Streaming);

        fsm.end_stream().unwrap();
        assert_eq!(fsm.state(), SessionState::Ready);
    }

    #[test]
    fn connect_fail_surfaces_cli_not_found() {
        let mut fsm = SessionFsm::new();
        fsm.start_connect().unwrap();
        fsm.connect_failed(AgentError::new(
            AgentErrorCode::CliNotFound,
            "mock: CLI not found (demo)",
        ))
        .unwrap();
        assert_eq!(fsm.state(), SessionState::Disconnected);
        assert_eq!(fsm.last_error().unwrap().code, AgentErrorCode::CliNotFound);
    }

    #[test]
    fn cannot_stream_from_idle() {
        let mut fsm = SessionFsm::new();
        assert!(fsm.begin_stream().is_err());
    }

    #[test]
    fn crash_from_streaming() {
        let mut fsm = SessionFsm::new();
        fsm.start_connect().unwrap();
        fsm.handshake_ok().unwrap();
        fsm.begin_stream().unwrap();
        fsm.crash("mock agent crashed").unwrap();
        assert_eq!(fsm.state(), SessionState::Disconnected);
        assert_eq!(fsm.last_error().unwrap().code, AgentErrorCode::AgentCrashed);
    }
}
