#!/usr/bin/env bash
# Create an annotated release tag after syncing version across manifests.
# Usage:
#   ./scripts/release-tag.sh 0.1.1
#   ./scripts/release-tag.sh 0.1.1 --push
#
# Does NOT push by default. CI (.github/workflows/release.yml) runs on tag push v*.
#
# Release notes (GitHub Release body) are generated from CHANGELOG.md by CI:
#   scripts/changelog-for-release.py → releaseBody for tauri-action
# Before tagging, ensure CHANGELOG has a section:
#   ## [X.Y.Z] - YYYY-MM-DD
# with notes under Added/Fixed/Changed as needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-}"
PUSH="${2:-}"

if [[ -z "$VERSION" ]]; then
  echo "usage: $0 <semver> [--push]" >&2
  echo "example: $0 0.1.1 --push" >&2
  exit 1
fi

# strip leading v if provided
VERSION="${VERSION#v}"
TAG="v${VERSION}"

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-].*)?$ ]]; then
  echo "error: invalid semver: $VERSION" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree not clean. Commit or stash first." >&2
  git status -sb
  exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "error: tag already exists: $TAG" >&2
  exit 1
fi

# Fail early if CHANGELOG section is missing (CI would fail the same way).
if ! python3 scripts/changelog-for-release.py "$VERSION" >/dev/null; then
  echo "error: add bilingual release notes under ## [$VERSION] in CHANGELOG.md first." >&2
  exit 1
fi
echo "==> CHANGELOG section for $VERSION OK (will become GitHub Release body)"

echo "==> Bumping version to $VERSION"
export VER="$VERSION"

python3 - <<'PY'
import json, os, re
from pathlib import Path

ver = os.environ["VER"]

# package.json
p = Path("package.json")
data = json.loads(p.read_text())
data["version"] = ver
p.write_text(json.dumps(data, indent=2) + "\n")
print("package.json ->", ver)

# tauri.conf.json
p = Path("src-tauri/tauri.conf.json")
data = json.loads(p.read_text())
data["version"] = ver
p.write_text(json.dumps(data, indent=2) + "\n")
print("tauri.conf.json ->", ver)

# Cargo.toml [package] version only (first match)
p = Path("src-tauri/Cargo.toml")
text = p.read_text()
text2, n = re.subn(r'(?m)^version\s*=\s*"[^"]+"', f'version = "{ver}"', text, count=1)
if n != 1:
    raise SystemExit("failed to patch Cargo.toml version")
p.write_text(text2)
print("Cargo.toml ->", ver)

# Cargo.lock root package only
p = Path("src-tauri/Cargo.lock")
text = p.read_text()
pattern = r'(?ms)(^\[\[package\]\]\nname = "pi-app"\nversion = ")[^"]+(")'
text2, n = re.subn(pattern, rf"\g<1>{ver}\g<2>", text, count=1)
if n != 1:
    raise SystemExit("failed to patch pi-app version in Cargo.lock")
p.write_text(text2)
print("Cargo.lock pi-app ->", ver)

# i18n version footer
for rel in ("src/i18n/messages.ts",):
    p = Path(rel)
    if not p.is_file():
        continue
    t = p.read_text()
    t2, n = re.subn(r"(Pi v)[0-9]+\.[0-9]+\.[0-9]+", rf"\g<1>{ver}", t)
    if n == 0:
        t2, n = re.subn(r"(Pi v)[0-9]+\.[0-9]+\.[0-9]+", rf"Pi v{ver}", t)
    if n:
        p.write_text(t2)
        print(f"{rel} versionFooter ->", ver)
    else:
        print(f"warn: versionFooter pattern not found in {rel}")
PY

git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock src/i18n/messages.ts
if [[ -n "$(git status --porcelain)" ]]; then
  git commit -m "chore: release $TAG"
fi

git tag -a "$TAG" -m "Release $TAG"
echo "Created tag $TAG"

if [[ "$PUSH" == "--push" ]]; then
  git push origin HEAD
  git push origin "$TAG"
  echo "Pushed $TAG — GitHub Actions release workflow should start."
else
  echo "Tag is local only. Push when ready:"
  echo "  git push origin HEAD && git push origin $TAG"
fi
