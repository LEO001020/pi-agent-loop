# Build

## Dev

```bash
pnpm install
pnpm dev
```

## Checks

```bash
pnpm typecheck && pnpm test
cd src-tauri && cargo test
```

## Release installers

```bash
./scripts/release-tag.sh X.Y.Z --push
```

CI (`.github/workflows/release.yml`) builds macOS / Windows / Linux on tag `v*`.

See [docs/llm-wiki/release.md](./llm-wiki/release.md).
