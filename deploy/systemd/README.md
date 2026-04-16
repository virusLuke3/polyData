# systemd Templates

This directory contains public systemd templates for running the local polyData
production services on one machine.

## Included units

- `polydata-api.service`
- `polydata-market-sync.service`
- `polydata-trade-sync.service`
- `polydata-oracle-sync.service`
- `polydata-analytics-sync.service`
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

1. Copy the example env file and fill in secrets:

```bash
mkdir -p ~/.config/polydata
cp deploy/systemd/polydata.env.example ~/.config/polydata/polydata.env
chmod 600 ~/.config/polydata/polydata.env
```

Set `POLYDATA_PYTHON_BIN` in `~/.config/polydata/polydata.env` if your services
should run from a conda environment or venv.

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
systemctl --user status polydata-api polydata-market-sync polydata-trade-sync polydata-oracle-sync polydata-analytics-sync
journalctl --user-unit polydata-api -f
journalctl --user-unit polydata-market-sync -f
```

## Notes

- MySQL, Redis, and Tailscale are treated as external dependencies and do not
  have repo-managed unit files in this first step.
- Logs go to journald instead of repo-local pid or log files.
- The user-level units avoid writing to `/etc/systemd/system/` on shared hosts.
- The checked-in templates intentionally avoid personal usernames and local
  filesystem paths.
- Private hostnames, passwords, and machine-only operational notes should stay
  in `document/`.
