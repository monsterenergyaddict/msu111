#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h}"
cd "$ROOT"
exec /usr/bin/osascript -l JavaScript "$ROOT/sync.js" --config "$ROOT/config.json" "$@"
