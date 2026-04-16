#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_HOST="${POLYDATA_API_HOST:-127.0.0.1}"
API_PORT="${POLYDATA_API_PORT:-18500}"

cd "${ROOT_DIR}"

cat <<EOF
Starting polyData API helper.

API: http://${API_HOST}:${API_PORT}
Frontend dev server is not started by this script.
Run it separately with:
  cd ${ROOT_DIR}/webpage
  npm run dev
EOF

exec python3 scripts/api_server.py --host "${API_HOST}" --port "${API_PORT}"
