# Telegram Publisher

This directory is the Telegram processing layer for polyData. It reads the
existing runtime panel API snapshots, formats them into concise Telegram
messages, deduplicates already-sent updates, and sends them through the
Telegram Bot API.

## First Run

Create the Telegram channels/groups manually, add your bot as an admin, then
set:

```bash
POLYDATA_TELEGRAM_BOT_TOKEN=123:abc
POLYDATA_TELEGRAM_REMOTE_API_BASE=http://34.143.254.155/wm-api
POLYDATA_TELEGRAM_CHANNEL_NEWS=-1001234567890
POLYDATA_TELEGRAM_CHANNEL_ALPHA=-1001234567890
POLYDATA_TELEGRAM_CHANNEL_MACRO=-1001234567890
POLYDATA_TELEGRAM_CHANNEL_NBA=@your_nba_channel
POLYDATA_TELEGRAM_CHANNEL_WEATHER=@your_weather_channel
POLYDATA_TELEGRAM_CHANNEL_MONITOR=@your_main_channel
POLYDATA_TELEGRAM_THREAD_NEWS=12
POLYDATA_TELEGRAM_THREAD_ALPHA=10
POLYDATA_TELEGRAM_THREAD_MACRO=8
```

Dry run:

```bash
python -m telegram.publisher --once --dry-run
```

The publisher probes configured API candidates with `/health` and uses the
first healthy one. For the current split setup, the remote GCP API usually
looks like `http://<gcp-host>/wm-api`; local development API is only a fallback.

Prime state without sending the current backlog:

```bash
python -m telegram.publisher --once --prime
```

Run continuously:

```bash
python -m telegram.publisher --watch
```

To publish the same payload when the live website/API fetches a supported panel,
enable the API-side bridge on the machine running `polydata-api.service`:

```bash
POLYDATA_TELEGRAM_PUBLISH_ON_API_FETCH=true
```

The API returns normally while a background thread sends Telegram messages.
`data/telegram_state.json` deduplicates messages so repeated page refreshes do
not repost the same update.
