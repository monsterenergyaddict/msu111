#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h}"
"$ROOT/run.sh" --no-notify
"$ROOT/publish_github.sh"
