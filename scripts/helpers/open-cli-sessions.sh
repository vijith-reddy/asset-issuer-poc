#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PROFILES=("$@")

if (( ${#PROFILES[@]} == 0 )); then
  PROFILES=(admin policyadmin alice bob)
fi

shell_quote() {
  local value="$1"
  printf "'%s'" "$(printf "%s" "$value" | sed "s/'/'\\\\''/g")"
}

applescript_escape() {
  printf "%s" "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

print_manual_commands() {
  echo "Open these commands in separate terminals:"

  for profile in "${PROFILES[@]}"; do
    echo "cd $(shell_quote "$ROOT_DIR") && npm run poc -- --as $(shell_quote "$profile") --session $(shell_quote "$profile")"
  done
}

if [[ "${POC_OPEN_PRINT_ONLY:-}" == "1" ]]; then
  print_manual_commands
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]] || ! command -v osascript >/dev/null 2>&1; then
  print_manual_commands
  exit 0
fi

for profile in "${PROFILES[@]}"; do
  command="cd $(shell_quote "$ROOT_DIR") && npm run poc -- --as $(shell_quote "$profile") --session $(shell_quote "$profile")"

  osascript <<OSA
tell application "Terminal"
  activate
  do script "$(applescript_escape "$command")"
end tell
OSA
done

echo "opened CLI sessions: ${PROFILES[*]}"
