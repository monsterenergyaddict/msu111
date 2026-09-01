#!/bin/zsh
# Publishes the generated calendar to a GitHub repository checked out in this folder.
set -euo pipefail
ROOT="${0:A:h}"
SOURCES=(109 110 111 112)
git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "Папка проекта ещё не подключена к GitHub-репозиторию."; exit 1;
}
mkdir -p "$ROOT/site"
for group in "${SOURCES[@]}"; do
  source="$ROOT/exports/msu-${group}.ics"
  [[ -f "$source" ]] || { echo "Не найден файл $source."; exit 1; }
  cp "$source" "$ROOT/site/${group}.ics"
done
[[ -f "$ROOT/state.json" ]] && cp "$ROOT/state.json" "$ROOT/site/last-updated.json"
git -C "$ROOT" add site/109.ics site/110.ics site/111.ics site/112.ics site/last-updated.json
if git -C "$ROOT" diff --cached --quiet -- site/109.ics site/110.ics site/111.ics site/112.ics; then
  echo "GitHub: расписание не изменилось."
  exit 0
fi
git -C "$ROOT" commit -m "Обновить расписание МГУ"
git -C "$ROOT" push origin HEAD
echo "GitHub: schedule.ics опубликован."
