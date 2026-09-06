# Automations / scheduled tasks

**Status**: P1 UI + local storage + silent creation from chat + Rust host scheduler + durable run ledger + optional headless daemon.
**Principle**: delegate to Build wherever Build can do it; the shell owns the list, the form and the orchestration. Never expose a JSON schema in the user's conversation.

## Entry points (modelled on Codex)

| Entry point | Behaviour |
|-------------|-----------|
| **New chat** under the sidebar logo | Draft chat with no project → the first send files it under "Other chats" |
| Sidebar **Scheduled** | Opens the task list in the main column (`#/automations`) |
| List **Create → with AI** | Switches to a project-less chat; the composer is pre-filled with **natural-language** guidance (no field schema shown) |
| List **Create → manually** | Right-hand form: title / prompt / project / model / effort / frequency / time / notifications |
| Composer "+" → create automation | Jumps to the Scheduled page |

## Chat creation protocol (silent)

1. The user describes **what to do and when to run it** in natural language.
2. On send, the host prepends a setup prefix to the agent text that is **never shown in the journal** (`wrapAutomationSetupAgentText`).
3. The agent confirms in natural language; once it has everything it appends a single fence at the **end** of the reply:

````text
```pi-automation
{"title":"...","prompt":"...","frequency":"daily|weekly|weekdays|once","time":"HH:MM","weekdays":[],"enabled":true}
```
````

4. On stream `done` the shell runs `extractAutomationPayload`: it **strips the fence** from the bubble, calls `automation_create`, and toasts "Scheduled: {title}".
5. Applied at most once per chat; the fence is stripped on reload too, so the user never sees raw JSON.

Implementation: `src/lib/automationSetup.ts` · intercepted in `App.tsx` `tryApplyAutomationFromSession`.

## Data

- File: `paths::automations_file()` (typically on macOS: `~/Library/Application Support/dev.pi.pi-app/automations.json`)
- Run ledger: `paths::automation_runs_file()` (`automation-runs.jsonl` beside the automation list)
- Browser fallback: `localStorage["pi-app.automations"]`
- Fields: `title` `prompt` `enabled` `projectId` `modelId` `effort` `frequency` `time` `weekdays` `notify` `lastRunAt` `nextRunAt`
- Each desktop run is append-only and records its session, trigger, attempt/retry lineage,
  dispatch state, terminal status, duration, provider error and triage state. The automation
  list keeps the latest summary; the ledger is the historical source.

## Execution

1. A Rust host scheduler checks every 30s for `enabled` tasks whose `nextRunAt` is due.
   It catches up all due rows after launch, even when the webview was closed.
2. It never interrupts a `streaming` or connecting chat; **while busy it does not mark the task fired**, so it can still run once things go idle.
3. On trigger: `session_create` → write session prefs (model/effort) → `session_connect` → `session_send` the prompt.
4. The run is linked to the created session before connect and moves through `started` →
   `dispatched` → `completed` / `failed` / `interrupted` / `cancelled`.
5. **Connect or send failure**: persist the failure in the run ledger and latest automation
   summary; the existing chat error path remains visible.
6. Success: update `lastRunAt` / `nextRunAt`; a `once` task sets `enabled=false` after dispatch.
7. On restart, stale in-flight runs are reconciled as interrupted instead of appearing successful.

When the desktop process is intentionally quit, an unattended host can keep the same
schedule alive with `pi-app automation daemon`. It uses the same app-data directory,
claims each automation through a cross-process lock so it cannot double-fire alongside
the desktop scheduler, and records the resulting session and ledger rows for the next
desktop launch. It is local-only and inherits Pi's configured authentication; it does
not expose a network listener.

This coexists with Build's `/loop` and `scheduler_*`: the user can also ask the agent to schedule things directly inside a chat. The shell's list is an independent source of truth.

## UI rules

- **Welcome state**: only for a draft chat with no `sessionId`.
- **Has a `sessionId` but no messages**: show "No messages in this chat yet…", not the large new-chat splash.
- **Delete / destructive actions**: `window.confirm` is forbidden; use in-app dialogs (see [dialogs.md](./dialogs.md)). The `AutomationsPage` delete confirmation is the reference implementation.

## Tauri commands

- `automations_list`
- `automation_create` / `automation_update`
- `automation_set_enabled`
- `automation_mark_run`
- `automation_run_start` / `automation_run_finish`
- `automation_runs_list` / `automation_run_triage`
- `automation_delete`

## Acceptance

- [x] Sidebar new-chat does not depend on the current project; the chat appears under "Other chats"
- [x] Scheduled list / filter / search / enable-disable / delete
- [x] Manual form create and edit
- [x] AI create entry point: natural-language seed, no JSON schema exposed
- [x] Assistant fence triggers `automation_create` automatically; the config block never renders in the bubble
- [x] Due tasks fire from the Rust host scheduler, catch up after launch, and process all due rows
- [x] Append-only run lifecycle with session association, duration, failure recovery and durable triage
- [x] A failed connect leaves no empty session behind; an existing empty chat is not disguised as the new-chat page
- [x] Background triggering when the entire desktop process is not running via the optional `pi-app automation daemon` process
- [ ] Two-way sync with the CLI scheduler (optional P2)
