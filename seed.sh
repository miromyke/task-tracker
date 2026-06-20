#!/usr/bin/env bash
# Seed a running instance with sample projects/tasks/activity.
# Usage: ./seed.sh [base-url]   (default http://localhost:8080)
# The server must be running with users mykhailo, anna, sofia (run.sh does this).
set -euo pipefail
BASE="${1:-http://localhost:8080}"
J="$(mktemp)"

echo "Waiting for ${BASE}…"
for _ in $(seq 1 50); do curl -sf -o /dev/null "${BASE}/api/me" && break || sleep 0.3; done

curl -s -c "$J" -X POST "${BASE}/api/login" -H 'Content-Type: application/json' -d '{"username":"mykhailo"}' >/dev/null

count=$(curl -s -b "$J" "${BASE}/api/projects" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
if [ "$count" != "0" ]; then
  echo "Already has ${count} project(s) — nothing to seed."
  exit 0
fi

uid() { curl -s -b "$J" "${BASE}/api/users" | python3 -c "import sys,json;[print(u['id']) for u in json.load(sys.stdin) if u['username']==sys.argv[1]]" "$1"; }
MY=$(uid mykhailo); AN=$(uid anna); SO=$(uid sofia)

mkproj() { curl -s -b "$J" -X POST "${BASE}/api/projects" -H 'Content-Type: application/json' -d "$1" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])"; }
P=$(mkproj '{"name":"Kitchen Remodel","description":"New cabinets, quartz counters & backsplash. Targeting end of July."}')
mkproj '{"name":"Master Bath","description":"Re-tile, new vanity, fix the plumbing."}' >/dev/null
mkproj '{"name":"Living Room","description":"Paint, wall framing, built-in shelves."}' >/dev/null

mktask() { curl -s -b "$J" -X POST "${BASE}/api/projects/${P}/tasks" -H 'Content-Type: application/json' -d "$1" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])"; }
T1=$(mktask "{\"title\":\"Tile bathroom floor\",\"tags\":[\"bathroom\",\"tile\"],\"assigneeId\":${MY},\"dueDate\":\"2026-06-25\",\"status\":\"in_progress\"}")
mktask "{\"title\":\"Order countertops\",\"tags\":[\"kitchen\"],\"assigneeId\":${AN},\"dueDate\":\"2026-06-22\"}" >/dev/null
mktask "{\"title\":\"Rewire kitchen outlets\",\"tags\":[\"electrical\",\"kitchen\"],\"assigneeId\":${SO},\"dueDate\":\"2026-06-28\"}" >/dev/null
T4=$(mktask "{\"title\":\"Pick paint colors\",\"tags\":[\"paint\"],\"assigneeId\":${MY}}")
T5=$(mktask "{\"title\":\"Demo old cabinets\",\"tags\":[\"kitchen\",\"demo\"],\"assigneeId\":${AN}}")

curl -s -b "$J" -X POST "${BASE}/api/tasks/${T1}/log" -F 'text=Floor prepped, mortar mixed. Starting the tile layout from the doorway.' >/dev/null
curl -s -b "$J" -X POST "${BASE}/api/tasks/${T5}/log" -F 'text=Old cabinets out, walls patched.' >/dev/null
curl -s -b "$J" -X PATCH "${BASE}/api/tasks/${T5}" -H 'Content-Type: application/json' -d '{"status":"done"}' >/dev/null
curl -s -b "$J" -X PATCH "${BASE}/api/tasks/${T4}" -H 'Content-Type: application/json' -d '{"status":"abandoned"}' >/dev/null

echo "Seeded 3 projects and 5 tasks (with activity). Log in as mykhailo, anna, or sofia."
