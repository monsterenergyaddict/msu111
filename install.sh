#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h}"
chmod +x "$ROOT/run.sh" "$ROOT/sync_and_publish.sh" "$ROOT/install_launchd.sh" "$ROOT/uninstall_launchd.sh" "$ROOT/deploy_to_documents.sh" "$ROOT/publish_github.sh" "$ROOT/sync.js"
echo "Готово. Python и другие зависимости не нужны. Сначала выполните: $ROOT/run.sh --dry-run"
