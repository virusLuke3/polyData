#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
阶段二 - 任务 A: Market Discovery Service

功能：从 Gamma API 发现新市场，校验链上参数，存储到数据库
定期运行以捕获新上线的市场，为 Trades Indexer 提供市场清单。
"""

import json
import sys
import time
import argparse
from datetime import datetime, timezone
from typing import List, Dict, Optional, Tuple, Any

try:
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
except ImportError:
    print("Error: requests not installed. pip install requests")
    sys.exit(1)

# 保证 scripts 根目录在 path 中
import sys
from pathlib import Path
_scripts_root = Path(__file__).resolve().parent.parent
if str(_scripts_root) not in sys.path:
    sys.path.insert(0, str(_scripts_root))

# 引入阶段一模块
from db import get_db, get_connection, init_schema, DEFAULT_DB_PATH
try:
    from .market_decoder import (
        calculate_market_tokens,
        GAMMA_API_BASE,
        USDC_E_ADDRESS,
    )
except ImportError:
    # 直接运行脚本时无父包，将 market 目录加入 path
    _market_dir = Path(__file__).resolve().parent
    if str(_market_dir) not in sys.path:
        sys.path.insert(0, str(_market_dir))
    from market_decoder import (
        calculate_market_tokens,
        GAMMA_API_BASE,
        USDC_E_ADDRESS,
    )

# Gamma API
GAMMA_MARKETS_URL = f"{GAMMA_API_BASE}/markets"
GAMMA_EVENTS_URL = f"{GAMMA_API_BASE}/events"

# 默认请求间隔（秒）
DEFAULT_REQUESTS_DELAY = 0.7
# 重试次数与指数退避基数
MAX_RETRIES = 5
RETRY_BASE_DELAY = 2

SYNC_KEY_CLOSED_EVENTS_OFFSET = "closed_events_offset"


def _create_session() -> requests.Session:
    """创建可复用连接的 Session，减轻长运行时的连接池耗尽与 SSL 断连"""
    session = requests.Session()
    retries = Retry(
        total=MAX_RETRIES,
        backoff_factor=RETRY_BASE_DELAY,
        status_forcelist=[500, 502, 503, 504],
    )
    adapter = HTTPAdapter(max_retries=retries, pool_connections=10, pool_maxsize=10)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


# 模块级 Session，复用 TCP 连接，避免每次 requests.get 重新握手
_HTTP_SESSION: Optional[requests.Session] = None


def _get_session() -> requests.Session:
    global _HTTP_SESSION
    if _HTTP_SESSION is None:
        _HTTP_SESSION = _create_session()
    return _HTTP_SESSION


def _fetch_with_retry(
    url: str,
    params: Dict,
    max_retries: int = MAX_RETRIES,
    base_delay: float = RETRY_BASE_DELAY,
) -> Any:
    """带指数退避的 API 请求，失败时重试。使用 Session 复用连接，减轻 SSL 断连。"""
    session = _get_session()
    last_err = None
    for attempt in range(max_retries):
        try:
            resp = session.get(url, params=params, timeout=60)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            last_err = e
            if attempt < max_retries - 1:
                delay = base_delay ** (attempt + 1)
                print(f"  Retry {attempt + 1}/{max_retries} in {delay}s: {e}", file=sys.stderr)
                time.sleep(delay)
    raise last_err


def _load_existing_condition_ids(conn) -> set:
    """从 DB 加载已有市场的 condition_id，用于去重"""
    cur = conn.cursor()
    cur.execute("SELECT condition_id FROM markets")
    return {row[0] for row in cur.fetchall()}


def _get_closed_events_offset(conn) -> Optional[int]:
    """获取上次 closed events 同步到的 offset，0 或空表示从头开始"""
    cur = conn.cursor()
    cur.execute("SELECT value FROM sync_state WHERE key = ?", (SYNC_KEY_CLOSED_EVENTS_OFFSET,))
    row = cur.fetchone()
    if not row or row[0] is None:
        return None
    val = int(row[0])
    return val if val > 0 else None  # 0 表示已完成，下次从头


def _save_closed_events_offset(conn, offset: int) -> None:
    """保存 closed events 同步进度"""
    cur = conn.cursor()
    cur.execute(
        "INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)",
        (SYNC_KEY_CLOSED_EVENTS_OFFSET, str(offset), datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()


def fetch_all_markets(
    limit: int = 500, active_only: bool = False, closed_only: bool = False
) -> List[Dict]:
    """
    从 Gamma API 获取市场列表

    Args:
        limit: 最大获取数量
        active_only: 是否仅获取活跃市场
        closed_only: 是否仅获取已结束市场（closed=true）

    Returns:
        市场列表
    """
    url = GAMMA_MARKETS_URL
    params = {
        "limit": min(limit, 100),
        "ascending": "false",
    }
    if active_only:
        params["active"] = "true"
        params["closed"] = "false"
        params["order"] = "volume24hr"
    else:
        params["order"] = "volume24hr"

    # closed_only 需走 events 接口，markets 不支持 closed
    if closed_only:
        return fetch_closed_markets(limit=limit)

    all_markets = []
    offset = 0
    session = _get_session()
    while len(all_markets) < limit:
        params["offset"] = offset
        try:
            resp = session.get(url, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            print(f"Error fetching markets: {e}", file=sys.stderr)
            break
        
        if isinstance(data, list):
            batch = data
        elif isinstance(data, dict) and "markets" in data:
            batch = data["markets"]
        else:
            batch = []
        
        if not batch:
            break
        all_markets.extend(batch)
        offset += len(batch)
        if len(batch) < 100:
            break
    
    return all_markets[:limit]


def _parse_iso_date(s: Optional[str]) -> Optional[datetime]:
    """解析 ISO 日期字符串为 datetime，失败返回 None"""
    if not s:
        return None
    try:
        clean = str(s).split(".")[0].split("+")[0].replace("Z", "").strip()
        return datetime.fromisoformat(clean).replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _flush_buffer_to_db(
    buffer: List[Dict],
    conn,
    total_written: int,
    batch_size: int,
) -> Tuple[List[Dict], int]:
    """将 buffer 规范化后批量写入 DB，清空 buffer。返回 (空 buffer, 新的 total_written)"""
    if not buffer:
        return buffer, total_written
    norms = []
    for m in buffer:
        n = normalize_market_from_gamma(m)
        if n:
            norms.append(n)
    if norms:
        batch_upsert_markets(conn, norms)
        total_written += len(norms)
        print(f"  ... wrote {len(norms)} markets to DB (total {total_written})", file=sys.stderr)
    return [], total_written


def fetch_markets_since_date(
    since_date: datetime,
    include_active: bool = True,
    include_closed: bool = True,
    db_path: Optional[str] = None,
    batch_size: int = 500,
    requests_delay: float = DEFAULT_REQUESTS_DELAY,
) -> Tuple[List[Dict], int]:
    """
    从指定起始日期向后爬取市场，按时间排序，不设 limit。
    同时拉取活跃和已关闭市场。若指定 db_path，则每 batch_size 个写入 DB 一次（去重由 ON CONFLICT 保证）。

    Args:
        since_date: 起始日期（含），只保留 created_at >= since_date 的市场
        include_active: 是否包含活跃市场
        include_closed: 是否包含已关闭市场
        db_path: 若指定，每 batch_size 个市场写入数据库
        batch_size: 每批写入数量，默认 500

    Returns:
        (市场列表用于 JSON 输出，总写入数)。当 db_path 指定时列表为空，仅返回计数
    """
    if not include_active and not include_closed:
        return [], 0

    buffer: List[Dict] = []
    all_markets: List[Dict] = []
    seen_ids: set = set()
    total_written = 0
    conn = None
    if db_path:
        init_schema(db_path=db_path)
        conn = get_connection(db_path)
        # 加载已有 condition_id，避免与已入库数据重复
        existing = _load_existing_condition_ids(conn)
        seen_ids.update(existing)
        if existing:
            print(f"  Loaded {len(existing)} existing markets from DB (will skip duplicates)", file=sys.stderr)

    def _add_market(m: Dict) -> None:
        nonlocal buffer, total_written
        cid = m.get("conditionId")
        if not cid or cid in seen_ids:
            return
        created = _parse_iso_date(m.get("createdAt") or m.get("created_at"))
        if created is None or created < since_date:
            return
        seen_ids.add(cid)
        if conn is not None:
            buffer.append(m)
            if len(buffer) >= batch_size:
                buffer, total_written = _flush_buffer_to_db(buffer, conn, total_written, batch_size)
        else:
            all_markets.append(m)

    try:
        # 1. 从 /markets 拉取
        params = {
            "limit": 100,
            "order": "createdAt",
            "ascending": "false",
        }
        offset = 0
        stopped_markets = False

        while True:
            params["offset"] = offset
            time.sleep(requests_delay)
            try:
                batch = _fetch_with_retry(GAMMA_MARKETS_URL, dict(params))
            except Exception as e:
                print(f"Error fetching markets (offset={offset}): {e}", file=sys.stderr)
                break

            if not isinstance(batch, list):
                batch = batch.get("markets", []) if isinstance(batch, dict) else []

            if not batch:
                break

            for m in batch:
                created = _parse_iso_date(m.get("createdAt") or m.get("created_at"))
                if created is None:
                    _add_market(m)
                    continue
                if created < since_date:
                    stopped_markets = True
                    break
                _add_market(m)
            if stopped_markets:
                break

            offset += len(batch)
            batch_len = len(batch)
            if batch_len < 100:
                break
            collected = total_written + len(buffer) if conn else len(all_markets)
            if offset % 500 == 0 and offset > 0:
                print(f"  ... fetched {offset} from /markets, collected {collected}", file=sys.stderr)
            del batch  # 及时释放，减轻长运行时的内存占用

        # 2. 从 /events?closed=true 补充已关闭市场（支持断点续传）
        if include_closed and conn is not None:
            ev_params = {
                "limit": 100,
                "closed": "true",
                "order": "volume",
                "ascending": "false",
            }
            ev_offset = _get_closed_events_offset(conn)
            if ev_offset is not None and ev_offset > 0:
                print(f"  Resuming closed events from offset {ev_offset}", file=sys.stderr)

            while True:
                ev_params["offset"] = ev_offset
                time.sleep(requests_delay)
                try:
                    events = _fetch_with_retry(GAMMA_EVENTS_URL, dict(ev_params))
                except Exception as e:
                    print(f"Error fetching closed events (offset={ev_offset}): {e}", file=sys.stderr)
                    _save_closed_events_offset(conn, ev_offset)
                    print(f"  Saved progress at offset {ev_offset}. Re-run to resume.", file=sys.stderr)
                    break

                if not events or not isinstance(events, list):
                    _save_closed_events_offset(conn, 0)  # 标记完成
                    break

                for ev in events:
                    for m in ev.get("markets", []):
                        m["_event_neg_risk"] = ev.get("negRisk", len(ev.get("markets", [])) > 1)
                        m["_event_slug"] = ev.get("slug", ev.get("ticker", ""))
                        _add_market(m)

                ev_offset += len(events)
                _save_closed_events_offset(conn, ev_offset)
                events_count = len(events)
                if events_count < 100:
                    _save_closed_events_offset(conn, 0)  # 标记完成
                    break
                collected = total_written + len(buffer) if conn else len(all_markets)
                if ev_offset % 500 == 0 and ev_offset > 0:
                    print(f"  ... fetched {ev_offset} closed events, total {collected}", file=sys.stderr)
                del events  # 及时释放
        elif include_closed and conn is None:
            # 无 db 时仍拉取 closed events 到 all_markets（用于 JSON 输出）
            ev_params = {
                "limit": 100,
                "closed": "true",
                "order": "volume",
                "ascending": "false",
            }
            ev_offset = 0
            while True:
                ev_params["offset"] = ev_offset
                time.sleep(requests_delay)
                try:
                    events = _fetch_with_retry(GAMMA_EVENTS_URL, dict(ev_params))
                except Exception as e:
                    print(f"Error fetching closed events (offset={ev_offset}): {e}", file=sys.stderr)
                    break
                if not events or not isinstance(events, list):
                    break
                for ev in events:
                    for m in ev.get("markets", []):
                        m["_event_neg_risk"] = ev.get("negRisk", len(ev.get("markets", [])) > 1)
                        m["_event_slug"] = ev.get("slug", ev.get("ticker", ""))
                        _add_market(m)
                ev_offset += len(events)
                if len(events) < 100:
                    break
                del events

        # 写入剩余 buffer
        if conn and buffer:
            buffer, total_written = _flush_buffer_to_db(buffer, conn, total_written, batch_size)

        if conn:
            conn.close()
            conn = None

        if all_markets:
            def _sort_key(m: Dict) -> datetime:
                d = _parse_iso_date(m.get("createdAt") or m.get("created_at"))
                return d or datetime.min.replace(tzinfo=timezone.utc)

            all_markets.sort(key=_sort_key)
            return all_markets, total_written
        return [], total_written
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def _run_closed_events_only(
    db_path: str,
    batch_size: int = 500,
    start_offset: Optional[int] = None,
    requests_delay: float = DEFAULT_REQUESTS_DELAY,
    cooldown_every: Optional[int] = None,
    cooldown_seconds: float = 60,
    max_fetches: Optional[int] = None,
    since_date: Optional[datetime] = None,
) -> int:
    """仅补充拉取 closed events，支持断点续传、周期性冷却与分批上限。可选 since_date 过滤 created_at。"""
    init_schema(db_path=db_path)
    conn = get_connection(db_path)
    seen_ids = set(_load_existing_condition_ids(conn))
    print(f"  Loaded {len(seen_ids)} existing markets from DB (will skip duplicates)", file=sys.stderr)

    buffer: List[Dict] = []
    total_written = 0
    ev_offset = start_offset if start_offset is not None else _get_closed_events_offset(conn)
    ev_offset = ev_offset if ev_offset is not None and ev_offset > 0 else 0
    if ev_offset > 0:
        print(f"  Resuming closed events from offset {ev_offset}", file=sys.stderr)
    else:
        print(f"  Starting closed events fetch from offset 0", file=sys.stderr)
    if since_date is not None:
        print(f"  Filter: only markets with created_at >= {since_date.date()}", file=sys.stderr)

    def _add_market(m: Dict) -> None:
        nonlocal buffer, total_written
        cid = m.get("conditionId")
        if not cid or cid in seen_ids:
            return
        if since_date is not None:
            created = _parse_iso_date(m.get("createdAt") or m.get("created_at"))
            if created is not None and created < since_date:
                return  # 跳过早于 since_date 的市场
        seen_ids.add(cid)
        buffer.append(m)
        if len(buffer) >= batch_size:
            buffer, total_written = _flush_buffer_to_db(buffer, conn, total_written, batch_size)

    ev_params = {
        "limit": 100,
        "closed": "true",
        "order": "volume",
        "ascending": "false",
    }

    fetch_count = 0

    try:
        while True:
            if max_fetches is not None and fetch_count >= max_fetches:
                _save_closed_events_offset(conn, ev_offset)
                print(
                    f"  Reached --max-fetches {max_fetches}. Saved offset {ev_offset}. Re-run to resume.",
                    file=sys.stderr,
                )
                break

            ev_params["offset"] = ev_offset
            time.sleep(requests_delay)
            try:
                events = _fetch_with_retry(GAMMA_EVENTS_URL, dict(ev_params))
            except Exception as e:
                print(f"Error fetching closed events (offset={ev_offset}): {e}", file=sys.stderr)
                _save_closed_events_offset(conn, ev_offset)
                print(f"  Saved progress at offset {ev_offset}. Re-run with --closed-events-only to resume.", file=sys.stderr)
                return total_written

            fetch_count += 1

            if cooldown_every is not None and cooldown_seconds > 0 and fetch_count % cooldown_every == 0 and fetch_count > 0:
                print(
                    f"  Cooldown: sleeping {cooldown_seconds}s after {fetch_count} fetches...",
                    file=sys.stderr,
                )
                time.sleep(cooldown_seconds)

            if not events or not isinstance(events, list):
                _save_closed_events_offset(conn, 0)
                break

            for ev in events:
                for m in ev.get("markets", []):
                    m["_event_neg_risk"] = ev.get("negRisk", len(ev.get("markets", [])) > 1)
                    m["_event_slug"] = ev.get("slug", ev.get("ticker", ""))
                    _add_market(m)

            ev_offset += len(events)
            _save_closed_events_offset(conn, ev_offset)
            if len(events) < 100:
                _save_closed_events_offset(conn, 0)
                break
            if ev_offset % 500 == 0 and ev_offset > 0:
                print(f"  ... fetched {ev_offset} closed events, total {total_written + len(buffer)}", file=sys.stderr)
            del events

        if buffer:
            _, total_written = _flush_buffer_to_db(buffer, conn, total_written, batch_size)
        print(f"Done. Wrote {total_written} new closed-event markets.", file=sys.stderr)
        return total_written
    finally:
        conn.close()


def fetch_closed_markets(limit: int = 500) -> List[Dict]:
    """
    通过 /events?closed=true 获取已结束市场（/markets 不支持 closed 参数）

    Args:
        limit: 最大获取市场数量

    Returns:
        市场列表（从 events 中扁平化 markets）
    """
    url = GAMMA_EVENTS_URL
    params = {
        "limit": 100,
        "closed": "true",
        "order": "volume",  # closed_time 在 closed=true 时易 422，改用 volume
        "ascending": "false",
    }
    all_markets: List[Dict] = []
    offset = 0

    session = _get_session()
    while len(all_markets) < limit:
        params["offset"] = offset
        try:
            resp = session.get(url, params=params, timeout=30)
            resp.raise_for_status()
            events = resp.json()
        except Exception as e:
            print(f"Error fetching closed events: {e}", file=sys.stderr)
            break

        if not events or not isinstance(events, list):
            break

        for ev in events:
            markets = ev.get("markets", [])
            neg_risk = ev.get("negRisk", len(markets) > 1)
            for m in markets:
                m["_event_neg_risk"] = neg_risk
                m["_event_slug"] = ev.get("slug", ev.get("ticker", ""))
                all_markets.append(m)
            if len(all_markets) >= limit:
                break

        offset += len(events)
        if len(events) < 100:
            break

    return all_markets[:limit]


def fetch_markets_by_event_slug(event_slug: str) -> List[Dict]:
    """
    按事件 slug 获取该事件下的所有市场
    
    Args:
        event_slug: 事件 slug
    
    Returns:
        市场列表
    """
    url = GAMMA_EVENTS_URL
    params = {"slug": event_slug}
    try:
        resp = _get_session().get(url, params=params, timeout=30)
        resp.raise_for_status()
        events = resp.json()
    except Exception as e:
        print(f"Error fetching event: {e}", file=sys.stderr)
        return []
    
    if not events or not isinstance(events, list):
        return []
    
    event = events[0]
    markets = event.get("markets", [])
    neg_risk = event.get("negRisk", len(markets) > 1)
    
    for m in markets:
        m["_event_neg_risk"] = neg_risk
        m["_event_slug"] = event_slug
    
    return markets


def normalize_market_from_gamma(m: Dict) -> Optional[Dict]:
    """
    从 Gamma API 市场数据中提取并规范化字段

    策略说明：
    - 缺失 questionId/oracle 的市场静默过滤（Strategy B）
    - NegRisk 市场直接采信 Gamma 的 clobTokenIds（Strategy A）
    - 标准二元市场优先使用本地计算，与 API 校验
    """
    condition_id = m.get("conditionId")
    if not condition_id:
        return None

    # Strategy B: 缺失关键字段的市场静默过滤，不输出警告
    question_id = m.get("questionID") or m.get("questionId")
    oracle = m.get("oracle")
    if isinstance(oracle, dict):
        oracle = oracle.get("address")
    if not oracle:
        oracle = m.get("resolvedBy")

    if not question_id or not oracle:
        return None

    clob_token_ids = m.get("clobTokenIds", [])
    if isinstance(clob_token_ids, str):
        try:
            clob_token_ids = json.loads(clob_token_ids)
        except Exception:
            clob_token_ids = []

    tokens = m.get("tokens", [])
    if tokens and not clob_token_ids:
        clob_token_ids = [t.get("tokenId") for t in tokens if t.get("tokenId")]

    is_neg_risk = m.get("_event_neg_risk", False) or m.get("negRisk", False)

    # Strategy A：只要有 clobTokenIds 就优先采用，避免 conditionId/oracle 不匹配产生的 warning
    # 原因：Gamma 的 resolvedBy 常非 conditionId 公式中的 oracle，导致本地计算 conditionId 不一致；
    # 链上交易实际使用 clobTokenIds，采信 API 可保证与 trades indexer 匹配正确
    if clob_token_ids and len(clob_token_ids) >= 2:
        yes_token = str(clob_token_ids[0])
        no_token = str(clob_token_ids[1])
    else:
        try:
            calculated = calculate_market_tokens(
                condition_id=condition_id,
                oracle=oracle,
                question_id=question_id,
                outcome_slot_count=2,
                collateral_token=USDC_E_ADDRESS,
            )
        except Exception:
            return None
        yes_token = str(calculated["yesTokenId"])
        no_token = str(calculated["noTokenId"])

    slug = m.get("slug") or f"market-{condition_id[:16]}"
    created_at = m.get("createdAt") or m.get("created_at")
    end_date = m.get("endDate") or m.get("end_date")

    # category: 领域分类，如 Politics, Sports, Crypto
    category = m.get("category") or ""
    if isinstance(category, dict):
        category = category.get("slug", "") or category.get("label", "") or ""

    # tags: 标签列表，从 market 或 events 提取
    tags_raw = m.get("tags")
    if tags_raw is None and m.get("events"):
        ev = m["events"][0] if m["events"] else {}
        tags_raw = ev.get("tags")
    tags = []
    if isinstance(tags_raw, list):
        for t in tags_raw:
            if isinstance(t, dict):
                tags.append(t.get("slug") or t.get("label") or str(t))
            else:
                tags.append(str(t))
    elif tags_raw:
        tags = [str(tags_raw)]

    return {
        "slug": slug,
        "condition_id": condition_id,
        "question_id": question_id,
        "oracle": oracle,
        "yes_token_id": yes_token,
        "no_token_id": no_token,
        "title": m.get("question", ""),
        "description": m.get("description", ""),
        "enable_neg_risk": 1 if is_neg_risk else 0,
        "end_date": end_date,
        "created_at": created_at,
        "category": category,
        "tags": tags,
    }


def batch_upsert_markets(conn, markets: List[Dict]) -> int:
    """
    批量插入或更新市场记录，condition_id 唯一，自动去重。
    使用 executemany 一次提交，减轻 DB IO 压力。
    Returns:
        成功写入的数量
    """
    if not markets:
        return 0
    rows = []
    for market in markets:
        tags_json = json.dumps(market.get("tags", []) or [])
        rows.append((
            market["slug"],
            market["condition_id"],
            market["question_id"],
            market["oracle"],
            market["yes_token_id"],
            market["no_token_id"],
            market["title"],
            market["description"],
            market["enable_neg_risk"],
            market["end_date"],
            market["created_at"],
            market.get("category", "") or "",
            tags_json,
        ))
    cursor = conn.cursor()
    cursor.executemany(
        """
        INSERT INTO markets (
            slug, condition_id, question_id, oracle,
            yes_token_id, no_token_id, title, description,
            enable_neg_risk, end_date, created_at, category, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(condition_id) DO UPDATE SET
            slug=excluded.slug,
            question_id=excluded.question_id,
            oracle=excluded.oracle,
            yes_token_id=excluded.yes_token_id,
            no_token_id=excluded.no_token_id,
            title=excluded.title,
            description=excluded.description,
            enable_neg_risk=excluded.enable_neg_risk,
            end_date=excluded.end_date,
            created_at=excluded.created_at,
            category=excluded.category,
            tags=excluded.tags
        """,
        rows,
    )
    conn.commit()
    return len(markets)


def upsert_market(conn, market: Dict) -> int:
    """
    插入或更新市场记录，返回 market_id
    不存储 collateral_token、status、updated_at；存储 category、tags
    """
    tags_json = json.dumps(market.get("tags", []) or [])
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO markets (
            slug, condition_id, question_id, oracle,
            yes_token_id, no_token_id, title, description,
            enable_neg_risk, end_date, created_at, category, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(condition_id) DO UPDATE SET
            slug=excluded.slug,
            question_id=excluded.question_id,
            oracle=excluded.oracle,
            yes_token_id=excluded.yes_token_id,
            no_token_id=excluded.no_token_id,
            title=excluded.title,
            description=excluded.description,
            enable_neg_risk=excluded.enable_neg_risk,
            end_date=excluded.end_date,
            created_at=excluded.created_at,
            category=excluded.category,
            tags=excluded.tags
        """,
        (
            market["slug"],
            market["condition_id"],
            market["question_id"],
            market["oracle"],
            market["yes_token_id"],
            market["no_token_id"],
            market["title"],
            market["description"],
            market["enable_neg_risk"],
            market["end_date"],
            market["created_at"],
            market.get("category", "") or "",
            tags_json,
        ),
    )
    conn.commit()
    cursor.execute("SELECT id FROM markets WHERE condition_id = ?", (market["condition_id"],))
    row = cursor.fetchone()
    return row[0] if row else 0


