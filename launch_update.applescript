property projectPath : "/Users/egorfedotov/Documents/Расписание МГУ"

on run
  set updater to quoted form of (projectPath & "/sync_and_publish.sh")
  try
    do shell script updater
    display notification "Календари успешно обновлены и опубликованы." with title "MSU Schedule"
  on error errorMessage
    display notification "Не удалось обновить расписание." with title "MSU Schedule: ошибка"
    display dialog "Обновление не выполнено:\n\n" & errorMessage buttons {"OK"} default button "OK" with title "MSU Schedule"
  end try
end run
