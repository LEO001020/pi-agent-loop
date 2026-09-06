# Releases

## Version files (keep in sync)

| File | Field |
|------|--------|
| `package.json` | `version` |
| `src-tauri/tauri.conf.json` | `version` |
| `src-tauri/Cargo.toml` | `[package].version` |
| `src-tauri/Cargo.lock` | `pi-app` package version |
| `src/i18n/messages.ts` | `app.versionFooter` (`Pi vX.Y.Z`) |

## Steps

1. Add `## [X.Y.Z] - YYYY-MM-DD` to `CHANGELOG.md`
2. `pnpm typecheck && pnpm test` (and `cargo test` in `src-tauri` when possible)
3. `./scripts/release-tag.sh X.Y.Z --push`
4. GitHub Actions builds installers and attaches them to the Release

Update checks read: `https://api.github.com/repos/AJSubrizi/Pi-App/releases/latest`

## Signed app updater

The desktop app checks GitHub softly after launch and can download, verify,
install and restart from either the update banner or Settings → About.

- Tauri reads `latest.json` from the latest GitHub Release.
- Every updater archive must be signed by `TAURI_SIGNING_PRIVATE_KEY`.
- Only the public verification key is bundled in `tauri.conf.json`.
- The private key lives only in GitHub Actions secrets. Never commit or print it.
- Keep `includeUpdaterJson: true` and `createUpdaterArtifacts: true`; otherwise
  releases remain manually downloadable but cannot be installed in-app.
