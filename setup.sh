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

PI_EXT_DIR="$HOME/.pi/agent/extensions"
mkdir -p "$PI_EXT_DIR"
shopt -s nullglob
for ext in "$REPO_DIR/pi/extensions"/*.ts; do
  name="$(basename "$ext")"
  target="$PI_EXT_DIR/$name"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "Backing up existing $target to $target.bak"
    mv "$target" "$target.bak"
  fi
  ln -sfn "$ext" "$target"
  echo "Linked $target -> $ext"
done
shopt -u nullglob

echo "Done. /review, reviewer agents, and pi extensions are installed."
