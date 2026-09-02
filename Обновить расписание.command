#!/bin/zsh
ROOT="${0:A:h}"
cd "$ROOT" || exit 1

echo "Обновляю расписание всех групп…"
if ./sync_and_publish.sh; then
  echo "Готово: расписание опубликовано в GitHub."
  /usr/bin/osascript -e 'display notification "Календари успешно обновлены и опубликованы." with title "MSU Schedule"' >/dev/null 2>&1 || true
else
  echo "Ошибка: расписание не обновилось. Подробности в logs/launchd-error.log."
  /usr/bin/osascript -e 'display notification "Не удалось обновить расписание. Проверь VPN и доступ к сайту." with title "MSU Schedule: ошибка"' >/dev/null 2>&1 || true
fi

echo "Нажми Enter, чтобы закрыть окно."
read
