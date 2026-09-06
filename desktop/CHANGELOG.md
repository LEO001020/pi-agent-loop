# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-08-03

### Added

- **Multi-model workspace** - addressed sessions, model roles, fallback routing, usage attribution, comparisons, adoption and isolated worktree runs.
- **Daily-driver controls** - running-task dock, activity center, cross-session search, command palette, recovery markers and pre-send cost/context feedback.
- **Remote and external control** - full SSH workspace bridge, local authenticated MCP control and an optional headless automation daemon.

### Security

- External MCP remains loopback-only, token-authenticated, trusted-project scoped and revocable.
- Session stop, rewind and send operations verify their target session to prevent focus races.

### Changed

- Settings label inventory and session orchestration are kept in test-backed modules without changing the existing UI language or layout.

## [0.2.12] - 2026-07-30

### Added

- **Review a pull request** - `/review-pr` takes a PR number or URL, fetches the diff through the GitHub CLI and opens a chat already seeded with a review prompt.
- **Open a pull request after pushing** - Commit & Push gains an opt-in checkbox that creates the PR and shows its link, with the title and body taken from the commit message.
- **Tool allow/deny lists** - `toolsAllow` / `toolsDeny` settings map onto Pi's own `--tools` / `--exclude-tools`, so tool gating uses the CLI primitive instead of a parallel mechanism.

### Changed

- **English only** - the tray, the Windows installer and the native dialogs no longer carry a second language the app never actually offered.
- **Agent documentation in English** - the four internal wiki pages are translated, and the model/permission page now matches the CLI the app really spawns.

### Fixed

- **Automation composer** - the scheduling hint appeared in Chinese inside an otherwise English interface.
- **macOS builds** - the custom re-sign step was repairing a signature problem current Tauri no longer produces, and its own failures were the only thing breaking macOS in 0.2.9 and 0.2.10. The DMG is now published exactly as Tauri bundles it, and the first-launch command appears in these release notes, before download, instead of inside the disk image.

## [0.2.10] - 2026-07-30

### Fixed

- **Windows build** - restore a platform-conditional binding that an automated lint pass removed, which broke compilation on Windows in 0.2.9.
- **macOS install steps** - right-click → Open no longer bypasses Gatekeeper on macOS 15 Sequoia or macOS 26 Tahoe. The README and the DMG instructions now use quarantine-flag removal, which still works, and mention building from source as the command-free alternative.

## [0.2.9] - 2026-07-30

### Fixed

- **macOS auto-update** - publish the signed updater archive for Mac so in-app updates install correctly; previous releases offered updates on Linux and Windows only.
- **Attachment filenames** - drop a dead branch in the paste/drop filename sanitizer that made both outcomes identical.
- **Store lock** - declare truncate behaviour explicitly when opening the shared lock file.

### Changed

- **Agent runtime naming** - the agent home, spawn environment variables and internal identifiers now consistently use Pi naming. In shared session mode the agent home resolves to `~/.pi`; independent mode is unaffected.
- **Smaller codebase** - remove modules, components and helpers that were never reachable from the running app, along with their tests.

## [0.2.8] - 2026-07-30

### Fixed

- **macOS first launch** - replace the Gatekeeper-blocked command installer with a standard drag-to-Applications DMG and Apple's supported right-click Open flow.
- **DMG verification** - validate the visible app bundle, Applications shortcut and code signature before publishing macOS downloads.

## [0.2.7] - 2026-07-30

### Fixed

- **Full access legacy permissions** - automatically approve permission prompts emitted through Pi's older extension UI path, while keeping genuine agent questions and extension dialogs interactive.
- **Deny policy legacy permissions** - automatically reject the same legacy prompts without leaving the agent blocked behind a modal.

## [0.2.6] - 2026-07-30

> **Highlight:** remote Pi runtimes, private local dictation and clearer usage history.

### Added

- **Remote Pi over SSH** - connect through the system OpenSSH client with host-key verification, ssh-agent support and an optional identity file.
- **Direct RPC** - connect to authenticated managed Pi gateways over TLS-secured WebSockets.
- **Local dictation** - transcribe prompts on-device with Parakeet or Whisper without reading assistant responses aloud.
- **Annual usage view** - inspect estimated token activity across a full-year contribution-style timeline.
- **Remote setup** - configure and verify SSH or Direct RPC during onboarding or from Settings.

