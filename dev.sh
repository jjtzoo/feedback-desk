#!/usr/bin/env bash
# Run Feedback locally without Docker: the API on port 8001 (local Postgres, stub model, dev
# sign-in, email off) and the web app on port 3000, in one terminal. Ctrl+C stops both.
# Bash twin of dev.ps1 (use that one on Windows). See README.md.
#
#   ./dev.sh
#
# Needs: uv and Node.js. Installs the web packages on the first run.
set -euo pipefail
cd "$(dirname "$0")"

for port in 8001 3000; do
  if (echo > "/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "STOP: port $port is in use. Stop that server first." >&2
    exit 1
  fi
done
[[ -d web/node_modules ]] || npm --prefix web ci

# On exit, Ctrl+C or a crash, stop everything this script started (Postgres runs on its own).
trap 'trap "" TERM; kill 0' EXIT
uv --directory backend run python -m scripts.dev_server &
api=$!
npm --prefix web run dev &
web=$!
# Stop both when either exits (its error shows above).
while kill -0 "$api" 2>/dev/null && kill -0 "$web" 2>/dev/null; do sleep 1; done
