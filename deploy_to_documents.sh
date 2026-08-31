#!/bin/zsh
# Copies the self-contained macOS utility into one folder.
set -euo pipefail

SOURCE_DIR="${0:A:h}"
TARGET_DIR="${1:-$HOME/Documents/Расписание МГУ}"

if [[ "$TARGET_DIR" == "/" || "$TARGET_DIR" == "$HOME" ]]; then
  echo "Укажите отдельную папку для проекта, не домашнюю директорию."
  exit 1
fi

mkdir -p "$TARGET_DIR"
/usr/bin/rsync -a \
  --exclude "__pycache__" \
  --exclude "logs" \
  --exclude "state.json" \
  --exclude "exports" \
  --exclude ".DS_Store" \
  "$SOURCE_DIR/" "$TARGET_DIR/"

"$TARGET_DIR/install.sh"
echo "Проект установлен в: $TARGET_DIR"
echo "Дальше выполните: $TARGET_DIR/run.sh --dry-run"
