from __future__ import annotations

from typing import Protocol

import requests

from .formatters import format_market_search, format_pnl_coverage, format_signals, format_wallet, help_text, is_address, start_text
from .models import BotReply, CommandRequest


class BotApi(Protocol):
    def search_markets(self, query: str, *, limit: int = 5): ...
    def alpha_signals(self, *, limit: int = 5): ...
    def wallet_summary(self, address: str, *, days: int = 30): ...
    def wallet_trades(self, address: str, *, limit: int = 5): ...
    def pnl(self, address: str): ...


def _usage(command: str) -> BotReply:
    usages = {
        "market": "请使用：/market nba 或 /market bitcoin",
        "wallet": "请使用：/wallet 0x...",
        "pnl": "请使用：/pnl 0x...",
        "signal": "请使用：/signal polymarket",
    }
    return BotReply(f"⚠️ {command}\n{usages.get(command, '请使用 /help 查看命令')}")


def _service_error(label: str) -> BotReply:
    return BotReply(f"⚠️ {label}\n服务暂时不可用，稍后再试。")


def handle_command(request: CommandRequest, api: BotApi) -> BotReply:
    command = request.command
    args = request.args.strip()
    if command == "start":
        return BotReply(start_text())
    if command == "help":
        return BotReply(help_text())
    if command == "market":
        if not args:
            return _usage("market")
        try:
            return BotReply(format_market_search(args, api.search_markets(args, limit=5)), link_preview=False)
        except requests.RequestException:
            return _service_error("Market")
    if command == "signal":
        topic = args or "polymarket"
        try:
            return BotReply(format_signals(topic, api.alpha_signals(limit=5)), link_preview=True)
        except requests.RequestException:
            return _service_error("Signal")
    if command == "wallet":
        if not args or not is_address(args.split()[0]):
            return _usage("wallet")
        address = args.split()[0].lower()
        try:
            summary = api.wallet_summary(address, days=30)
            trades = api.wallet_trades(address, limit=5)
        except requests.RequestException:
            return BotReply(
                "\n".join(
                    [
                        "⚠️ Wallet",
                        "地址服务暂时不可用。",
                        f"地址：{address[:6]}...{address[-4:]}",
                    ]
                )
            )
        return BotReply(format_wallet(address, summary, trades), link_preview=False)
    if command == "pnl":
        if not args or not is_address(args.split()[0]):
            return _usage("pnl")
        address = args.split()[0].lower()
        payload = {}
        try:
            payload = api.pnl(address)
        except requests.RequestException:
            payload = {}
        return BotReply(format_pnl_coverage(address, payload), link_preview=False)
    return BotReply(f"⚠️ Unknown command: /{command}\n使用 /help 查看可用命令。")
