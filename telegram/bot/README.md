# Telegram Bot

This package is reserved for the interactive Telegram bot that users can call
directly to query polyData services.

Suggested future layout:

- `commands.py`: user-facing command handlers.
- `router.py`: update parsing and dispatch.
- `service.py`: calls into polyData APIs and formats bot replies.
- `poller.py` or `webhook.py`: bot runtime entrypoints.

