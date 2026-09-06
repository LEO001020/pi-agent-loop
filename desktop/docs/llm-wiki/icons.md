# App icons vs tray icons

Two **separate** pipelines — never mix them.

| Surface | Source | Outputs |
|--------|--------|---------|
| Dock / taskbar / `.app` / Windows `.exe` | `src-tauri/icons/icon (1).png` (copied as `icon-source.png`) | squircle-masked `icon-squircle.png` → `icon.png`, `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico` |
| macOS menu bar + Windows system tray | `docs/svg/logo.svg` | `tray-icon.png` (**36×36**, @2x for 18pt bar), `tray-16` / `tray-32`, `tray-source.png` |

## Rules

1. **App / dock** uses the full-color artwork from `icon (1).png` only. Listed in `tauri.conf.json` → `bundle.icon`. `generate-icons.sh` bakes a macOS squircle mask (transparent corners) so the Dock mark matches other apps even for debug binaries.
2. **Tray / status bar** uses monochrome template PNGs from `logo.svg` only. Embedded in `src-tauri/src/tray.rs` via `include_bytes!`. On macOS, `icon_as_template(true)`.
3. Do not point the tray at `icon.png` or the dock at `tray-*.png`.
4. Menu-bar icons must stay **padded** (~14% margin) and **retina-sized** (36px for 18pt display). Tiny unpadded rasters look like a blob on Retina.

## Close vs Quit

- Window close (traffic light / self-drawn close / `window.close`) → **hide to tray** (`CloseRequested` + `prevent_close` + `tray::hide_to_tray`):
  - **macOS**: Dock icon hidden (`set_dock_visibility(false)` + `ActivationPolicy::Accessory`).
  - **Windows**: taskbar button removed (`set_skip_taskbar(true)`).
  - Status bar / system tray icon stays.
- Reopen via tray **Open Pi** / menu actions → restore Dock/taskbar + show window (`show_main_window`).
- **Quit Pi** in the tray menu (or app quit) fully exits.
- macOS Dock click when windows are hidden may still fire `RunEvent::Reopen` if Dock is restored; primary reopen path is the tray.

## Window chrome by platform

| Platform | Config file | Title bar |
|----------|-------------|-----------|
| macOS | `tauri.macos.conf.json` | `decorations` + `titleBarStyle: Overlay` + native traffic lights |
| Windows | `tauri.windows.conf.json` | `decorations: false` + self-drawn min/max/close (`WindowControls`) |

Do **not** rely on Overlay / traffic lights on Windows — they are mac-only.

## Regenerate

```bash
./scripts/generate-icons.sh
```

## Tray menu (Codex / ChatGPT style)

Built in `src-tauri/src/tray.rs`:

- **Recent** — up to 8 non-archived sessions (`title · project`)
- **More** — Settings… / Doctor / Account
- **Usage** — disabled status from `account_billing_cache.json`
- **New Chat** / **Open Pi** / **Quit Pi**

Frontend listens for `tray://new-chat`, `tray://open-session`, `tray://open-settings`, `tray://open-doctor` and calls `tray_refresh` after sessions / account updates.