### Changed

- **Thinking orbs** - clearer visual states for active reasoning and tool execution.
- **Responsive Settings** - improved narrow-window navigation, remote forms and usage layouts.
- **Documentation** - refreshed product screenshots, alpha status and thinking-orb attribution.

### Security

- Direct RPC requires `wss://`, rejects credentials embedded in URLs and keeps bearer tokens exclusively in the operating-system keychain.
- Remote mode disables local files, Git, terminal and checkpoints so local tools cannot silently operate against a remote workspace.
- SSH passwords and private-key contents are never stored by the app.

### Notes

- SSH remains the recommended remote connection for personal servers.
- Direct RPC requires a compatible managed gateway implementing the documented JSONL-over-WebSocket protocol.

## [0.2.5] - 2026-07-29

> **Highlight:** signed in-app updates and natural-language capability discovery.

### Added

- **Signed auto-updater** - download, verify, install and restart from the startup banner or Settings.
- **Provider connections** - guided OAuth and API-key setup with grouped model presentation.
- **Natural-language extensions** - describe a capability and let Pi find a package or propose a focused local extension.
- **Curated packages** - Context7, Plannotator, Simplify and local voice dictation.

### Security

- Updater archives are signed in GitHub Actions; the app bundles only the public verification key.
- Package installation remains approval-first and reports source, version, access and provider costs.

### Notes

- Updating from 0.2.4 to 0.2.5 still requires the existing manual installer. In-app installation applies from 0.2.5 onward.

## [0.2.4] - 2026-07-29

> **Highlight:** macOS downloads now have one safe installation path.

### Fixed

- **DMG installation flow** - hide the non-notarized app payload and expose a single `Install Pi.command` entry point.
- **Gatekeeper handling** - the installer removes Safari quarantine, applies and verifies the local signature, then opens Pi.
- **Release rebuilds** - manual GitHub Actions runs now honor the requested existing tag.
- **CI** - refresh stale ACP stream fixtures so Rust tests pass on every platform.
- **Branding cleanup** - remove remaining internal references inherited from the former app shell.

## [0.2.3] - 2026-07-28

> **Highlight:** first-run models onboarding + macOS “Open Pi.command” in the DMG.

### Added

- **Setup wizard → Models step** — detect `pi --list-models`, guide new users to configure providers, recheck or skip.
- **DMG helper** — `Open Pi.command` + README-macOS for Gatekeeper (not notarized builds).

### Fixed

- Clearer macOS install docs (Privacy & Security → Open Anyway).

## [0.2.2] - 2026-07-28

> **Highlight:** macOS DMG opens without “damaged / move to Trash” (fixed ad-hoc codesign).

### Fixed

- **macOS packaging** — re-sign `Pi.app` with a full ad-hoc signature (sealed Resources) and rebuild the DMG in CI.
- README install steps for Gatekeeper / quarantine.

## [0.2.1] - 2026-07-28

> **Highlight:** update links always open **AJSubrizi/Pi-App**.

### Fixed

- **App update open URL** — only Pi-App release pages; prefer direct `Pi_*.dmg` / setup for this OS/arch.
- Startup banner and Settings → About use the same open helper.

## [0.2.0] - 2026-07-28

> **Highlight:** first public **Pi** desktop release — GUI for [Pi](https://pi.dev) over JSONL RPC.

### Added

- **Pi RPC runtime** — local sessions via `pi --mode rpc`.
- **Pi packages center** — install / update / remove packages (npm, git, local path).
- **Workbench panels as tabs** — Changes, Browser, Files.
- **Git Changes panel** — stage/unstage, discard, Commit & Push, numstat badges.
- **Startup update check** — soft banner when a newer GitHub release exists.
- **Pi branding** — product name Pi, dock icon, MIT README.

### Notes

- Unofficial sister project to pi.dev. Requires a working Pi CLI.
- Installers do not auto-install updates — open the release page to download.
