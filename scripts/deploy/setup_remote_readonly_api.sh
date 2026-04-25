#!/usr/bin/env bash

set -euo pipefail

# One-shot helper to configure a remote GCP VM as a readonly polyData API host.
# Run this from the current machine after SSH key access to the remote host works.

REMOTE_USER="${REMOTE_USER:-jhuaiyu3}"
REMOTE_HOST="${REMOTE_HOST:-34.143.254.155}"
REMOTE_REPO_ROOT="${REMOTE_REPO_ROOT:-/opt/polyData}"
REMOTE_WEB_ROOT="${REMOTE_WEB_ROOT:-/var/www/polydata}"

# The remote VM will create an SSH local-forward:
#   127.0.0.1:${REMOTE_DB_TUNNEL_PORT} -> ${LOCAL_DB_FORWARD_HOST}:${LOCAL_DB_FORWARD_PORT}
# over SSH to ${LOCAL_DB_SSH_USER}@${LOCAL_DB_SSH_HOST}
LOCAL_DB_SSH_USER="${LOCAL_DB_SSH_USER:-}"
LOCAL_DB_SSH_HOST="${LOCAL_DB_SSH_HOST:-}"
LOCAL_DB_FORWARD_HOST="${LOCAL_DB_FORWARD_HOST:-127.0.0.1}"
LOCAL_DB_FORWARD_PORT="${LOCAL_DB_FORWARD_PORT:-3306}"
REMOTE_DB_TUNNEL_PORT="${REMOTE_DB_TUNNEL_PORT:-43306}"

MYSQL_DATABASE="${MYSQL_DATABASE:-poly_data}"
MYSQL_USER="${MYSQL_USER:-poly_readonly}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"
API_PORT="${API_PORT:-18500}"
SERVER_NAME="${SERVER_NAME:-${REMOTE_HOST}}"
PYTHON_BIN="${PYTHON_BIN:-${REMOTE_REPO_ROOT}/.venv/bin/python}"
SNAPSHOT_SQLITE_PATH="${SNAPSHOT_SQLITE_PATH:-${REMOTE_REPO_ROOT}/data/panel_snapshots.sqlite3}"
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/0}"
GUNICORN_WORKERS="${GUNICORN_WORKERS:-3}"
GUNICORN_THREADS="${GUNICORN_THREADS:-4}"
GUNICORN_MAX_REQUESTS="${GUNICORN_MAX_REQUESTS:-300}"
GUNICORN_MAX_REQUESTS_JITTER="${GUNICORN_MAX_REQUESTS_JITTER:-60}"

if [[ -z "${LOCAL_DB_SSH_USER}" || -z "${LOCAL_DB_SSH_HOST}" ]]; then
  echo "LOCAL_DB_SSH_USER and LOCAL_DB_SSH_HOST are required." >&2
  exit 1
fi

if [[ -z "${MYSQL_PASSWORD}" ]]; then
  echo "MYSQL_PASSWORD is required." >&2
  exit 1
fi

SSH_OPTS=(
  -o BatchMode=yes
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=10
)

echo "[1/7] Checking SSH access to ${REMOTE_USER}@${REMOTE_HOST} ..."
ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" "echo connected: \$(hostname)"

echo "[2/7] Uploading runtime configuration ..."
LOCAL_ENV_FILE="$(mktemp)"
LOCAL_TUNNEL_SERVICE="$(mktemp)"
LOCAL_API_SERVICE="$(mktemp)"
LOCAL_NGINX_CONF="$(mktemp)"
trap 'rm -f "${LOCAL_ENV_FILE}" "${LOCAL_TUNNEL_SERVICE}" "${LOCAL_API_SERVICE}" "${LOCAL_NGINX_CONF}"' EXIT

