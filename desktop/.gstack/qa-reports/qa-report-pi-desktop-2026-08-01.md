# Pi desktop - end-to-end QA report

Date: 2026-08-01
Branch: `main`
Target: macOS Apple Silicon, installed `/Applications/Pi.app`
Scope: build, automated suites, packaging, install, launch smoke test, runtime diagnostics

## Health score

**90/100 - healthy alpha build with external release and test-environment blockers**

The application bundle launches and the distributable mounts correctly. Full click-through of webview controls could not be completed because macOS denied Accessibility control to `osascript`; the limitation is recorded rather than treated as an app failure.

## Checks passed

| Area | Result | Evidence |
| --- | --- | --- |
| TypeScript | PASS | `pnpm typecheck` |
| Frontend tests | PASS | 74 files, 708 tests |
| Rust tests | PASS | 292 passed, 1 ignored |
| Rust formatting | PASS | `cargo fmt --check` |
| UI production build | PASS | Vite production build completed |
| Tauri bundle | PASS | local wrapper generates unsigned bundles when no updater key is present |
| DMG mount | PASS | `/Volumes/Pi/Pi.app`, identifier `dev.pi.desktop`, version `0.2.12` |
| Architecture | PASS | DMG app executable is `arm64` |
| Installed launch | PASS | `/Applications/Pi.app` process remained alive after restart |
| Code signature integrity | PASS | `codesign --verify --deep --strict` valid on disk |
| Product reference scan | PASS | no unrelated product references found in source |

Screenshot evidence: `screenshots/initial.png`.

## Findings

### QA-001 - updater signing key missing (Resolved locally; release secret still required)

`scripts/build-local.sh` now disables updater artifact signing only when
`TAURI_SIGNING_PRIVATE_KEY` is absent, so local builds exit successfully. Release
CI still signs updater artifacts when the repository secret is configured.

### QA-002 - Clippy strict gate fails on existing code (Resolved)

The compact-update result now uses a named type, command/helper signatures carry
targeted lint allowances where Tauri/API compatibility requires them, and PATH
comparisons avoid allocations. Strict Clippy now passes.

### QA-003 - app is ad-hoc signed / not notarized (Medium for downloads)

The bundle passes local `codesign --verify`, but macOS logs identify it as ad-hoc signed and the build skips notarization because Apple credentials are absent. This is expected for the alpha workflow, but external users may see Gatekeeper warnings.

### QA-004 - model round-trip blocked by provider entitlement in this environment (External)

The installed Pi CLI reports `AccessDenied.Unpurchased` for the configured model.
The host and frontend now classify `unpurchased` / model-entitlement errors as
authentication guidance instead of exposing a raw provider wall. A real response
still requires a model enabled for the test account.

### QA-005 - UI click-through requires Accessibility permission (Test limitation)

The app window renders correctly, but macOS returned `-25211` when `osascript` attempted to click webview controls. Settings, Skills, Packages and composer interactions therefore remain covered by automated tests and visual smoke capture, not by automated pointer clicks in this run.

### QA-006 - large frontend chunks (Improved)

Viewer dependencies are now split into cacheable lazy chunks: PDF (463 kB),
document (174 kB), spreadsheet (333 kB), terminal (334 kB) and Markdown (300 kB).
The main launch chunk dropped from about 1.09 MB to 919 kB. Vite still reports the
main chunk above its advisory 500 kB threshold; no runtime behavior is affected.

### QA-007 - Full access still shows a red warning (Resolved behavior; intentional visual warning)

Full access is intentionally styled as a danger mode. The actual permission path
now prefers persistent Pi options (`allow_always`, `allow_command_always` and
`always_allow_all_sessions`) and clears an already-visible prompt with the same
policy, preventing repeat prompts. Regression tests cover focused/background
sessions and legacy Pi extension UI payloads.

## Runtime observations

- Pi opens with the expected landscape background and an existing workspace/session.
- The process survives restart and remains resident.
- macOS logs contain WebKit/AppKit sandbox and App Intents noise typical of an ad-hoc desktop build; no Pi panic or process crash was observed.

## Recommended next checks

1. Configure `TAURI_SIGNING_PRIVATE_KEY` and notarization credentials in CI, then rerun the release build.
2. Grant Accessibility permission to the test runner and repeat pointer-level checks for Settings, Skills, Packages, composer, terminal, onboarding and updater flows.
3. Repeat the model send/receive test with a provider/model enabled for the test account.
4. Reduce the remaining launch chunk before beta distribution if startup telemetry shows it is material.
