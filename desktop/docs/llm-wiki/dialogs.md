# In-app dialogs (no window.confirm / prompt)

**Mandatory**: under the Tauri WebView, **`window.confirm` / `window.prompt` / `window.alert` are unreliable** — often no dialog appears, the result is always false, or the call blocks strangely.
Confirmations, text input and destructive actions **must** use in-app dialogs. Do not reintroduce native browser dialogs.

## Visuals: reuse the panel styles that already exist

Frosted glass and translucency are **not** required. A new overlay should **reuse an existing in-app panel style** and stay consistent with the controls next to it:

| Case | Preferred style | Reference |
|------|-----------------|-----------|
| Composer chip menus (model / permission / project) | `.cmm__pop` + `.cmm__opt` / `.cmm__section` | `ComposerModelMenu`, `ComposerProjectMenu` |
| Context menu / row actions / location menu | Solid `.menu-panel` + context tokens (`--menu-context-*`) | `ContextMenu`, `OpenLocationButton` |
| Confirm / input / feature dialogs | `.modal` · `GlassModal` · `setAppDialog` | `App.tsx`, `GlassModal` |
| Search / sidebar forms / slash | The existing `.search-panel` / `.auto-panel` / `.slash-palette` | Corresponding components |

Layout tokens (radius, padding, item spacing) can still come from `--menu-*` / `--modal-*`. For material, follow **whatever that area already does** — do not start a second system in the name of "unified frosted glass".

**Optional**: `.glass-surface` / `--glass-*` still exist on some modals and older overlays. New code is not required to adopt them, and rules like "overlays must never be opaque" should **not** be reintroduced.

## Shared shell: `GlassModal`

Feature dialogs can use the shared shell. The name is historical and does not imply the frosted look is mandatory:

```tsx
import { GlassModal } from "@/components/GlassModal";

<GlassModal
  open={open}
  onClose={onClose}
  title={tr("…")}
  size="sm" | "md" | "lg"   // 420 / 480 / 560
  closeLabel={tr("common.close")}
  footer={
    <>
      <button type="button" className="btn btn--ghost" onClick={onClose}>
        {tr("common.cancel")}
      </button>
      <button type="button" className="btn btn--solid" onClick={onSave}>
        {tr("common.save")}
      </button>
    </>
  }
>
  {/* dialog content */}
</GlassModal>
```

Structure: `.overlay` → `.modal.glass-modal[--sm|--md|--lg]` → `header.modal-head` + body + `.modal-actions`.

Existing code may use the same DOM/CSS directly; migrating components immediately is not required:

```html
<div class="overlay">
  <div class="modal app-dialog" role="dialog">…</div>
</div>
```

## Preferred: the app-level `appDialog` (`src/App.tsx`)

Main workbench flows (renaming a project or chat, the YOLO double-confirm, and similar) use:

```ts
setAppDialog({
  kind: "confirm",
  title: tr("…"),
  message: tr("…", { name }),
  confirmLabel: tr("…"), // optional
  danger: true,          // optional → destructive button style
  onConfirm: () => { void doSomething(); },
});

// or for input
setAppDialog({
  kind: "prompt",
  title: tr("…"),
  initial: current,
  placeholder: tr("…"),
  onSubmit: (value) => { void rename(value); },
});
```

- Rendering: `createPortal` → `.app-dialog-overlay` + `.modal.app-dialog`.
- Copy: always through `src/i18n/` (see [i18n.md](./i18n.md)).
- **Never** nest a `window.confirm` inside `onConfirm` / `onSubmit`.

## Sub-pages and standalone panels

When a component cannot reach `setAppDialog` (for example `AutomationsPage`):

1. **Preferred**: bubble the confirmation up to `App` through a prop callback (`onRequestConfirm`) and let `appDialog` handle it centrally.
2. **Acceptable**: build the confirmation inside the component using the same DOM/CSS (`createPortal` + `overlay` / `modal app-dialog`), or `GlassModal`.
3. Reference: the `AutomationsPage` delete confirmation (which avoids `window.confirm`).

## Overlay inventory (do not miss one when restyling)

| Type | Selector / component |
|------|----------------------|
| App confirm/input | `.modal.app-dialog` · `setAppDialog` |
| Compact keep-note / Doctor / Status | `setAppDialog` prompt · `.modal` · `GlassModal` · `DoctorModal` |
| File details | `.modal.file-path-details` |
| Search panel | `.search-panel` |
| Model / permission / project / user / slash / + | `.cmm__pop` · `.menu-panel` · `.slash-palette` · `.composer-plus` |
| Context / attachments / open location / Select | `.ctx-menu` · `.att-menu` · `.open-loc-menu` · `.c-select__menu` |
| Automation form sidebar / row menu | `.auto-panel` · `.auto-row__menu` |
| Toast / permission bar / drop card | `.app-toast` · `.perm-bar` · `.drop-overlay__card` |
| Left column | `.sidebar` |

## Forbidden

| API / pattern | Status |
|---------------|--------|
| `window.confirm(...)` | **Forbidden** |
| `window.prompt(...)` | **Forbidden** |
| `window.alert(...)` | **Forbidden** — use a toast, an error banner or an in-app dialog |
| Global `confirm` / `prompt` aliases | **Forbidden** |

Fix any surviving call as soon as you find one (search for `window.confirm`, `window.prompt`).

## Acceptance

- [ ] Every new delete / trust / destructive-toggle path has an in-app confirmation, and no `window.confirm`.
- [ ] All dialog copy goes through i18n keys — no hard-coded strings.
- [ ] On a real Tauri build: confirm executes, cancel and overlay-click close it, and nothing "does nothing".
- [ ] Destructive actions (deleting a task, YOLO, removing a project) use the `danger` style and spell out the consequence.
- [ ] New overlays look like the existing panels in the same area (`.cmm__pop` / `.menu-panel` / `.modal`) rather than inventing another translucency spec.

## Related source

- `src/components/GlassModal.tsx` — shared dialog shell
- `src/App.tsx` — the `AppDialog` type, `setAppDialog`, portal rendering
- `src/styles/tokens.css` — `--menu-*` / `--modal-*` / optional `--glass-*`
- `src/styles/app.css` — modal / menu / cmm layout
- `src/components/ComposerModelMenu.tsx` / `ComposerProjectMenu.tsx` — composer chip menu examples
- `src/components/StatusModal.tsx` — GlassModal example
- `src/components/ExtensionsPanel.tsx` — package/MCP management surface used from Settings → Packages
- `src/components/AutomationsPage.tsx` — sub-page with its own delete confirmation
- `src/i18n/messages.ts` — `common.cancel` / `common.confirm` / `common.close`, etc.