def estimate_full_markets(
    active_only: bool = False, closed_only: bool = False, max_pages: Optional[int] = None
) -> Dict:
    """
    全量分页拉取 Gamma API，统计市场总数及经 normalize 后保留数量，
    并估算存入 SQLite 后的 DB 大小。

    Args:
        active_only: 是否只统计活跃市场
        closed_only: 是否只统计已结束市场
        max_pages: 最多拉取页数，None 表示不限

    Returns:
        {"total_raw": int, "total_normalized": int, "db_size_mb": float, "pages": int, "extrapolated": bool}
    """
    params: Dict = {
        "limit": 100,
        "ascending": "false",
    }
    if active_only:
        params["active"] = "true"
        params["closed"] = "false"
        params["order"] = "volume24hr"
    elif closed_only:
        params["closed"] = "true"
        params["order"] = "volume"  # closed_time 易 422
    else:
        params["order"] = "volume24hr"

    # closed_only 必须用 events 接口
    api_url = GAMMA_EVENTS_URL if closed_only else GAMMA_MARKETS_URL

    total_raw = 0
    total_normalized = 0
    pages = 0
    sample_sizes: List[int] = []  # 用于估算单条记录大小
    extrapolated = False

    offset = 0
    while True:
        if max_pages is not None and pages >= max_pages:
            extrapolated = True
            break
        params["offset"] = offset
        ok = False
        session = _get_session()
        for attempt in range(3):
            try:
                resp = session.get(api_url, params=params, timeout=30)
                resp.raise_for_status()
                data = resp.json()
                ok = True
                break
            except Exception as e:
                if attempt < 2:
                    print(f"  Retry {attempt + 1}/2 after: {e}", file=sys.stderr)
                else:
                    print(f"Error during estimate: {e}", file=sys.stderr)
        if not ok:
            break

        events_list: List[Dict] = []
        if closed_only:
            # events 返回事件列表，需扁平化 markets
            events_list = data if isinstance(data, list) else []
            batch = []
            for ev in events_list:
                for m in ev.get("markets", []):
                    m["_event_neg_risk"] = ev.get("negRisk", len(ev.get("markets", [])) > 1)
                    m["_event_slug"] = ev.get("slug", ev.get("ticker", ""))
                    batch.append(m)
        else:
            if isinstance(data, list):
                batch = data
            elif isinstance(data, dict) and "markets" in data:
                batch = data["markets"]
            else:
                batch = []

        if not batch:
            break

        total_raw += len(batch)
        pages += 1

        for m in batch:
            norm = normalize_market_from_gamma(m)
            if norm:
                total_normalized += 1
                # 仅采样前若干条用于大小估算
                if len(sample_sizes) < 50:
                    sample_sizes.append(
                        sum(len(str(v) or "") for v in norm.values()) + 200
                    )

        offset += len(batch)
        if pages % 10 == 0 and pages > 0:
            print(f"  ... {pages} pages, {total_raw} raw, {total_normalized} normalized", file=sys.stderr)
        page_size = len(events_list) if closed_only else len(batch)
        offset += page_size
        if page_size < 100:
            break

    avg_bytes = int(sum(sample_sizes) / len(sample_sizes)) if sample_sizes else 1200
    db_bytes = total_normalized * avg_bytes
    db_size_mb = round(db_bytes / (1024 * 1024), 2)

    return {
        "total_raw": total_raw,
        "total_normalized": total_normalized,
        "db_size_mb": db_size_mb,
        "pages": pages,
        "extrapolated": extrapolated,
    }


