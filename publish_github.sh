#!/bin/zsh
# Publishes the generated calendar to a GitHub repository checked out in this folder.
set -euo pipefail
ROOT="${0:A:h}"
SOURCE="$ROOT/exports/msu-111.ics"
TARGET="$ROOT/site/schedule.ics"

[[ -f "$SOURCE" ]] || { echo "Сначала выполните run.sh: файл exports/msu-111.ics не найден."; exit 1; }
git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "Папка проекта ещё не подключена к GitHub-репозиторию."; exit 1;
}
mkdir -p "$ROOT/site"
cp "$SOURCE" "$TARGET"
git -C "$ROOT" add site/schedule.ics
if git -C "$ROOT" diff --cached --quiet -- site/schedule.ics; then
  echo "GitHub: расписание не изменилось."
  exit 0
fi
git -C "$ROOT" commit -m "Обновить расписание МГУ"
git -C "$ROOT" push origin HEAD
echo "GitHub: schedule.ics опубликован."
