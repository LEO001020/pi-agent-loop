# First-run setup gate

Product rules for the **full-screen initialization wizard** before the workbench home.

## Goals

1. **Hard gate:** Pi CLI must be found and runnable before entering home.
2. **Soft gate:** Official login / API key / custom relay may be **skipped**.
3. Match app chrome (tokens, logo, dark/light); **no scrollbars** on the gate page.
4. Install uses **multi-mirror** download with retries (same bases as official `install.sh`).

## Flow

```
boot → probe CLI
  ├─ no CLI → SetupWizard step Runtime (install required)
  ├─ CLI ok + !setupWizardCompleted → Account step (skippable)
  └─ CLI ok + setupWizardCompleted → home
```

### Step 1 — Runtime (cannot skip)

| Action | Host |
|--------|------|
| Detect | `probe_cli` — mac + Windows (see below) |
| Auto install | `cli_install_latest` + event `setup://cli-install-progress` |
| Manual path | `pick_cli_binary` → `manualCliPath` |
| Fallback | Copy official install command / open docs |

Mirrors (order):

1. `https://storage.googleapis.com/grok-build-public-artifacts/cli` (preferred — more reliable in CN)
2. `https://x.ai/cli`

Each mirror is tried multiple times before failing over.

### Step 2 — Account (skippable)

OAuth, official key, relay, import CLI / pi-go. No `window.prompt`.

### Step 3 — Ready → Enter

Collects a local display name, then persists `setupWizardCompleted: true`.
If account setup was skipped: `authSetupDeferred: true`.

## Settings fields

| Field | Role |
|-------|------|
| `setupWizardCompleted` | Wizard finished with CLI ready |
| `authSetupDeferred` | User skipped account step |
| `userName` | Local display name shown in the sidebar and Usage profile |
| `onboardingDone` / `setupSkipped` | Legacy; migrated when CLI present |

## UI

- Component: `src/components/SetupWizard.tsx`
- Styles: `src/styles/setup-wizard.css` (overflow hidden, no scrollbars)
- i18n: `setup.*` keys in `src/i18n/messages.ts`

## CLI probe (mac + Windows)

`cli_probe::probe_cli` must work when the app is launched from Dock / Explorer (sparse PATH):

| Source | macOS | Windows |
|--------|-------|---------|
| Official install | `~/.pi/bin/pi` (+ downloads) | `%USERPROFILE%\.pi\bin\pi.exe` (+ downloads) |
| Package managers | Homebrew `/opt/homebrew`, `/usr/local` | WinGet Links, Scoop shims, Chocolatey |
| PATH | process PATH + enriched PATH scan | same; names `pi.exe` / `.cmd` / `.bat` |
| Manual | `~` expansion | `~` / `%USERPROFILE%` / auto-append `.exe` |
| Home dir | `$HOME` | **`USERPROFILE` first** (not MSYS `$HOME`) |

`--version` is preferred; a runnable binary without version still counts as found.

## Commands

| Command | Role |
|---------|------|
| `probe_cli` | Detect binary (cross-platform) |
| `cli_install_latest` | Download + link into `~/.pi` |
| `cli_install_commands` | Platform shell command + docs URL |
| `pick_cli_binary` | File picker |
| `open_external_url` | Open install docs |

## Non-goals

- Embedding the CLI binary in the app package (B04).
- Silent download without multi-mirror retry.
- Forcing project selection before home.
