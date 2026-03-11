#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Polymarket 市场历史 K 线数据脚本

功能：
  - 通过 CLOB API /prices-history 拉取指定市场的历史价格序列
  - 在本地聚合为 OHLC K 线（open/high/low/close，按指定时间粒度）
  - 支持通过 token_id / market slug / condition_id 三种方式指定市场
  - 支持输出为 JSON / CSV / 终端表格

API 来源（无需鉴权）：
  CLOB API: GET https://clob.polymarket.com/prices-history
    参数:
      market    - token ID（Yes 或 No token 的 asset_id）
      startTs   - 起始 unix 时间戳（秒，可选）
      endTs     - 结束 unix 时间戳（秒，可选）
      interval  - 预设范围：max | all | 1m | 1w | 1d | 6h | 1h
      fidelity  - 原始数据精度（分钟，默认 1）
    响应: {"history": [{"t": unix_ts, "p": price_float}, ...]}

  价格含义：
    Yes token 价格 ∈ [0, 1]，代表市场对该结果发生概率的估计
    No token 价格 = 1 - Yes 价格（在流动性充足时近似成立）

用法示例：
  # 通过 Yes token_id 拉取过去 1 周的 1 小时 K 线
  python market_kline.py --token-id <yes_token_id> --interval 1w --candle 60

  # 通过市场 slug 拉取全量历史，1 天 K 线（需 --db）
  python market_kline.py --slug will-btc-hit-100k --interval max --candle 1440 --db /path/to/db

  # 指定起止日期，30 分钟 K 线，输出 CSV
  python market_kline.py --token-id <id> --start 2024-01-01 --end 2025-01-01 --candle 30 -o btc_kline.csv

  # 指定 condition_id，输出 JSON
  python market_kline.py --condition-id <cid> --interval 1m --candle 60 -o kline.json
