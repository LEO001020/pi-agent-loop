#!/usr/bin/env bash
# Build a Windows portable zip from a release Windows binary and upload to GitHub Release.
# Usage (CI): bash scripts/package-windows-portable.sh v0.2.0
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TAG="${1:-${TAG:-}}"
if [[ -z "$TAG" ]]; then
  TAG="v$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')"
fi
VER="${TAG#v}"

# Tauri productName is "Pi"; Cargo package may produce pi-app.exe.
find_release_exe() {
  local name
  for name in Pi.exe pi-app.exe Pi.exe pi-app.exe; do
    if [[ -f "src-tauri/target/release/${name}" ]]; then
      echo "src-tauri/target/release/${name}"
      return 0
    fi
  done
  local found
  found="$(find src-tauri/target -type f -name '*.exe' 2>/dev/null \
    | grep -E '/release/[^/]+\.exe$' \
    | grep -v '/bundle/' \
    | head -n 1 || true)"
  if [[ -n "$found" && -f "$found" ]]; then
    echo "$found"
    return 0
  fi
  return 1
}

EXE="$(find_release_exe || true)"
if [[ -z "${EXE:-}" || ! -f "$EXE" ]]; then
  echo "error: Windows release .exe not found under src-tauri/target/release/" >&2
  find src-tauri/target -name '*.exe' 2>/dev/null | head -40 || true
  exit 1
fi
echo "using EXE=$EXE"

STAGE="dist-portable/Pi_${VER}_x64-portable"
rm -rf dist-portable
mkdir -p "$STAGE"
cp "$EXE" "$STAGE/Pi.exe"
python3 - "$VER" "$STAGE" <<'PY'
import sys
from pathlib import Path

ver, stage = sys.argv[1], Path(sys.argv[2])
(stage / "README-portable.txt").write_text(
    f"""Pi portable v{ver}
================
1. Extract this folder anywhere (no installer).
2. Double-click Pi.exe to run.
3. Microsoft Edge WebView2 Runtime is required (usually preinstalled on Win10/11).
4. Real agent sessions need the Pi CLI (`pi`) installed and configured.
5. SmartScreen may warn about an unknown publisher → More info → Run anyway.

Extract anywhere and run Pi.exe. WebView2 required. Pi CLI still needed for agent sessions.
""",
    encoding="utf-8",
)
print("wrote", stage / "README-portable.txt")
PY

OUT="Pi_${VER}_x64-portable.zip"
if command -v zip >/dev/null 2>&1; then
  (cd dist-portable && zip -r "../${OUT}" "Pi_${VER}_x64-portable")
else
  powershell.exe -NoProfile -Command \
    "Compress-Archive -Path 'dist-portable/Pi_${VER}_x64-portable' -DestinationPath '${OUT}' -Force"
fi
ls -lah "$OUT"
if command -v gh >/dev/null 2>&1 && [[ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
  gh release upload "$TAG" "$OUT" --clobber
  echo "uploaded $OUT to $TAG"
else
  echo "skip upload (gh/token missing); artifact at $OUT"
fi
