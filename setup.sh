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

# pi agent config files (models, settings, mcp)
PI_AGENT_DIR="$HOME/.pi/agent"
mkdir -p "$PI_AGENT_DIR"
for config_file in models.json settings.json mcp.json; do
  src="$REPO_DIR/pi/$config_file"
  dst="$PI_AGENT_DIR/$config_file"
  if [ -f "$src" ]; then
    if [ -e "$dst" ] && [ ! -L "$dst" ]; then
      echo "Backing up existing $dst to $dst.bak"
      mv "$dst" "$dst.bak"
    fi
    cp "$src" "$dst"
    echo "Copied $dst <- $src"
  fi
done

# pi extensions
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

# pi skills
PI_SKILLS_DIR="$HOME/.pi/agent/skills"
mkdir -p "$PI_SKILLS_DIR"
for skill_dir in "$REPO_DIR/pi/skills"/*/; do
  skill_name="$(basename "$skill_dir")"
  skill_dst="$PI_SKILLS_DIR/$skill_name"
  if [ -d "$skill_dir" ]; then
    if [ -e "$skill_dst" ] && [ ! -L "$skill_dst" ]; then
      echo "Backing up existing $skill_dst to $skill_dst.bak"
      mv "$skill_dst" "$skill_dst.bak"
    fi
    ln -sfn "$skill_dir" "$skill_dst"
    echo "Linked $skill_dst -> $skill_dir"
  fi
done

# Hermes profiles
HERMES_PROFILES_DIR="$HOME/.hermes/profiles"
mkdir -p "$HERMES_PROFILES_DIR"
for profile in developer pm reviewer; do
  profile_src="$REPO_DIR/hermes/profiles/$profile"
  profile_dst="$HERMES_PROFILES_DIR/$profile"
  if [ -d "$profile_src" ]; then
    for file in SOUL.md config.yaml; do
      src="$profile_src/$file"
      dst="$profile_dst/$file"
      if [ -e "$src" ]; then
        if [ -e "$dst" ] && [ ! -L "$dst" ]; then
          echo "Backing up existing $dst to $dst.bak"
          mv "$dst" "$dst.bak"
        fi
        ln -sfn "$src" "$dst"
        echo "Linked $dst -> $src"
      fi
    done
  fi
done

# Hermes skills
HERMES_SKILLS_DIR="$HOME/.hermes/skills"
mkdir -p "$HERMES_SKILLS_DIR"
for skill_dir in "$REPO_DIR/hermes/skills"/*/; do
  skill_name="$(basename "$skill_dir")"
  skill_dst="$HERMES_SKILLS_DIR/$skill_name"
  if [ -d "$skill_dir" ]; then
    if [ -e "$skill_dst" ] && [ ! -L "$skill_dst" ]; then
      echo "Backing up existing $skill_dst to $skill_dst.bak"
      mv "$skill_dst" "$skill_dst.bak"
    fi
    ln -sfn "$skill_dir" "$skill_dst"
    echo "Linked $skill_dst -> $skill_dir"
  fi
done

echo "Done. OpenCode, pi, and hermes configs are installed."
