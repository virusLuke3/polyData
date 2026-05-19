# systemd Templates

This directory contains public systemd templates for running the local polyData
production services on one machine.

## Included units

- `polydata-api.service`
- `polydata-db-reverse-tunnel.service` (installed on the local DB host, not GCP)
- `polydata-market-sync.service`
- `polydata-trade-sync.service`
- `polydata-oracle-sync.service`
- `polydata-analytics-sync.service`
- `polydata-event-market-serving.service`
- `polydata-new-market-signal.service`
- `polydata-geo-sanctions-shock.service`
- `polydata-jin10-seed.service`
- `polydata-f1-seed.service`
- `polydata-nba-seed.service`
- `polydata-market-group-seed.service`
- `polydata-crypto-funding-seed.service`
- `polydata-finance-external-sources-seed.service`
- `polydata-inflation-nowcast-seed.service`
- `polydata-macro-cpi-panels-seed.service`
- `polydata-alpha-signal-seed.service`
- `polydata-whale-trades-seed.service`
- `polydata-suspicious-trades-seed.service`
- `polydata-bootstrap-seed.service`
- `polydata-telegram-publisher.service`
- `polydata.target`
- `polydata.env.example`

## Runtime model

The templates assume:

- user-level systemd
- one shared environment file at `~/.config/polydata/polydata.env`
- repo checkout path replaced before install
- Python interpreter selected through `POLYDATA_PYTHON_BIN`

Before copying these units into `~/.config/systemd/user/`, replace:

- `/__POLYDATA_REPO_ROOT__`

## Install flow

For the current local development machine, prefer the repo helper:

```bash
make services-install
make services-start
make services-status
```

It installs a smaller `polydata-core.target` for PostgreSQL market/oracle/API
runtime and intentionally excludes `polydata-trade-sync.service` until the
OrderFilled ClickHouse migration is ready.

The manual template flow is:

1. Copy the example env file and fill in secrets:

```bash
mkdir -p ~/.config/polydata
cp deploy/systemd/polydata.env.example ~/.config/polydata/polydata.env
chmod 600 ~/.config/polydata/polydata.env
```

Set `POLYDATA_PYTHON_BIN` in `~/.config/polydata/polydata.env` if your services
should run from a conda environment or venv.

For the local machine that owns PostgreSQL, set the tunnel target before
installing `polydata-db-reverse-tunnel.service`:

```bash
POLYDATA_GCP_SSH_TARGET=jhuaiyu3@34.143.254.155
POLYDATA_LOCAL_POSTGRES_PORT=45432
POLYDATA_REMOTE_POSTGRES_PORT=45432
```

2. Copy the unit files:

```bash
sed -i "s|/__POLYDATA_REPO_ROOT__|$(pwd)|g" deploy/systemd/polydata-*.service deploy/systemd/polydata.env.example
mkdir -p ~/.config/systemd/user
cp deploy/systemd/polydata-*.service ~/.config/systemd/user/
cp deploy/systemd/polydata.target ~/.config/systemd/user/
```

3. Reload and start the target:

```bash
systemctl --user daemon-reload
systemctl --user enable --now polydata.target
```

4. Keep the services alive after logout:

```bash
loginctl enable-linger "$USER"
```

5. Inspect status and logs:

```bash
systemctl --user status polydata-api polydata-market-sync polydata-trade-sync polydata-oracle-sync polydata-analytics-sync polydata-event-market-serving polydata-new-market-signal polydata-geo-sanctions-shock polydata-jin10-seed polydata-f1-seed polydata-nba-seed polydata-market-group-seed polydata-crypto-funding-seed polydata-finance-external-sources-seed polydata-inflation-nowcast-seed polydata-alpha-signal-seed polydata-whale-trades-seed polydata-suspicious-trades-seed polydata-bootstrap-seed
journalctl --user-unit polydata-api -f
journalctl --user-unit polydata-db-reverse-tunnel -f
journalctl --user-unit polydata-market-sync -f
journalctl --user-unit polydata-new-market-signal -f
journalctl --user-unit polydata-event-market-serving -f
journalctl --user-unit polydata-geo-sanctions-shock -f
journalctl --user-unit polydata-jin10-seed -f
journalctl --user-unit polydata-f1-seed -f
journalctl --user-unit polydata-nba-seed -f
journalctl --user-unit polydata-market-group-seed -f
journalctl --user-unit polydata-crypto-funding-seed -f
journalctl --user-unit polydata-finance-external-sources-seed -f
journalctl --user-unit polydata-inflation-nowcast-seed -f
journalctl --user-unit polydata-alpha-signal-seed -f
journalctl --user-unit polydata-whale-trades-seed -f
journalctl --user-unit polydata-suspicious-trades-seed -f
journalctl --user-unit polydata-bootstrap-seed -f
```

The Telegram publisher is optional because it needs a bot token and channel
ids. After filling `POLYDATA_TELEGRAM_*`, enable it explicitly:

```bash
systemctl --user enable --now polydata-telegram-publisher
journalctl --user-unit polydata-telegram-publisher -f
```

## Notes

- PostgreSQL and Redis are treated as external dependencies and do not
  have repo-managed unit files in this first step.
- Logs go to journald instead of repo-local pid or log files.
- The user-level units avoid writing to `/etc/systemd/system/` on shared hosts.
- The checked-in templates intentionally avoid personal usernames and local
  filesystem paths.
- Private hostnames, passwords, and machine-only operational notes should stay
  in `document/`.