def run_market_discovery(
    db_path: Optional[str] = None,
    output_json: Optional[str] = None,
    limit: int = 500,
    active_only: bool = False,
    closed_only: bool = False,
    event_slugs: Optional[List[str]] = None,
    since_date: Optional[datetime] = None,
    batch_size: int = 500,
    closed_events_only: bool = False,
    closed_events_start_offset: Optional[int] = None,
    requests_delay: float = DEFAULT_REQUESTS_DELAY,
    cooldown_every: Optional[int] = None,
    cooldown_seconds: float = 60,
    max_fetches: Optional[int] = None,
) -> int:
    """
    执行市场发现流程

    - 若指定 since_date：从该日期起按时间向后爬取，不限 limit，拉取活跃+已关闭
    - 若指定 db_path：写入数据库；since_date 时每 batch_size 个市场写入一次（去重）
    - 否则：保存为 JSON 文件（output_json 路径，默认 market_discovery.json）

    Returns:
        成功处理的市场数量
    """
    markets_to_process: List[Dict] = []
    pre_written = 0

    if closed_events_only:
        if not db_path:
            print("Error: --closed-events-only requires --db", file=sys.stderr)
            return 0
        return _run_closed_events_only(
            db_path=db_path,
            batch_size=batch_size,
            start_offset=closed_events_start_offset,
            requests_delay=requests_delay,
            cooldown_every=cooldown_every,
            cooldown_seconds=cooldown_seconds,
            max_fetches=max_fetches,
            since_date=since_date,
        )

    if since_date is not None:
        markets_to_process, pre_written = fetch_markets_since_date(
            since_date=since_date,
            include_active=True,
            include_closed=True,
            db_path=db_path,
            batch_size=batch_size,
            requests_delay=requests_delay,
        )
        total = pre_written + len(markets_to_process)
        print(f"Fetched {total} markets since {since_date.date()}", file=sys.stderr)
        if db_path and pre_written > 0:
            # 已分批写入 DB，仅需处理剩余的 JSON 输出（若指定）
            if not output_json:
                return pre_written
    else:
        if event_slugs:
            for slug in event_slugs:
                ms = fetch_markets_by_event_slug(slug)
                markets_to_process.extend(ms)

        if not event_slugs or limit > len(markets_to_process):
            ms = fetch_all_markets(
                limit=limit, active_only=active_only, closed_only=closed_only
            )
            seen = {m.get("conditionId") for m in markets_to_process}
            for m in ms:
                if m.get("conditionId") not in seen:
                    markets_to_process.append(m)

    norms: List[Dict] = []
    for m in markets_to_process:
        norm = normalize_market_from_gamma(m)
        if norm:
            norms.append(norm)

    if db_path and pre_written == 0:
        init_schema(db_path=db_path)
        with get_db(db_path) as conn:
            batch_upsert_markets(conn, norms)
    elif not db_path or output_json:
        out_path = output_json or "market_discovery.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(norms, f, ensure_ascii=False, indent=2)
        print(f"Results saved to: {out_path}", file=sys.stderr)

    return pre_written + len(norms)


