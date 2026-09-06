# Pi alignment: models / effort / permissions / modes

Source: `src/lib/agentCatalog.ts` (static fallback), `src-tauri/src/models_catalog.rs`, `src-tauri/src/agent_prefs.rs`.

> [!NOTE]
> Verified against Pi 0.82.x by probing a live `pi --mode rpc` process.
> Sections below that describe the forked-from CLI are marked as legacy.

## Models

**The UI only lists models that are actually available. Providers are a backend routing concern and are switched only in Settings → Providers & Models.**

| Source | Notes |
|--------|-------|
| `models_cache.json` | Official CLI catalog |
| Static fallback | `pi-4.5` |

Probe: `scripts/probe-models.sh`. Host command: `models_list_available`.

Spawn line (verified, `acp_client.rs`):

```text
pi --mode rpc --approve [--model <id>] [--thinking <level>]
```

The wire protocol in `--mode rpc` is Pi's own JSONL event stream
(`{"type":"message_start"|"tool_execution_start"|"extension_ui_request"|…}`),
**not** JSON-RPC/ACP. `acp_client.rs` speaks this stream and additionally
accepts JSON-RPC reverse requests (`_x.ai/exit_plan_mode`,
`_x.ai/ask_user_question`) for backward compatibility.

**Extension-dependent surfaces**: Pi core never sends `_x.ai/exit_plan_mode`,
`_x.ai/ask_user_question` or `x.ai/rewind/*`. Those arrive only if an
installed extension registers them (none of the common ones do today). The
Plan review panel, the ask-user questionnaire and agent-side rewind are
therefore inert against a stock Pi install — treat them as opt-in
extension UI, not core features.

## Reasoning effort

Each model in the CLI's `models_cache.json` may carry `info.reasoning_efforts: [{id,value,label,description,default}]`. The host passes it through as `AvailableModel.reasoningEfforts` (with `isDefault`); the composer list prefers that array and falls back to the static `PI_FALLBACK_EFFORTS` (`low` | `medium` | `high`) when it is empty. Display labels prefer the catalog `label`, otherwise the i18n keys `effort.high|medium|low`.

Spawn: `--thinking <level>` (legacy shells used `--reasoning-effort`). With no model-level default the app defaults to **`medium`**; when a model marks one `default: true`, that wins. Changing it mid-session soft-disconnects the agent and reconnects on the next message — there is no `session/set_effort` RPC.

### Connection speed-ups (host)

| Technique | Notes |
|-----------|-------|
| Default to medium effort | Shorter thinking / TTFT than high, steadier than low |
| `PI_OFFLINE=1` / `--offline` | Skips startup network operations |
| Process reuse | Same cwd + effort + YOLO flag: switching chats only does `session/load\|new`, without respawning the CLI |
| Warm up on open | `openSession` runs `session_connect` in the background so the first send skips cold start |

## Session modes

| App | Purpose |
|-----|---------|
| `agent` | Default coding agent |
| `plan` | Plan mode (ACP `session/set_mode`) |
| `ask` | Question / mostly read-only collaboration |

Implementation:

1. After a successful connect, `session/set_mode` (trying candidate mode ids such as `plan` / `ask` / `agent`).
2. Switching mid-session prefers `set_mode`, and soft-respawns if that fails.
3. Remembered according to `composerPrefsScope`.

## Permissions (including YOLO)

| App ID | Agent config `[ui] permission_mode` | Claude `defaultMode` | Spawn |
|--------|-------------------------------------|----------------------|-------|
| `ask` | `default` | `default` | — |
| `accept_edits` | `acceptEdits` | `acceptEdits` | — |
| `allow_for_session` | `default` + host session cache | `default` | — |
| `dont_ask` | `dontAsk` | `dontAsk` | — |
| `always_approve` | `always-approve` + `yolo=true` | `bypassPermissions` | `--approve` (legacy: `--always-approve`) |

**Independent mode** (the default): writes `~/.pi-app/agent-home/config.toml` and `agent-home/.claude/settings.json`, so the agent process really does enforce the policy.

**Shared mode**: never rewrites the user's `~/.pi/config.toml`; relies on the host policy plus `--always-approve` for YOLO.

Changing permissions mid-session syncs the config and soft-respawns (including downgrading out of YOLO). On `session/request_permission` the host still auto-allows or auto-denies according to the live policy.

Note: read tools and some read-only shell commands may still not prompt, because the agent allow-lists them internally (Pi's design).

**Downloads are allowed by default (host)**: shell commands such as `curl -o/-O`, `wget` or `aria2c` that write **inside the project directory** are auto-approved under any policy other than `dont_ask` / `deny`. This stops a post-image-generation `curl` from hanging on a permission prompt until the 600s timeout. Paths outside the project still need approval, with `always_approve` the only exception.

## Preference scope

`composerPrefsScope` = `global` | `project` | `session`.

Covers model / effort / mode / permission. Switching a chip calls `composer_prefs_set` / `session_set_policy` / `session_set_model`.

## Providers

A custom provider is a routing channel and **must not masquerade as a model**. Configure and switch them in the Providers & Models panel; Pi package adapters are still installed through Extensions.
