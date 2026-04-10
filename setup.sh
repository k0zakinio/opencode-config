#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"

mkdir -p "$CONFIG_DIR"

for dir in commands agents; do
  if [ -e "$CONFIG_DIR/$dir" ] && [ ! -L "$CONFIG_DIR/$dir" ]; then
    echo "Backing up existing $CONFIG_DIR/$dir to $CONFIG_DIR/$dir.bak"
    mv "$CONFIG_DIR/$dir" "$CONFIG_DIR/$dir.bak"
  fi
  ln -sfn "$REPO_DIR/$dir" "$CONFIG_DIR/$dir"
  echo "Linked $CONFIG_DIR/$dir -> $REPO_DIR/$dir"
done

echo "Done. /review and all reviewer agents are now available in opencode."