def main():
    parser = argparse.ArgumentParser(description="Polymarket Market Discovery Service")
    parser.add_argument("--db", default=None, help="数据库路径；不指定则输出为 JSON 文件")
    parser.add_argument("--output", "-o", help="JSON 输出路径（仅在未指定 --db 时生效，默认 market_discovery.json）")
    parser.add_argument("--limit", type=int, default=500, help="最多获取市场数（仅在未使用 --since-date 时生效）")
    parser.add_argument("--active-only", action="store_true", help="仅获取活跃市场（与 --since-date 互斥时被忽略）")
    parser.add_argument("--closed-only", action="store_true", help="仅获取已结束市场（与 --since-date 互斥时被忽略）")
    parser.add_argument(
        "--since-date",
        default=None,
        metavar="YYYY-MM-DD",
        help="从该日期起向后爬取市场，按时间排序，不设 limit；同时拉取活跃和已关闭市场。例：2024-09-01",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="与 --since-date 和 --db 联用：每批写入数据库的市场数量（默认 500）",
    )
    parser.add_argument(
        "--closed-events-only",
        action="store_true",
        help="仅补充拉取 closed events，用于断点续传；需同时指定 --db",
    )
    parser.add_argument(
        "--closed-events-start-offset",
        type=int,
        default=None,
        help="与 --closed-events-only 联用：从指定 offset 开始（用于手动指定断点）",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=None,
        metavar="SECONDS",
        help="每次 API 请求前的间隔（秒），默认 0.7；加大可减轻服务器压力",
    )
    parser.add_argument(
        "--cooldown-every",
        type=int,
        default=None,
        metavar="N",
        help="与 --closed-events-only 联用：每 N 次请求后冷却一次",
    )
    parser.add_argument(
        "--cooldown-seconds",
        type=float,
        default=60,
        metavar="SECONDS",
        help="与 --cooldown-every 联用：冷却时长（秒），默认 60",
    )
    parser.add_argument(
        "--max-fetches",
        type=int,
        default=None,
        metavar="N",
        help="与 --closed-events-only 联用：最多请求 N 次后停止并保存进度，可多次运行分批完成",
    )
    parser.add_argument(
        "--event-slugs",
        nargs="*",
        help="指定事件 slug 列表，如 fed-decision-in-january",
    )
    parser.add_argument(
        "--estimate",
        action="store_true",
        help="全量分页拉取并估算市场总数与 DB 大小，不写入文件",
    )
    parser.add_argument(
        "--estimate-max-pages",
        type=int,
        default=None,
        help="与 --estimate 联用：最多拉取页数，用于快速抽样（默认不限）",
    )

    args = parser.parse_args()

    if args.estimate:
        print("Estimating full market count and DB size...", file=sys.stderr)
        result = estimate_full_markets(
            active_only=args.active_only,
            closed_only=args.closed_only,
            max_pages=args.estimate_max_pages,
        )
        ext = " (抽样外推)" if result.get("extrapolated") else ""
        print(
            f"Total raw markets (API): {result['total_raw']}\n"
            f"Total normalized (stored): {result['total_normalized']}\n"
            f"API pages: {result['pages']}\n"
            f"Estimated DB size: ~{result['db_size_mb']} MB{ext}",
            file=sys.stderr,
        )
        return

    if args.active_only and args.closed_only:
        print("Error: --active-only and --closed-only cannot be used together.", file=sys.stderr)
        sys.exit(1)

    since_date = None
    if args.since_date:
        try:
            since_date = datetime.strptime(args.since_date.strip(), "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            print(f"Error: Invalid --since-date format. Use YYYY-MM-DD, e.g. 2024-09-01", file=sys.stderr)
            sys.exit(1)
        print(f"Fetching markets since {since_date.date()} (active + closed, chronological)...", file=sys.stderr)

    requests_delay = (args.delay if args.delay is not None else DEFAULT_REQUESTS_DELAY)

    if args.closed_events_only:
        msg = "Running Closed Events Supplement Only"
        if since_date is not None:
            msg += f" (created_at >= {since_date.date()})"
        print(msg + "...", file=sys.stderr)
    else:
        print("Running Market Discovery...", file=sys.stderr)
    count = run_market_discovery(
        db_path=args.db,
        output_json=args.output,
        limit=args.limit,
        active_only=args.active_only,
        closed_only=args.closed_only,
        event_slugs=args.event_slugs,
        since_date=since_date,
        batch_size=args.batch_size,
        closed_events_only=args.closed_events_only,
        closed_events_start_offset=args.closed_events_start_offset,
        requests_delay=requests_delay,
        cooldown_every=args.cooldown_every,
        cooldown_seconds=args.cooldown_seconds,
        max_fetches=args.max_fetches,
    )
    if args.db:
        print(f"Done. Stored/updated {count} markets to database.", file=sys.stderr)
    else:
        print(f"Done. Saved {count} markets to JSON.", file=sys.stderr)


if __name__ == "__main__":
    main()