cat > "${LOCAL_ENV_FILE}" <<EOF
POLYMARKET_DB_BACKEND=mysql
POLYMARKET_MYSQL_HOST=127.0.0.1
POLYMARKET_MYSQL_PORT=${REMOTE_DB_TUNNEL_PORT}
POLYMARKET_MYSQL_USER=${MYSQL_USER}
POLYMARKET_MYSQL_PASSWORD=${MYSQL_PASSWORD}
POLYMARKET_MYSQL_DATABASE=${MYSQL_DATABASE}
POLYMARKET_MYSQL_CHARSET=utf8mb4
POLYMARKET_MYSQL_CONNECT_TIMEOUT=10
POLYMARKET_MYSQL_READ_TIMEOUT=60
POLYMARKET_MYSQL_WRITE_TIMEOUT=60

POLYDATA_PYTHON_BIN=${PYTHON_BIN}
POLYDATA_API_READONLY=1
POLYDATA_API_HOST=127.0.0.1
POLYDATA_API_PORT=${API_PORT}
POLYDATA_GUNICORN_WORKERS=${GUNICORN_WORKERS}
POLYDATA_GUNICORN_THREADS=${GUNICORN_THREADS}
POLYDATA_GUNICORN_MAX_REQUESTS=${GUNICORN_MAX_REQUESTS}
POLYDATA_GUNICORN_MAX_REQUESTS_JITTER=${GUNICORN_MAX_REQUESTS_JITTER}
POLYDATA_REDIS_URL=${REDIS_URL}
POLYDATA_REDIS_PREFIX=polydata:
POLYDATA_SNAPSHOT_SQLITE_PATH=${SNAPSHOT_SQLITE_PATH}
POLYDATA_MARKETS_RUNTIME_PRICES=0
POLYDATA_MARKETS_LATEST_SNAPSHOT_FALLBACK=1
POLYDATA_ALLOWED_ORIGINS=
EOF

cat > "${LOCAL_TUNNEL_SERVICE}" <<EOF
[Unit]
Description=polyData DB SSH tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/ssh -N -L ${REMOTE_DB_TUNNEL_PORT}:${LOCAL_DB_FORWARD_HOST}:${LOCAL_DB_FORWARD_PORT} ${LOCAL_DB_SSH_USER}@${LOCAL_DB_SSH_HOST} -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

cat > "${LOCAL_API_SERVICE}" <<EOF
[Unit]
Description=polyData readonly API service
After=network-online.target polydata-db-tunnel.service
Wants=network-online.target polydata-db-tunnel.service

[Service]
Type=simple
WorkingDirectory=${REMOTE_REPO_ROOT}
EnvironmentFile=%h/.config/polydata/polydata.env
ExecStart=/bin/bash -lc 'exec "${REMOTE_REPO_ROOT}/.venv/bin/gunicorn" --workers "${POLYDATA_GUNICORN_WORKERS:-3}" --threads "${POLYDATA_GUNICORN_THREADS:-4}" --bind "${POLYDATA_API_HOST:-127.0.0.1}:${POLYDATA_API_PORT:-18500}" --timeout 180 --graceful-timeout 30 --max-requests "${POLYDATA_GUNICORN_MAX_REQUESTS:-300}" --max-requests-jitter "${POLYDATA_GUNICORN_MAX_REQUESTS_JITTER:-60}" scripts.api.app:app'
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF

cat > "${LOCAL_NGINX_CONF}" <<EOF
server {
    listen 80;
    server_name ${SERVER_NAME} _;

    root ${REMOTE_WEB_ROOT};
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /wm-api/ {
        proxy_pass http://127.0.0.1:${API_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
EOF

scp "${SSH_OPTS[@]}" "${LOCAL_ENV_FILE}" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/polydata.env"
scp "${SSH_OPTS[@]}" "${LOCAL_TUNNEL_SERVICE}" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/polydata-db-tunnel.service"
scp "${SSH_OPTS[@]}" "${LOCAL_API_SERVICE}" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/polydata-api.service"
scp "${SSH_OPTS[@]}" "${LOCAL_NGINX_CONF}" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/polydata-nginx.conf"

echo "[3/7] Installing packages, services, and env on the remote VM ..."
ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" bash <<'EOF'
set -euo pipefail

REMOTE_REPO_ROOT="${REMOTE_REPO_ROOT:-/opt/polyData}"
REMOTE_WEB_ROOT="${REMOTE_WEB_ROOT:-/var/www/polydata}"

sudo apt update
sudo apt install -y nginx redis-server python3-venv python3-pip rsync

mkdir -p "${HOME}/.config/polydata"
mkdir -p "${HOME}/.config/systemd/user"
mkdir -p "${REMOTE_REPO_ROOT}/data"
chmod 700 "${HOME}/.config/polydata"

install -m 600 /tmp/polydata.env "${HOME}/.config/polydata/polydata.env"
install -m 644 /tmp/polydata-db-tunnel.service "${HOME}/.config/systemd/user/polydata-db-tunnel.service"
install -m 644 /tmp/polydata-api.service "${HOME}/.config/systemd/user/polydata-api.service"

if [[ ! -x "${REMOTE_REPO_ROOT}/.venv/bin/python" ]]; then
  python3 -m venv "${REMOTE_REPO_ROOT}/.venv"
fi
"${REMOTE_REPO_ROOT}/.venv/bin/pip" install -U pip
"${REMOTE_REPO_ROOT}/.venv/bin/pip" install -r "${REMOTE_REPO_ROOT}/scripts/requirements.txt"

sudo mkdir -p "${REMOTE_WEB_ROOT}"
cd "${REMOTE_REPO_ROOT}/webpage"
npm install
npm run build
sudo rsync -av --delete "${REMOTE_REPO_ROOT}/webpage/dist/" "${REMOTE_WEB_ROOT}/"

sudo install -m 644 /tmp/polydata-nginx.conf /etc/nginx/sites-available/polydata
sudo ln -sf /etc/nginx/sites-available/polydata /etc/nginx/sites-enabled/polydata
sudo nginx -t

systemctl --user daemon-reload
systemctl --user disable polydata.target >/dev/null 2>&1 || true
systemctl --user stop polydata.target polydata-market-sync polydata-trade-sync polydata-oracle-sync polydata-analytics-sync >/dev/null 2>&1 || true
systemctl --user enable --now polydata-db-tunnel.service
systemctl --user enable --now polydata-api.service

sudo systemctl enable --now redis-server
sudo systemctl enable --now nginx
sudo systemctl reload nginx

loginctl enable-linger "${USER}" >/dev/null 2>&1 || true
EOF

echo "[4/7] Verifying DB tunnel and API health ..."
ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" "python3 - <<'PY'
import pymysql
conn = pymysql.connect(host='127.0.0.1', port=${REMOTE_DB_TUNNEL_PORT}, user='${MYSQL_USER}', password='${MYSQL_PASSWORD}', database='${MYSQL_DATABASE}', charset='utf8mb4', autocommit=True)
with conn.cursor() as cur:
    cur.execute('SELECT 1')
    print('db-ok', cur.fetchone())
conn.close()
PY"

ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" "curl -fsS http://127.0.0.1:${API_PORT}/health && echo && curl -fsS http://127.0.0.1:${API_PORT}/system/health >/dev/null && echo api-ok"

echo "[5/7] Verifying Nginx proxy ..."
ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" "curl -fsS http://127.0.0.1/wm-api/health && echo"

echo "[6/7] Remote service status ..."
ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" "systemctl --user --no-pager --full status polydata-db-tunnel.service polydata-api.service | sed -n '1,160p'"
ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" "sudo systemctl --no-pager --full status nginx redis-server | sed -n '1,160p'"

echo "[7/7] Done."
echo "Remote readonly API host is configured on ${REMOTE_HOST}."
