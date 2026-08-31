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
KNOWN_DAY=""
[[ -f "$DAY_FILE" ]] && KNOWN_DAY="$(<"$DAY_FILE")"

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"MSU Schedule\"" >/dev/null 2>&1 || true
}

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
    if run_sync; then touch "$MORNING"; notify "Расписание успешно обновлено (утренняя попытка)."; fi
    ;;
  14:30)
    if [[ -f "$MORNING" ]]; then
      :
    elif run_sync; then
      notify "Расписание успешно обновлено (дневная попытка)."
    fi
    ;;
  21:30)
    if run_sync; then touch "$EVENING"; notify "Расписание успешно обновлено (вечерняя попытка)."; fi
    ;;
  01:40)
    YESTERDAY="$(/bin/date -v-1d +%Y-%m-%d)"
    if [[ -f "$STATE/evening-success-$YESTERDAY" ]]; then
      :
    elif run_sync; then
      notify "Расписание успешно обновлено (ночная попытка)."
    else
      notify "За вчера не удалось обновить расписание. Проверь VPN и доступ к сайту факультета."
    fi
    ;;
  *)
    # RunAtLoad reaches this branch after the Mac was offline during a day.
    if [[ -n "$KNOWN_DAY" && "$KNOWN_DAY" != "$TODAY" ]]; then
      YESTERDAY="$(/bin/date -v-1d +%Y-%m-%d)"
      CATCHUP="$STATE/catchup-$YESTERDAY"
      if [[ ! -f "$CATCHUP" && ! -f "$STATE/evening-success-$YESTERDAY" ]]; then
        touch "$CATCHUP"
        if run_sync; then
          touch "$MORNING"
          notify "Расписание обновлено после пропущенных запусков."
        else
          notify "За пропущенный день не удалось обновить расписание."
        fi
      fi
    fi
    ;;
esac
