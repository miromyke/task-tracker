#!/usr/bin/env bash
# Run the whole app locally (Go backend serves the built React frontend).
# Usage: ./run.sh        then open http://localhost:8080
set -euo pipefail
cd "$(dirname "$0")"

# Build the frontend once if it hasn't been built yet.
if [ ! -d frontend/dist ]; then
  echo "Building frontend…"
  (cd frontend && npm install && npm run build)
fi

cd backend
export APP_USERS="${APP_USERS:-mykhailo:Mykhailo,anna:Anna,sofia:Sofia}"
export APP_SECRET="${APP_SECRET:-dev-secret-change-me}"
export APP_TZ="${APP_TZ:-Europe/Kyiv}"
export STATIC_DIR="${STATIC_DIR:-../frontend/dist}"
export PORT="${PORT:-8080}"
# DB + uploads default to ./data/* (backend/data), persisted between runs.

echo "Reno Planner → http://localhost:${PORT}"
echo "Users: ${APP_USERS}"
exec go run .
