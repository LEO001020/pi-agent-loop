#!/usr/bin/env bash
# Local release-style builds for supported desktop targets.
#
# Usage:
#   ./scripts/build-local.sh              # host default
#   ./scripts/build-local.sh mac-arm
#   ./scripts/build-local.sh mac-intel
#   ./scripts/build-local.sh win          # native on Windows; cargo-xwin on macOS/Linux
#   ./scripts/build-local.sh linux        # native on Linux (AppImage/deb under bundle/)
#   ./scripts/build-local.sh all-mac      # both mac targets (Darwin only)
#   ./scripts/build-local.sh all          # mac-arm + mac-intel + win (Darwin)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET_ALIAS="${1:-host}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: missing command: $1" >&2
    exit 1
  }
}

# Homebrew LLVM (clang-cl) for cargo-xwin RC / C toolchain on Apple Silicon.
prepend_homebrew_llvm() {
  if [[ -d /opt/homebrew/opt/llvm/bin ]]; then
    export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
  elif [[ -d /usr/local/opt/llvm/bin ]]; then
    export PATH="/usr/local/opt/llvm/bin:$PATH"
  fi
}

need_cmd pnpm
need_cmd rustc
need_cmd cargo

OS="$(uname -s)"

# Updater artifacts require a private signing key. Local contributors often
# only need a runnable installer, so disable that final signing step when the
# key is absent. CI/release builds keep the production config and still sign.
tauri_build() {
  local -a config_args=()
  if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
    config_args=(--config '{"bundle":{"createUpdaterArtifacts":false}}')
    echo "Updater signing key not set: building unsigned local artifacts"
  fi
  pnpm exec tauri build "${config_args[@]}" "$@"
}

build_target() {
  local triple="$1"
  echo ""
  echo "======== Building target: $triple ========"
  rustup target add "$triple" >/dev/null 2>&1 || true
  # Frontend is built via beforeBuildCommand in tauri.conf.json
  tauri_build --target "$triple"
  echo "Artifacts under: src-tauri/target/${triple}/release/bundle/"
}

# Windows: on Darwin/Linux use Tauri + cargo-xwin runner (NSIS installer).
# On Windows host, native MSVC toolchain (no runner).
build_windows() {
  local triple="x86_64-pc-windows-msvc"
  echo ""
  echo "======== Building target: $triple ========"
  rustup target add "$triple" >/dev/null 2>&1 || true

  if [[ "$OS" == "Darwin" ]] || [[ "$OS" == "Linux" ]]; then
    prepend_homebrew_llvm
    need_cmd cargo-xwin
    if ! command -v makensis >/dev/null 2>&1; then
      echo "error: makensis not found (NSIS installer)." >&2
      echo "       macOS: brew install makensis" >&2
      echo "       Then re-run: pnpm setup:cross && ./scripts/build-local.sh win" >&2
      exit 1
    fi
    if ! command -v clang-cl >/dev/null 2>&1; then
      echo "warn: clang-cl not on PATH — install brew llvm and ensure PATH includes it" >&2
      echo "      brew install llvm && export PATH=\"\$(brew --prefix llvm)/bin:\$PATH\"" >&2
    fi
    echo "Using runner: cargo-xwin (cross-compile from $OS)"
    # Official Tauri path: https://v2.tauri.app/distribute/windows-installer/
    tauri_build --runner cargo-xwin --target "$triple"
  else
    echo "Using native Windows MSVC toolchain"
    tauri_build --target "$triple"
  fi

  echo "Artifacts under: src-tauri/target/${triple}/release/bundle/"
  local nsis="src-tauri/target/${triple}/release/bundle/nsis"
  if [[ -d "$nsis" ]]; then
    echo "NSIS installers:"
    ls -lah "$nsis" || true
  fi
}

case "$TARGET_ALIAS" in
  host|"")
    echo "======== Building host default ========"
    tauri_build
    echo "Artifacts under: src-tauri/target/release/bundle/"
    ;;
  mac-arm|aarch64-apple-darwin)
    if [[ "$OS" != "Darwin" ]]; then
      echo "error: mac-arm builds require macOS" >&2
      exit 1
    fi
    build_target "aarch64-apple-darwin"
    ;;
  mac-intel|x86_64-apple-darwin)
    if [[ "$OS" != "Darwin" ]]; then
      echo "error: mac-intel builds require macOS" >&2
      exit 1
    fi
    build_target "x86_64-apple-darwin"
    ;;
  win|windows|x86_64-pc-windows-msvc)
    build_windows
    ;;
  linux|x86_64-unknown-linux-gnu)
    if [[ "$OS" != "Linux" ]]; then
      echo "error: linux builds require a Linux host (or CI ubuntu-latest)" >&2
      echo "       deps: libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf" >&2
      exit 1
    fi
    build_target "x86_64-unknown-linux-gnu"
    ;;
  all-mac)
    if [[ "$OS" != "Darwin" ]]; then
      echo "error: all-mac requires macOS" >&2
      exit 1
    fi
    build_target "aarch64-apple-darwin"
    build_target "x86_64-apple-darwin"
    ;;
  all)
    if [[ "$OS" != "Darwin" ]]; then
      echo "error: 'all' (mac + win cross) requires macOS currently" >&2
      exit 1
    fi
    build_target "aarch64-apple-darwin"
    build_target "x86_64-apple-darwin"
    build_windows
    ;;
  *)
    echo "usage: $0 [host|mac-arm|mac-intel|win|linux|all-mac|all]" >&2
    exit 1
    ;;
esac
