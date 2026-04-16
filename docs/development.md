# Development

This page documents stable public development commands for polyData.

## Frontend

```bash
cd webpage
npm install
npm run dev
npm run build
```

The Vite dev server defaults to port `3000`. API proxy requests use `/wm-api` and target `VITE_POLYDATA_API_BASE_URL` when set, otherwise `http://127.0.0.1:5000`.

## API

```bash
python scripts/api_server.py --help
python scripts/api_server.py --host 127.0.0.1 --port 5000
```

Health checks:

```bash
curl http://127.0.0.1:5000/health
curl http://127.0.0.1:5000/system/health
curl http://127.0.0.1:5000/bootstrap
```

## Convenience Commands

The root `Makefile` wraps existing commands without changing their behavior:

```bash
make web-build
make api
make dev
make status
```

## Refactor Safety Checklist

- Keep `scripts/start_dashboard.sh` working until a replacement is proven.
- Keep `scripts/api_server.py` working as the compatibility API entrypoint.
- Run `cd webpage && npm run build` after frontend or shared type changes.
- Avoid committing runtime data, logs, private docs, or generated dependency directories.
