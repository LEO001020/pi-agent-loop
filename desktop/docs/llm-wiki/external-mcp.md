# External MCP control

Pi Desktop has a local-only MCP bridge for external orchestration. It reuses
the desktop `SessionManager`, so external tasks are addressed to real Pi
sessions instead of launching a second fake runtime.

## Start the adapter

The desktop app must already be running with `PI_APP_ENABLE_MCP=1`. The bridge
is disabled by default and removes any stale endpoint when disabled. Configure
an MCP client with the same binary used for Pi Desktop and these arguments:

```json
{
  "command": "/path/to/pi-app",
  "args": ["mcp", "serve"]
}
```

The stdio adapter reads a short-lived endpoint from Pi's app-data directory and
authenticates every request with its per-launch token. The desktop listener is
bound to `127.0.0.1` only. A stale endpoint is deleted and replaced on every
desktop start.

## Available tools

| Tool | Purpose |
|---|---|
| `pi_overview` | Protocol, capabilities and current counts |
| `pi_list_allowed_projects` | Projects that are trusted and still exist |
| `pi_list_sessions` | Sessions belonging to trusted projects |
| `pi_read_session` | Recent messages, with thoughts opt-in |
| `pi_start_task` | Addressed task start with project, prompt and optional model |
| `pi_wait_for_task` | Bounded wait with running/approval/completed status |
| `pi_cancel_task` | Cancel an addressed task |

`pi_start_task` requires `projectId` and `prompt`. A project must already be
trusted in the desktop project registry; the tool never accepts an arbitrary
path. `requestId` is optional, but when present it is fingerprinted and stored
so a retry with the same arguments returns the original session instead of
starting a duplicate. Reusing a request id with different arguments is
rejected.

## Permission and data boundaries

- External starts force a session-level `ask` policy. They never inherit a
  desktop-wide auto-approve setting for that task.
- `pi_read_session` and `pi_list_sessions` are scoped to trusted projects.
- `pi_wait_for_task` is bounded to one minute per call; a still-running task
  returns its current status rather than holding an unbounded connection.
- The loopback endpoint enforces a per-launch request limit of 120 requests per
  60-second window; clients should reuse one connection and back off on a
  `rate limit exceeded` response.
- The audit file is append-only and redacted. It records ids and outcomes, not
  prompts, message bodies, credentials or bearer tokens.
- The bridge is not a remote-access service. Do not forward its loopback port
  or copy its endpoint file to another machine.

Permission dialogs continue to belong to the existing desktop surface. An
external client can observe that a task is waiting for approval, while the
user retains the final approval decision in Pi Desktop.