"""

import sys
import csv
import json
import time
import argparse
from datetime import datetime, timezone
from typing import List, Dict, Optional, Tuple
from pathlib import Path
from io import StringIO

# 确保 scripts 根目录在 path 中
_scripts_root = Path(__file__).resolve().parent.parent
if str(_scripts_root) not in sys.path:
    sys.path.insert(0, str(_scripts_root))

try:
    from .market_discovery import _fetch_with_retry
except ImportError:
    _market_dir = Path(__file__).resolve().parent
    if str(_market_dir) not in sys.path:
        sys.path.insert(0, str(_market_dir))
    from market_discovery import _fetch_with_retry  # type: ignore

from db import get_connection, init_schema, DEFAULT_DB_PATH  # type: ignore


# ── 常量 ───────────────────────────────────────────────────────────────────────
CLOB_API_BASE = "https://clob.polymarket.com"
GAMMA_API_BASE = "https://gamma-api.polymarket.com"

PRICES_HISTORY_URL = f"{CLOB_API_BASE}/prices-history"
GAMMA_MARKETS_URL = f"{GAMMA_API_BASE}/markets"

VALID_INTERVALS = ["max", "all", "1m", "1w", "1d", "6h", "1h"]

# interval 对应的推荐 fidelity（分钟），fidelity 越大请求点数越少、速度越快
# 用户可通过 --fidelity 覆盖
INTERVAL_DEFAULT_FIDELITY: Dict[str, int] = {
    "max": 1440,   # 全量历史：每点代表 1 天
    "all": 1440,
    "1m":  60,     # 近 1 个月：每点代表 1 小时
    "1w":  15,     # 近 1 周：每点代表 15 分钟
    "1d":  1,      # 近 1 天：每点代表 1 分钟
    "6h":  1,
    "1h":  1,
}


# ── DB / Gamma 辅助：token_id 查找 ────────────────────────────────────────────

def _lookup_tokens_from_db(
    db_path: str,
    slug: Optional[str] = None,
    condition_id: Optional[str] = None,
) -> Optional[Tuple[str, str]]:
    """
    从本地 DB 查询市场的 (yes_token_id, no_token_id)。
    优先按 condition_id 匹配，其次 slug。
    """
    try:
        init_schema(db_path=db_path)
        conn = get_connection(db_path)
        cur = conn.cursor()
        if condition_id:
            cur.execute(
                "SELECT yes_token_id, no_token_id FROM markets WHERE condition_id = ?",
                (condition_id,),
            )
        elif slug:
            cur.execute(
                "SELECT yes_token_id, no_token_id FROM markets WHERE slug = ?",
                (slug,),
            )
        else:
            return None
        row = cur.fetchone()
        conn.close()
        if row:
            return str(row[0]), str(row[1])
    except Exception as e:
        print(f"  [db] lookup failed: {e}", file=sys.stderr)
    return None


def _lookup_tokens_from_gamma(
    slug: Optional[str] = None,
    condition_id: Optional[str] = None,
) -> Optional[Tuple[str, str]]:
    """
    通过 Gamma API 查询市场的 (yes_token_id, no_token_id)。
    """
    params: Dict = {}
    if slug:
        params["slug"] = slug
    elif condition_id:
        params["conditionId"] = condition_id
    else:
        return None

    try:
        data = _fetch_with_retry(GAMMA_MARKETS_URL, params)
    except Exception as e:
        print(f"  [gamma] lookup failed: {e}", file=sys.stderr)
        return None

    markets = data if isinstance(data, list) else data.get("markets", [])
    if not markets:
        return None

    m = markets[0]
    clob_ids = m.get("clobTokenIds", [])
    if isinstance(clob_ids, str):
        try:
            clob_ids = json.loads(clob_ids)
        except Exception:
            clob_ids = []

    tokens = m.get("tokens", [])
    if tokens and not clob_ids:
        clob_ids = [t.get("tokenId") for t in tokens if t.get("tokenId")]

    if len(clob_ids) >= 2:
        return str(clob_ids[0]), str(clob_ids[1])
    return None


def resolve_token_id(
    token_id: Optional[str],
    slug: Optional[str],
    condition_id: Optional[str],
    outcome: str,
    db_path: Optional[str],
) -> str:
    """
    将用户指定的市场标识解析为实际的 asset token_id。

    优先级：
      1. 直接指定 --token-id
      2. --slug 或 --condition-id → 先查本地 DB，再查 Gamma API
    """
    if token_id:
        return token_id

    if not slug and not condition_id:
        print(
            "Error: 必须指定 --token-id、--slug 或 --condition-id 之一。",
            file=sys.stderr,
        )
        sys.exit(1)

    # 先查本地 DB
    pair = None
    if db_path:
        pair = _lookup_tokens_from_db(db_path, slug=slug, condition_id=condition_id)
        if pair:
            print(
                f"  [db] Found tokens for {'slug=' + slug if slug else 'condition_id=' + condition_id}",
                file=sys.stderr,
            )

    # 回退到 Gamma API
    if pair is None:
        print(
            f"  [gamma] Querying Gamma API for {'slug=' + slug if slug else 'condition_id=' + condition_id} ...",
            file=sys.stderr,
        )
        pair = _lookup_tokens_from_gamma(slug=slug, condition_id=condition_id)

    if pair is None:
        print(
            "Error: 无法找到对应市场，请确认 slug/condition_id 是否正确。",
            file=sys.stderr,
        )
        sys.exit(1)

    yes_id, no_id = pair
    if outcome.lower() == "no":
        print(f"  Using No token: {no_id}", file=sys.stderr)
        return no_id
    else:
        print(f"  Using Yes token: {yes_id}", file=sys.stderr)
        return yes_id


# ── 价格历史拉取 ──────────────────────────────────────────────────────────────

def fetch_prices_history(
    token_id: str,
    interval: Optional[str] = None,
    start_ts: Optional[int] = None,
    end_ts: Optional[int] = None,
    fidelity: Optional[int] = None,
) -> List[Dict]:
    """
    从 CLOB API 拉取原始价格历史。

    Args:
        token_id:  Yes 或 No token 的 asset ID
        interval:  预设时间范围 (max/all/1m/1w/1d/6h/1h)
        start_ts:  起始 unix 时间戳（秒）
        end_ts:    结束 unix 时间戳（秒）
        fidelity:  原始数据精度（分钟），None 则由 API 默认

    Returns:
        [{"t": int, "p": float}, ...]  按时间升序
    """
    params: Dict = {"market": token_id}

    if interval:
        params["interval"] = interval
    if start_ts is not None:
        params["startTs"] = start_ts
    if end_ts is not None:
        params["endTs"] = end_ts
    if fidelity is not None:
        params["fidelity"] = fidelity

    print(f"  Fetching price history from CLOB API (token={token_id[:16]}...)", file=sys.stderr)
    data = _fetch_with_retry(PRICES_HISTORY_URL, params)

    history = data.get("history", []) if isinstance(data, dict) else []
    print(f"  Got {len(history)} raw price points.", file=sys.stderr)

    # 按时间升序排列
    history.sort(key=lambda x: x.get("t", 0))
    return history


# ── OHLC 聚合 ────────────────────────────────────────────────────────────────

def aggregate_to_ohlc(
    raw: List[Dict],
    candle_minutes: int,
) -> List[Dict]:
    """
    将原始价格时序 [{t, p}, ...] 聚合为 OHLC K 线。

    Args:
        raw:            原始价格数据（按时间升序）
        candle_minutes: K 线粒度（分钟），如 60 = 1 小时 K 线

    Returns:
        [
          {
            "open_time": unix_ts,          # K 线开盘时间（秒）
            "open_time_iso": "...",         # ISO 格式开盘时间
            "open":  float,
            "high":  float,
            "low":   float,
            "close": float,
            "points": int,                 # 该 K 线内包含的数据点数量
          },
          ...
        ]
    """
    if not raw:
        return []

    candle_sec = candle_minutes * 60
    candles: List[Dict] = []

    # 以第一个点的时间为基准对齐 K 线起点
    first_t = raw[0]["t"]
    bucket_start = (first_t // candle_sec) * candle_sec

    cur_open: Optional[float] = None
    cur_high: float = float("-inf")
    cur_low: float = float("inf")
    cur_close: float = 0.0
    cur_points: int = 0
    cur_bucket: int = bucket_start

    def _flush(bucket_ts: int) -> None:
        if cur_open is None:
            return
        candles.append({
            "open_time": bucket_ts,
            "open_time_iso": datetime.fromtimestamp(bucket_ts, tz=timezone.utc).strftime(
                "%Y-%m-%d %H:%M:%S"
            ),
            "open": round(cur_open, 6),
            "high": round(cur_high, 6),
            "low": round(cur_low, 6),
            "close": round(cur_close, 6),
            "points": cur_points,
        })

    for point in raw:
        t: int = int(point.get("t", 0))
        p: float = float(point.get("p", 0.0))

        bucket = (t // candle_sec) * candle_sec

        if bucket != cur_bucket:
            _flush(cur_bucket)
            cur_bucket = bucket
            cur_open = p
            cur_high = p
            cur_low = p
            cur_close = p
            cur_points = 1
        else:
            if cur_open is None:
                cur_open = p
            cur_high = max(cur_high, p)
            cur_low = min(cur_low, p)
            cur_close = p
            cur_points += 1

    _flush(cur_bucket)
    return candles


# ── 输出格式化 ────────────────────────────────────────────────────────────────

_CSV_FIELDS = ["open_time", "open_time_iso", "open", "high", "low", "close", "points"]


def _to_json(candles: List[Dict]) -> str:
    return json.dumps(candles, ensure_ascii=False, indent=2)


def _to_csv(candles: List[Dict]) -> str:
    buf = StringIO()
    writer = csv.DictWriter(buf, fieldnames=_CSV_FIELDS, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(candles)
    return buf.getvalue()


def _to_table(candles: List[Dict]) -> str:
    if not candles:
        return "(no data)"
    header = f"{'Open Time (UTC)':<22}  {'Open':>8}  {'High':>8}  {'Low':>8}  {'Close':>8}  {'Pts':>4}"
    sep = "-" * len(header)
    lines = [header, sep]
    for c in candles:
        lines.append(
            f"{c['open_time_iso']:<22}  {c['open']:>8.4f}  {c['high']:>8.4f}"
            f"  {c['low']:>8.4f}  {c['close']:>8.4f}  {c['points']:>4}"
        )
    return "\n".join(lines)


# ── 主流程 ───────────────────────────────────────────────────────────────────

def run_kline(
    token_id: str,
    candle_minutes: int,
    interval: Optional[str] = None,
    start_ts: Optional[int] = None,
    end_ts: Optional[int] = None,
    fidelity: Optional[int] = None,
    fmt: str = "table",
    output_path: Optional[str] = None,
) -> List[Dict]:
    """
    拉取价格历史并聚合为 K 线，返回 candles 列表。
    """
    # 自动推断 fidelity
    effective_fidelity = fidelity
    if effective_fidelity is None and interval:
        effective_fidelity = INTERVAL_DEFAULT_FIDELITY.get(interval, 1)
        print(f"  Auto fidelity: {effective_fidelity} min/point", file=sys.stderr)

    # K 线粒度不能小于原始数据精度
    if effective_fidelity and candle_minutes < effective_fidelity:
        print(
            f"  Warning: candle_minutes ({candle_minutes}) < fidelity ({effective_fidelity}). "
            "K 线粒度不能小于原始数据精度，已自动对齐到 fidelity。",
            file=sys.stderr,
        )
        candle_minutes = effective_fidelity

    raw = fetch_prices_history(
        token_id=token_id,
        interval=interval,
        start_ts=start_ts,
        end_ts=end_ts,
        fidelity=effective_fidelity,
    )

    if not raw:
        print("Warning: 未获取到任何价格数据。", file=sys.stderr)
        return []

    candles = aggregate_to_ohlc(raw, candle_minutes)
    print(
        f"  Aggregated {len(raw)} points → {len(candles)} candles "
        f"({candle_minutes} min each).",
        file=sys.stderr,
    )

    if fmt == "json":
        text = _to_json(candles)
    elif fmt == "csv":
        text = _to_csv(candles)
    else:
        text = _to_table(candles)

    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"  Saved to: {output_path}", file=sys.stderr)
    else:
        print(text)

    return candles


# ── CLI ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Polymarket 市场历史 K 线数据（OHLC）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 通过 Yes token_id，拉取近 1 周数据，聚合为 1 小时 K 线，终端表格输出
  python market_kline.py --token-id <TOKEN_ID> --interval 1w --candle 60

  # 通过市场 slug（查本地 DB），全量历史，1 天 K 线，输出 JSON
  python market_kline.py --slug will-btc-hit-100k --interval max --candle 1440 -o btc.json

  # 指定起止日期，30 分钟 K 线，输出 CSV
  python market_kline.py --token-id <ID> --start 2024-01-01 --end 2025-01-01 --candle 30 -o kline.csv

  # 通过 condition_id，No token，近 1 个月，60 分钟 K 线
  python market_kline.py --condition-id <COND_ID> --outcome no --interval 1m --candle 60
""",
    )

    # 市场定位（三选一）
    id_group = parser.add_mutually_exclusive_group()
    id_group.add_argument(
        "--token-id",
        metavar="TOKEN_ID",
        help="直接指定 Yes 或 No token 的 asset ID（clobTokenIds 中的值）",
    )
    id_group.add_argument(
        "--slug",
        metavar="SLUG",
        help="市场 slug（先查本地 DB，再查 Gamma API）",
    )
    id_group.add_argument(
        "--condition-id",
        metavar="CONDITION_ID",
        help="市场 condition ID（先查本地 DB，再查 Gamma API）",
    )

    parser.add_argument(
        "--outcome",
        choices=["yes", "no"],
        default="yes",
        help="当通过 slug/condition_id 查找时，指定使用 Yes 还是 No token（默认 yes）",
    )

    # 时间范围
    time_group = parser.add_argument_group("时间范围（interval 与 start/end 二选一）")
    time_group.add_argument(
        "--interval",
        choices=VALID_INTERVALS,
        default="1w",
        help="预设时间范围（默认 1w）：max/all=全量 | 1m=近1月 | 1w=近1周 | 1d=近1天 | 6h/1h",
    )
    time_group.add_argument(
        "--start",
        metavar="YYYY-MM-DD",
        help="自定义起始日期（指定此项时 --interval 中的时间范围被忽略）",
    )
    time_group.add_argument(
        "--end",
        metavar="YYYY-MM-DD",
        default=None,
        help="自定义结束日期（默认为当前时间）",
    )

    # 精度与 K 线粒度
    parser.add_argument(
        "--fidelity",
        type=int,
        default=None,
        metavar="MINUTES",
        help="原始数据精度（分钟/点，默认按 interval 自动推断）：1=1分钟，60=1小时，1440=1天",
    )
    parser.add_argument(
        "--candle",
        type=int,
        default=None,
        metavar="MINUTES",
        help="K 线粒度（分钟，默认等于 fidelity）：60=1小时线，1440=日线",
    )

    # DB 路径（slug/condition_id 查找时可选）
    parser.add_argument(
        "--db",
        default=None,
        metavar="DB_PATH",
        help="本地数据库路径（用于 slug/condition_id 快速查找 token_id，不填则直接查 Gamma API）",
    )

    # 输出
    parser.add_argument(
        "--format",
        choices=["table", "json", "csv"],
        default="table",
        help="输出格式（默认 table）",
    )
    parser.add_argument(
        "-o", "--output",
        metavar="FILE",
        default=None,
        help="输出到文件（扩展名 .json 或 .csv，会自动推断格式）",
    )

    args = parser.parse_args()

    if not args.token_id and not args.slug and not args.condition_id:
        parser.print_help()
        sys.exit(1)

    # 推断输出格式
    fmt = args.format
    if args.output:
        if args.output.endswith(".json"):
            fmt = "json"
        elif args.output.endswith(".csv"):
            fmt = "csv"

    # 解析时间范围
    start_ts: Optional[int] = None
    end_ts: Optional[int] = None
    interval: Optional[str] = args.interval

    if args.start:
        try:
            start_ts = int(
                datetime.strptime(args.start, "%Y-%m-%d")
                .replace(tzinfo=timezone.utc)
                .timestamp()
            )
            interval = None  # 指定了 start，忽略 interval 的预设范围
        except ValueError:
            print(f"Error: --start 格式错误，应为 YYYY-MM-DD（如 2024-01-01）", file=sys.stderr)
            sys.exit(1)

    if args.end:
        try:
            end_ts = int(
                datetime.strptime(args.end, "%Y-%m-%d")
                .replace(tzinfo=timezone.utc)
                .timestamp()
            )
        except ValueError:
            print(f"Error: --end 格式错误，应为 YYYY-MM-DD（如 2025-01-01）", file=sys.stderr)
            sys.exit(1)

    # 确定原始数据精度
    fidelity = args.fidelity

    # 确定 K 线粒度（默认等于 fidelity，或 interval 推断的 fidelity）
    candle_minutes = args.candle
    if candle_minutes is None:
        if fidelity is not None:
            candle_minutes = fidelity
        elif interval:
            candle_minutes = INTERVAL_DEFAULT_FIDELITY.get(interval, 1)
        else:
            candle_minutes = 60  # fallback

    # 解析 token_id
    token_id = resolve_token_id(
        token_id=args.token_id,
        slug=args.slug,
        condition_id=args.condition_id,
        outcome=args.outcome,
        db_path=args.db,
    )

    print(
        f"Market K-Line: token={token_id[:16]}...  candle={candle_minutes}min"
        + (f"  interval={interval}" if interval else f"  start={args.start}  end={args.end or 'now'}"),
        file=sys.stderr,
    )

    run_kline(
        token_id=token_id,
        candle_minutes=candle_minutes,
        interval=interval,
        start_ts=start_ts,
        end_ts=end_ts,
        fidelity=fidelity,
        fmt=fmt,
        output_path=args.output,
    )


if __name__ == "__main__":
    main()
