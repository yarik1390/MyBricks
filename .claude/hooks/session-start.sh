#!/bin/bash
# SessionStart hook — installs the rtk CLI (https://github.com/rtk-ai/rtk) in
# Claude Code on the web sessions so agents can compact verbose command output
# (see "Token-efficient command output (rtk)" in CLAUDE.md).
# Added at the repo owner's explicit request (2026-07-09).
#
# rtk is an optimization, never a requirement: every failure path here exits 0
# so a broken install can never block the session.
set -uo pipefail

# Only run in remote (Claude Code on the web) sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

BIN_DIR="$HOME/.local/bin"

# Make sure ~/.local/bin is on PATH for the session either way.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi

# Idempotent: skip if already installed (container state is cached after the
# first successful run, so the 3-minute build normally happens once).
if command -v rtk >/dev/null 2>&1 || [ -x "$BIN_DIR/rtk" ]; then
  echo "rtk already installed: $("$BIN_DIR/rtk" --version 2>/dev/null || rtk --version)"
  exit 0
fi

# Building from source needs cargo (GitHub release downloads are blocked by
# the remote-session egress policy, so a binary download is not an option).
if ! command -v cargo >/dev/null 2>&1; then
  echo "rtk install skipped: cargo not available"
  exit 0
fi

SRC_DIR="$(mktemp -d)"
trap 'rm -rf "$SRC_DIR"' EXIT

echo "Installing rtk (build from source, ~3 min on first run)..."
if git clone --quiet --depth 1 https://github.com/rtk-ai/rtk "$SRC_DIR" \
  && cargo build --release --locked --quiet --manifest-path "$SRC_DIR/Cargo.toml" \
  && mkdir -p "$BIN_DIR" \
  && cp "$SRC_DIR/target/release/rtk" "$BIN_DIR/rtk"; then
  echo "rtk installed: $("$BIN_DIR/rtk" --version)"
else
  echo "rtk install failed (non-fatal); agents fall back to plain commands"
fi

exit 0
