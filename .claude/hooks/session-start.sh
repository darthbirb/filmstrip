#!/bin/bash
# Readies a Claude Code cloud session (Linux) to run every gate. DEVELOPMENT.md "Cloud sessions".
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Tauri's Linux libraries, so the Rust side compiles and its tests run.
if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends \
    build-essential pkg-config libssl-dev libxdo-dev librsvg2-dev \
    libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev >/dev/null
fi

npx --yes pnpm@12.4.1 install --frozen-lockfile

# The preinstalled Chromium, since the image's Playwright build may not match the pinned one.
if [ -x /opt/pw-browsers/chromium ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export CHROMIUM_PATH=/opt/pw-browsers/chromium' >> "$CLAUDE_ENV_FILE"
fi

# Compiled now, the container snapshot keeps it and the first cargo test starts warm.
cargo test --manifest-path src-tauri/Cargo.toml --locked --no-run --quiet
