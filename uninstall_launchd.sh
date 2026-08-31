#!/bin/zsh
# Removes only the daily background task. The project folder and calendars stay untouched.
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/ru.msu.philos.schedule.plist"
if [[ -f "$PLIST" ]]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  /bin/rm "$PLIST"
  echo "Ежедневный запуск удалён."
else
  echo "Ежедневный запуск не был установлен."
fi
