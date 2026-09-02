#!/bin/zsh
ROOT="${0:A:h}"
cd "$ROOT" || exit 1

if ./sync_and_publish.sh; then
  /usr/bin/osascript -e 'display notification "Календари успешно обновлены и опубликованы." with title "MSU Schedule"' >/dev/null 2>&1 || true
else
  /usr/bin/osascript -e 'display notification "Не удалось обновить расписание. Проверь VPN и доступ к сайту." with title "MSU Schedule: ошибка"' >/dev/null 2>&1 || true
fi

exit 0
