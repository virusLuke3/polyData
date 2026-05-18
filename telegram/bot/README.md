# Telegram Bot

Interactive Telegram bot for user-called polyData queries.

## Commands

- `/start`
- `/help`
- `/market nba`
- `/market bitcoin`
- `/wallet 0xabc...`
- `/pnl 0xabc...`
- `/signal polymarket`

`/pnl` is intentionally coverage-only in v1. It does not output a full PnL
number until the cashflow / position snapshot serving layer is ready.

## Run

```bash
python -m telegram.bot.poller --once --dry-run
python -m telegram.bot.poller
```

## Environment

```bash
POLYDATA_TELEGRAM_BOT_TOKEN=123:abc
POLYDATA_TELEGRAM_BOT_POLYDATA_API_BASE=http://127.0.0.1:18500
POLYDATA_TELEGRAM_BOT_STATE_PATH=data/telegram_bot_state.json
POLYDATA_TELEGRAM_BOT_ALLOWED_CHAT_IDS=
POLYDATA_TELEGRAM_BOT_ADMIN_USER_IDS=
```

If `POLYDATA_TELEGRAM_BOT_POLYDATA_API_BASE` is not set, the bot falls back to
the existing Telegram / polyData API env vars.
