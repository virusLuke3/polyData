#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${ROOT_DIR}/runtime_logs"
API_LOG="${LOG_DIR}/dashboard-api.log"
WEB_LOG="${LOG_DIR}/dashboard-web.log"
API_PID_FILE="${LOG_DIR}/dashboard-api.pid"
WEB_PID_FILE="${LOG_DIR}/dashboard-web.pid"
API_HOST="${POLYDATA_API_HOST:-127.0.0.1}"
API_PORT="${POLYDATA_API_PORT:-5000}"
WEB_HOST="${POLYDATA_WEB_HOST:-127.0.0.1}"
WEB_PORT="${POLYDATA_WEB_PORT:-3000}"

mkdir -p "${LOG_DIR}"

stop_if_running() {
  local pid_file="$1"
  if [[ -f "${pid_file}" ]]; then
    local pid
    pid="$(cat "${pid_file}")"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}"
      wait "${pid}" 2>/dev/null || true
    fi
    rm -f "${pid_file}"
  fi
}

stop_matching_processes() {
  local pattern="$1"
  pkill -f "$pattern" 2>/dev/null || true
}

wait_for_url() {
  local url="$1"
  local label="$2"
  python3 - "$url" "$label" <<'PY'
import sys
import time
import urllib.request

url = sys.argv[1]
label = sys.argv[2]
deadline = time.time() + 60
last_error = None

while time.time() < deadline:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            if response.status < 500:
                print(f"{label} ready: {url}")
                sys.exit(0)
    except Exception as exc:
        last_error = exc
        time.sleep(1)

print(f"{label} failed to become ready: {last_error}", file=sys.stderr)
sys.exit(1)
PY
}

stop_if_running "${API_PID_FILE}"
stop_if_running "${WEB_PID_FILE}"
stop_matching_processes "python3 scripts/api_server.py --host ${API_HOST} --port ${API_PORT}"
stop_matching_processes "next-server"
: > "${API_LOG}"
: > "${WEB_LOG}"

if [[ ! -f "${ROOT_DIR}/webpage/.next/BUILD_ID" ]]; then
  echo "No Next.js production build found. Running npm run build..."
  (cd "${ROOT_DIR}/webpage" && npm run build)
fi

echo "Starting API server..."
(
  cd "${ROOT_DIR}"
  python3 scripts/api_server.py --host "${API_HOST}" --port "${API_PORT}"
) >>"${API_LOG}" 2>&1 &
echo $! > "${API_PID_FILE}"

wait_for_url "http://${API_HOST}:${API_PORT}/health" "API"
wait_for_url "http://${API_HOST}:${API_PORT}/dashboard" "Dashboard warmup"

echo "Starting Next.js server..."
(
  cd "${ROOT_DIR}/webpage"
  HOSTNAME="${WEB_HOST}" PORT="${WEB_PORT}" npm run start
) >>"${WEB_LOG}" 2>&1 &
echo $! > "${WEB_PID_FILE}"

wait_for_url "http://${WEB_HOST}:${WEB_PORT}" "Web"

echo
echo "polyData dashboard is running."
echo "API: http://${API_HOST}:${API_PORT}"
echo "Web: http://${WEB_HOST}:${WEB_PORT}"
echo "API log: ${API_LOG}"
echo "Web log: ${WEB_LOG}"