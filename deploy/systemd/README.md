# systemd Templates

Future service templates will live here.

Planned services:

- `polydata-api.service` for the Flask API compatibility entrypoint.
- `polydata-web.service` for serving the built dashboard or preview server.
- Optional pipeline worker services for market, trade, oracle, and analytics sync jobs.

Templates must avoid hard-coded secrets and should read runtime configuration from environment files.
