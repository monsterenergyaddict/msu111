#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h}"
PLIST="$HOME/Library/LaunchAgents/ru.msu.philos.schedule.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ru.msu.philos.schedule</string>
  <key>ProgramArguments</key><array><string>$ROOT/scheduled_sync.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartCalendarInterval</key><array>
    <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Hour</key><integer>14</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Hour</key><integer>1</integer><key>Minute</key><integer>40</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$ROOT/logs/launchd.log</string>
  <key>StandardErrorPath</key><string>$ROOT/logs/launchd-error.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Синхронизация установлена: 08:30, 14:30, 21:30 и 01:40."
