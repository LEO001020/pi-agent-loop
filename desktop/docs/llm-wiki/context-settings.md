# Context settings

Settings → **Context** edits the two Markdown context files in the active Pi
agent profile:

| File | Pi behavior |
|------|-------------|
| `SYSTEM.md` | Replaces or extends Pi's minimal system prompt |
| `AGENTS.md` | Standing workflow, tool, and convention instructions |

The target directory follows `sessionDataMode` through
`paths::resolve_agent_pi_home`:

- independent: the App-owned agent profile;
- shared: the same `PI_AGENT_HOME` used by Pi CLI sessions.

## Commands

| Command | Role |
|---------|------|
| `agent_context_get` | Read both files and their active profile path |
| `agent_context_set` | Atomically save one allowed file, then soft-respawn Pi |

Only `AGENTS.md` and `SYSTEM.md` are accepted. Content is UTF-8 and capped at
1 MB. Saving reconnects the live agent so the new context applies from the next
turn.

## Independent-profile default

When the App-owned independent profile has no `AGENTS.md`, Pi App creates a
small visible default that preserves Pi's extension-first philosophy. A request
such as “add a capability that…” makes the agent:

1. inspect installed packages and skills, then search `pi.dev/packages`;
2. report the exact pinned source, access and provider cost;
3. wait for approval before installation;
4. build a focused local extension only when no suitable package exists.

Existing or user-edited `AGENTS.md` files are never overwritten. Shared mode
does not modify the user's shared Pi profile.
