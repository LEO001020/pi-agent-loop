# Contributing to Pi

Thanks for helping improve the desktop GUI for [Pi](https://pi.dev).

## Development

```bash
pnpm install
pnpm dev          # Tauri + Vite
pnpm dev:ui       # frontend only
```

Checks:

```bash
pnpm typecheck
pnpm test
pnpm build:ui
cd src-tauri && cargo test
```

You need a working **Pi CLI** (`pi --mode rpc`) for full sessions. See [README.md](./README.md).

## Workflow

1. Fork and branch from the default branch  
2. Keep changes small and focused  
3. Pass `pnpm typecheck`, `pnpm test`, and `cargo test` in `src-tauri`  
4. User-facing strings go through `src/i18n/messages.ts` (no hard-coded UI copy)  
5. Do not use `window.confirm` / `prompt` / `alert` — use in-app dialogs  
6. Open a PR with motivation, what changed, and how you verified it  

Product rules for agents live under [`docs/llm-wiki/`](./docs/llm-wiki/).

## Guidelines

- Product name: **Pi** (desktop shell for the Pi agent)
- App data root: `PI_APP_HOME` or platform default `dev.pi/pi-app` (see README)
- Do not commit `node_modules`, `target`, `dist`, tokens, `secrets.json`, or `auth.json`
- Security issues: [SECURITY.md](./SECURITY.md)

## Releases

See **[docs/llm-wiki/release.md](./docs/llm-wiki/release.md)** when present. In short: add `## [X.Y.Z]` to `CHANGELOG.md`, then tag with the release script.
