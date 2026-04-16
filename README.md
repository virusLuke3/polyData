# polyData

polyData is a Polymarket data indexing and analysis project. It combines local
sync pipelines, a Flask API, and a Vite/Preact dashboard so market metadata,
trade flow, oracle events, runtime signals, and content overlays can be queried
from one place.

This README is the public entrypoint for what the project does today, how to
run it, and where to find the deeper docs.

## Recent Updates

- `2026-04-16` Added a public updates log in [`docs/updates.md`](docs/updates.md).
- `2026-04-16` Added public `systemd` and `nginx` deployment templates under
  [`deploy/`](deploy/README.md).
- `2026-04-16` Documented the current recommendation to deploy CI-built
  `webpage/dist` instead of building frontend code on the remote server.

## What polyData does

- Indexes and serves core Polymarket entities: markets, trades, oracle events,
  sync checkpoints, and auxiliary mappings.
- Exposes a Flask API for dashboard bootstrap, market detail, runtime health,
  address analytics, LOB snapshots, and curated runtime feeds.
- Ships a Vite/Preact dashboard with panel-driven views for market context,
  order flow, oracle activity, sports, macro data, signals, and related content.
- Supports local production-style runtime with user-level `systemd` templates
  for the API and sync jobs.
- Separates public engineering docs in `docs/` from private machine notes in
  `document/`.

## Dashboard Surface

The current frontend panel registry includes:

- market context and featured market views
- active market lists and focused market summaries
- recent chain trades and whale/suspicious flow panels
- oracle feed and market oracle timelines
- runtime LOB and depth panels
- related news, video, reports, and research panels
- system health and live API status
- macro, crypto, commodities, NBA, and heuristic signal panels

The frontend is built in `webpage/` with Vite, TypeScript, and Preact.

## API Surface

The API entrypoint is `scripts/api_server.py`. Public route groups include:

- `/dashboard`, `/bootstrap`, `/search`
- `/markets`, `/markets/<id>`, `/markets/<slug>`
- `/markets/<id>/trades`, `/markets/<id>/price`, `/markets/<id>/chart`,
  `/markets/<id>/detail`, `/markets/<id>/oracle`
- `/trades/recent`, `/oracle/recent`
- `/analytics/addresses/...`
- `/runtime/markets/...`, `/runtime/sports/...`, `/runtime/macro/...`,
  `/runtime/signals/...`, `/runtime/lob/<market_id>`
- `/health`, `/system/health`

## Quick Start

### 1. Backend dependencies

Copy the public example env and fill in the values you need:

```bash
cp .env.example .env
```

The project expects external infrastructure such as:

- MySQL for indexed market and trade data
- Redis for API caching and runtime snapshots
- a Polygon RPC endpoint for chain-facing scripts

Python dependencies:

```bash
pip install -r scripts/requirements.txt
```

### 2. Run the API

```bash
python scripts/api_server.py --host 127.0.0.1 --port 18500
```

Health checks:

```bash
curl http://127.0.0.1:18500/health
curl http://127.0.0.1:18500/system/health
curl http://127.0.0.1:18500/bootstrap
```

There is also a helper wrapper:

```bash
bash scripts/start_dashboard.sh
```

That script starts the API only and prints the frontend command separately.

### 3. Run the frontend

```bash
cd webpage
npm install
npm run dev
```

Useful frontend commands:

```bash
cd webpage
npm run build
npm run preview
```

Defaults:

- API: `http://127.0.0.1:18500`
- Web: `http://127.0.0.1:3000`
- Dev proxy path: `/wm-api`

## Convenience Commands

The root `Makefile` provides a few thin wrappers:

```bash
make dev
make api
make web-build
make status API_PORT=18500
```

`make status` defaults to port `5000`, so pass `API_PORT=18500` if you are
using the current API default.

## Runtime and Deployment

### Local long-running services

Public `systemd` templates live in [`deploy/systemd/`](deploy/systemd/README.md)
for:

- `polydata-api.service`
- `polydata-market-sync.service`
- `polydata-trade-sync.service`
- `polydata-oracle-sync.service`
- `polydata-analytics-sync.service`
- `polydata.target`

These templates assume:

- user-level `systemd`
- one shared env file at `~/.config/polydata/polydata.env`
- MySQL, Redis, and Tailscale managed outside this repo

### Remote frontend hosting

Public deployment guidance lives in [`deploy/`](deploy/README.md).

Current recommendation:

- build `webpage/dist` in CI or locally
- publish the built static output to a server directory such as
  `/var/www/polydata`
- serve it with Nginx using
  [`deploy/nginx/polydata-static.conf.example`](deploy/nginx/polydata-static.conf.example)
- proxy `/wm-api/` to the local API over Tailscale

This keeps the remote server focused on serving a known artifact instead of
cloning the repo and running `npm build` there.

## Repository Layout

```text
polyData/
  scripts/      Python API, pipelines, DB helpers, runtime providers, utilities
  webpage/      Vite/Preact dashboard
  deploy/       public deployment templates for systemd and nginx
  docs/         public architecture, development, and update docs
  document/     private notes and machine-specific operations (gitignored)
  database/     schema notes and sample/reference data
  data/         generated runtime data such as local snapshots
  tests/        public entrypoint for future automated coverage
  todos/        public roadmap-style engineering tasks
```

## Core Data Model

The current project is organized around six main tables:

### 1. `markets`

Primary market metadata such as title, slug, condition identifiers, oracle,
token ids, end date, category, and tags.

### 2. `trades`

Structured on-chain fill records used for tape views, price analysis, whale
tracking, suspicious flow detection, and address analytics.

### 3. `oracle_events`

Request, proposal, dispute, and settlement events that explain how a market
reaches a result.

### 4. `sync_state`

Checkpoint table for the market, trade, oracle, and live sync jobs.

### 5. `block_timestamps`

Cached block-to-time mapping to avoid repeated metadata fetches.

### 6. `uma_adapter_mapping`

Mapping layer between ancillary/oracle strings and question ids so oracle
events can be linked back to markets.

In practice the flow is:

```text
Polymarket / chain / runtime sources
  -> sync jobs
  -> MySQL and local caches
  -> Flask API
  -> dashboard panels and downstream analysis
```

## Reference Data and Scripts

Useful sample/reference files:

- `database/markets.json`
- `database/closed_markets.json`
- `database/trades_sample.json`
- `database/oracle.json`
- `database/POLYMARKET_INDEXER_DB_REPORT.md`

Useful script families:

- `scripts/market/` for market fetch, discovery, decode, and backfill helpers
- `scripts/trade/` for trade indexing and decoding
- `scripts/oracle/` for UMA and oracle investigation/backfill helpers
- `scripts/runtime/` for content, LOB, and snapshot runtime support
- `scripts/db/` for backend configuration, migrations, and trade schema work

## Docs Map

- [`docs/architecture.md`](docs/architecture.md): current shape and target
  boundaries
- [`docs/development.md`](docs/development.md): stable development commands
- [`docs/updates.md`](docs/updates.md): daily public progress log
- [`deploy/README.md`](deploy/README.md): public deployment template overview
- [`todos/README.md`](todos/README.md): public roadmap/task file format

Private notes, host-specific commands, and sensitive operational details belong
in `document/`, which is intentionally ignored by git.

## Verification

Current lightweight verification commands:

```bash
cd webpage && npm run build
python scripts/api_server.py --help
make status API_PORT=18500
```

The public test entrypoint and planned coverage notes live in
[`tests/README.md`](tests/README.md).
