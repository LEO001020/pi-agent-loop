# Agent notes — pi-app

Desktop GUI for **Pi** (`pi --mode rpc`). Package name: **`pi-app`**. Product name in UI: **Pi**.

## Read first

1. **`docs/llm-wiki/`** — product rules for agents  
   - [i18n.md](docs/llm-wiki/i18n.md) — all UI strings via `src/i18n/`  
   - [dialogs.md](docs/llm-wiki/dialogs.md) — **no** `window.confirm` / `prompt` / `alert`  
   - [catalog.md](docs/llm-wiki/catalog.md) — models / effort / permissions  
   - [setup.md](docs/llm-wiki/setup.md) — first-run (CLI required)  
   - [context-settings.md](docs/llm-wiki/context-settings.md) — active Pi context files
   - [icons.md](docs/llm-wiki/icons.md) — dock icons vs tray icons (never mix)  
   - [release.md](docs/llm-wiki/release.md) — ship steps when present  

2. **Public docs:** `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`. Do not commit secrets, `auth.json`, or local agent homes.

3. Do **not** hardcode user-facing copy. Use `createT(locale)` / `t()`.

4. Prefer real **Pi CLI** behavior over mocks in production paths.

5. Assistant messages: markdown (`MarkdownBody`); user messages: bubble, no role labels.
