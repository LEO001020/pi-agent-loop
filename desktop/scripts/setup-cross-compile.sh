#!/usr/bin/env bash
# Install toolchains for Pi desktop builds (macOS ARM / Intel + Windows x64).
# On macOS/Linux, Windows installers use cargo-xwin + NSIS (Tauri official path).
# Run once on each developer machine (or after rustup update):
#   pnpm setup:cross
#   ./scripts/setup-cross-compile.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OS="$(uname -s)"

if ! command -v rustup >/dev/null 2>&1; then
  echo "error: rustup not found. Install from https://rustup.rs" >&2
  exit 1
fi

echo "==> Ensuring stable toolchain"
rustup toolchain install stable
rustup default stable

HOST="$(rustc -vV | sed -n 's/^host: //p')"
echo "Host triple: $HOST"

TARGETS=(
  "aarch64-apple-darwin"   # macOS Apple Silicon
  "x86_64-apple-darwin"    # macOS Intel
  "x86_64-pc-windows-msvc" # Windows x64
)

for t in "${TARGETS[@]}"; do
  echo "==> rustup target add $t"
  rustup target add "$t" || {
    echo "warn: failed to add $t (ok if unsupported on this host)" >&2
  }
done

if [[ "$OS" == "Darwin" ]]; then
  echo "==> macOS: Xcode CLT check"
  xcode-select -p >/dev/null 2>&1 || {
    echo "warn: Xcode Command Line Tools missing — run: xcode-select --install" >&2
  }

  # Homebrew LLVM provides clang-cl (needed by cargo-xwin / Windows RC).
  if [[ -d /opt/homebrew/opt/llvm/bin ]]; then
    export PATH="/opt/homebrew/opt/llvm/bin:$PATH"
    echo "==> Found Homebrew LLVM: /opt/homebrew/opt/llvm"
  elif [[ -d /usr/local/opt/llvm/bin ]]; then
    export PATH="/usr/local/opt/llvm/bin:$PATH"
    echo "==> Found Homebrew LLVM: /usr/local/opt/llvm"
  else
    echo "warn: brew llvm not found. For Windows cross-builds: brew install llvm" >&2
  fi

  if command -v makensis >/dev/null 2>&1; then
    echo "==> Found makensis: $(command -v makensis)"
  else
    echo "warn: makensis not found. For Windows NSIS installer: brew install makensis" >&2
  fi

  if command -v cargo-xwin >/dev/null 2>&1; then
    echo "==> Found cargo-xwin: $(command -v cargo-xwin)"
  else
    echo "==> Installing cargo-xwin (Windows MSVC cross linker wrapper)"
    cargo install --locked cargo-xwin
  fi

  # Warm / verify xwin CRT+SDK cache (shared under ~/.cache/cargo-xwin by default).
  echo "==> Ensuring Windows SDK cache (cargo-xwin / xwin)…"
  # `cargo xwin check` downloads SDK on first run; keep it non-fatal if network flakes.
  if cargo xwin check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc -q 2>/dev/null; then
    echo "    cargo-xwin check OK"
  else
    echo "    (optional) first Windows build will download CRT/SDK into cargo-xwin cache"
  fi
fi

if [[ "$OS" == "Linux" ]]; then
  echo "==> Linux host: for Windows cross-builds install nsis, llvm, and cargo-xwin"
  echo "    See https://v2.tauri.app/distribute/windows-installer/#build-windows-apps-on-linux-and-macos"
  if ! command -v cargo-xwin >/dev/null 2>&1; then
    echo "==> Installing cargo-xwin"
    cargo install --locked cargo-xwin || true
  fi
fi

if [[ "$OS" == "MINGW"* ]] || [[ "$OS" == "MSYS"* ]] || [[ "$OS" == "CYGWIN"* ]] || [[ -n "${WINDIR:-}" && "$(uname -o 2>/dev/null || true)" == "Msys" ]]; then
  echo "==> Windows host detected"
  echo "    Ensure WebView2 + Visual Studio Build Tools (C++/MSVC) are installed."
fi

echo ""
echo "Done. Useful commands:"
echo "  pnpm build:mac-arm      # aarch64-apple-darwin"
echo "  pnpm build:mac-intel   # x86_64-apple-darwin"
echo "  pnpm build:win         # x86_64-pc-windows-msvc (macOS/Linux via cargo-xwin; native on Windows)"
echo "  pnpm build:mac-all     # both mac targets"
echo "  ./scripts/build-local.sh all   # mac-arm + mac-intel + win (Darwin)"
echo "  pnpm build             # host default"
echo ""
echo "Windows cross-build (macOS/Linux) uses:"
echo "  tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc"
echo "Artifacts: src-tauri/target/<triple>/release/bundle/"
