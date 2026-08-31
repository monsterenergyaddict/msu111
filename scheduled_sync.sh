#!/bin/zsh
set -u
ROOT="${0:A:h}"
STATE="$ROOT/.runtime"
mkdir -p "$STATE" "$ROOT/logs"
TODAY="$(/bin/date +%Y-%m-%d)"
SLOT="$(/bin/date +%H:%M)"
DAY_FILE="$STATE/day"
MORNING="$STATE/morning-success"
EVENING="$STATE/evening-success-$TODAY"

if [[ "$SLOT" == "08:30" ]]; then
  if [[ ! -f "$DAY_FILE" || "$(<"$DAY_FILE")" != "$TODAY" ]]; then
    print -r -- "$TODAY" >| "$DAY_FILE"
    rm -f "$MORNING" "$STATE/evening-success-"*
  fi
fi

run_sync() {
  if "$ROOT/sync_and_publish.sh"; then
    return 0
  fi
  print -r -- "$(/bin/date '+%Y-%m-%d %H:%M:%S') Слот $SLOT завершился ошибкой; следующий слот попробует снова." >> "$ROOT/logs/launchd.log"
  return 1
}

case "$SLOT" in
  08:30)
    if run_sync; then touch "$MORNING"; fi
    ;;
  14:30)
    [[ -f "$MORNING" ]] || run_sync
    ;;
  21:30)
    if run_sync; then touch "$EVENING"; fi
    ;;
  01:40)
    YESTERDAY="$(/bin/date -v-1d +%Y-%m-%d)"
    [[ -f "$STATE/evening-success-$YESTERDAY" ]] || run_sync
    ;;
esac
