#!/usr/bin/env bash
# Builds the Rust hprof-server binary and copies it to bin/ for packaging.
# Usage: ./scripts/package-binary.sh [--release]
#
# Called by CI before `vsce package` and usable locally for smoke-testing.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUST_DIR="$REPO_ROOT/hprof-analyzer"
BIN_DIR="$REPO_ROOT/bin"

# In CI, the workflow pre-builds and stages the binary — skip redundant build
if [[ "${CI:-}" == "true" ]] && { [[ -f "$BIN_DIR/hprof-server" ]] || [[ -f "$BIN_DIR/hprof-server.exe" ]]; }; then
    echo "==> CI: Pre-built binary found in bin/, skipping Rust build."
    exit 0
fi

PROFILE="release"
if [[ "${1:-}" == "--debug" ]]; then
    PROFILE="debug"
fi

echo "==> Building hprof-server ($PROFILE)..."
cd "$RUST_DIR"
cargo build --profile "$PROFILE"

BINARY="$RUST_DIR/target/$PROFILE/hprof-server"
if [[ "$(uname -s)" == *MINGW* || "$(uname -s)" == *CYGWIN* ]]; then
    BINARY="$BINARY.exe"
fi

if [[ ! -f "$BINARY" ]]; then
    echo "ERROR: Binary not found at $BINARY"
    exit 1
fi

mkdir -p "$BIN_DIR"
cp "$BINARY" "$BIN_DIR/"
chmod +x "$BIN_DIR/hprof-server" 2>/dev/null || true

SIZE=$(du -h "$BIN_DIR/hprof-server" | cut -f1)
echo "==> Copied to bin/hprof-server ($SIZE)"
echo "==> Done. Ready for 'vsce package'."
