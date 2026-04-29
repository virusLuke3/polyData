from __future__ import annotations

import io
import json
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional
from xml.etree import ElementTree as ET


GEO_SHOCK_SNAPSHOT_NAMESPACE = "snapshot:world:geo-sanctions-shock"
DEFAULT_FEDERAL_REGISTER_TERMS = (
    "OFAC sanctions action",
    "Iran sanctions",
    "Russia sanctions",
    "China sanctions",
    "nuclear emergency",
    "export controls China",
)
TARGET_ALIASES: Dict[str, tuple[str, ...]] = {
    "IRAN": ("iran", "iranian", "tehran", "persian gulf"),
    "RUSSIA": ("russia", "russian", "moscow", "crimea", "kremlin"),
    "CHINA": ("china", "chinese", "beijing", "prc", "xinjiang", "hong kong"),
    "NORTH KOREA": ("north korea", "dprk", "pyongyang"),
    "ISRAEL / GAZA": ("israel", "israeli", "gaza", "hamas", "hezbollah", "lebanon"),
    "UKRAINE": ("ukraine", "ukrainian", "kyiv", "kiev", "donetsk", "luhansk"),
    "TAIWAN": ("taiwan", "taipei", "taiwan strait"),
}
SHOCK_KEYWORDS = (
    "sanction",
    "war",
    "ceasefire",
    "military",
    "missile",
    "drone",
    "strike",
    "nuclear",
    "uranium",
    "tariff",
    "export control",
    "oil",
    "shipping",
    "embargo",
)
MILITARY_KEYWORDS = ("military", "missile", "drone", "strike", "naval", "troop", "defense", "rocket")
NUCLEAR_KEYWORDS = ("nuclear", "uranium", "reactor", "atomic", "radiological")
SEVERITY_ORDER = {"critical": 3, "warning": 2, "watch": 1, "muted": 0}


def _local_name(tag: str) -> str:
    return str(tag).split("}", 1)[-1]


def _text_or_none(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def _unique(values: Iterable[str]) -> List[str]:
    seen: set[str] = set()
    ordered: List[str] = []
    for value in values:
        text = str(value or "").strip()
        key = text.lower()
        if not text or key in seen:
            continue
        seen.add(key)
        ordered.append(text)
    return ordered


def _parse_datetime(value: Any) -> Optional[datetime]:
    text = _text_or_none(value)
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%d %H:%M:%S"):
            try:
                parsed = datetime.strptime(text, fmt)
                break
            except ValueError:
                parsed = None
        if parsed is None:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _iso_or_none(value: Any) -> Optional[str]:
    parsed = _parse_datetime(value)
    if parsed is None:
        return _text_or_none(value)
    return parsed.isoformat().replace("+00:00", "Z")


def _target_hits(*parts: Any) -> List[str]:
    haystack = " ".join(str(part or "") for part in parts).lower()
    hits: List[str] = []
    for label, aliases in TARGET_ALIASES.items():
        if any(alias in haystack for alias in aliases):
            hits.append(label)
    return hits


def _has_keyword(*parts: Any, keywords: Iterable[str]) -> bool:
    haystack = " ".join(str(part or "") for part in parts).lower()
    return any(keyword in haystack for keyword in keywords)


def _empty_payload(ctx: dict, *, status: str = "empty", source_states: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    return {
        "generatedAt": ctx["utc_now_iso"](),
        "source": "OFAC / Federal Register / Conflict feed",
        "sourceUrl": ctx["SETTINGS"].geo_shock_source_url,
        "status": status,
        "sources": dict(source_states or {}),
        "summary": {
            "hotspotCount": 0,
            "newSanctionsCount": 0,
            "targetLabels": [],
            "targetSummary": "MONITORING",
            "nuclearRisk": "guarded",
            "militaryFeed": "standby",
        },
        "items": [],
        "linkedMarkets": [],
        "ofacRecordCountTotal": 0,
    }


def _previous_snapshot(ctx: dict, cache_key: str) -> Dict[str, Any]:
    getter = ctx.get("get_cached_runtime_payload")
    if callable(getter):
        payload = getter(GEO_SHOCK_SNAPSHOT_NAMESPACE, cache_key)
        if isinstance(payload, dict):
            return payload
    snapshot_store = ctx.get("SNAPSHOT_STORE")
    if snapshot_store is None:
        return {}
    for method_name in ("get", "get_stale"):
        method = getattr(snapshot_store, method_name, None)
        if callable(method):
            payload = method(GEO_SHOCK_SNAPSHOT_NAMESPACE, cache_key)
            if isinstance(payload, dict):
                return payload
    return {}


def _ofac_headers() -> Dict[str, str]:
    return {
        "User-Agent": "polydata-runtime/1.0",
        "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
    }


def _iter_texts(parent: ET.Element, path: tuple[str, ...]) -> List[str]:
    nodes = [parent]
    for name in path:
        next_nodes: List[ET.Element] = []
        for node in nodes:
            for child in list(node):
                if _local_name(child.tag) == name:
                    next_nodes.append(child)
        nodes = next_nodes
        if not nodes:
            return []
    return [text for text in (_text_or_none(node.text) for node in nodes) if text]


def _parse_ofac_xml(xml_bytes: bytes, *, list_name: str) -> Dict[str, Any]:
    publish_date = None
    record_count = 0
    focus_entries: List[Dict[str, Any]] = []
    target_scores: Dict[str, int] = defaultdict(int)

    for _, elem in ET.iterparse(io.BytesIO(xml_bytes), events=("end",)):
        tag = _local_name(elem.tag)
        if tag == "publshInformation":
            publish_date = _text_or_none(next((child.text for child in list(elem) if _local_name(child.tag) == "Publish_Date"), None))
            raw_count = _text_or_none(next((child.text for child in list(elem) if _local_name(child.tag) == "Record_Count"), None))
            try:
                record_count = int(raw_count or 0)
            except (TypeError, ValueError):
                record_count = 0
            elem.clear()
            continue
        if tag != "sdnEntry":
            continue

        uid = _text_or_none(next((child.text for child in list(elem) if _local_name(child.tag) == "uid"), None))
        first_name = _text_or_none(next((child.text for child in list(elem) if _local_name(child.tag) == "firstName"), None))
        last_name = _text_or_none(next((child.text for child in list(elem) if _local_name(child.tag) == "lastName"), None))
        entity_type = _text_or_none(next((child.text for child in list(elem) if _local_name(child.tag) == "sdnType"), None)) or "Entity"
        programs = _unique(_iter_texts(elem, ("programList", "program")))
        countries = _unique(
            [
                *_iter_texts(elem, ("addressList", "address", "country")),
                *_iter_texts(elem, ("nationalityList", "nationality", "country")),
                *_iter_texts(elem, ("citizenshipList", "citizenship", "country")),
            ]
        )
        name = " ".join(part for part in (first_name, last_name) if part) or last_name or first_name or f"{list_name} #{uid or 'unknown'}"
        targets = _target_hits(name, " ".join(programs), " ".join(countries))
        for target in targets:
            target_scores[target] += 3 if list_name == "OFAC SDN" else 2
        if targets:
            focus_entries.append(
                {
                    "id": f"ofac:{uid or name}",
                    "kind": "sanction",
                    "headline": name,
                    "summary": " / ".join(_unique([entity_type, *programs[:2], *countries[:1]])) or entity_type,
                    "source": list_name,
                    "sourceUrl": None,
                    "occurredAt": _iso_or_none(publish_date),
                    "severity": "critical" if any(target in {"IRAN", "RUSSIA", "CHINA", "NORTH KOREA"} for target in targets) else "warning",
                    "targetLabels": targets,
                }
            )
        elem.clear()

    return {
        "publishDate": _iso_or_none(publish_date),
        "recordCount": record_count,
        "focusEntries": focus_entries[:10],
        "targetScores": dict(target_scores),
    }


def _fetch_ofac_snapshot(ctx: dict) -> Dict[str, Any]:
    requests_lib = ctx.get("requests")
    settings = ctx["SETTINGS"]
    sources = {
        "ofacSdn": settings.geo_shock_ofac_sdn_url,
        "ofacConsolidated": settings.geo_shock_ofac_consolidated_url,
    }
    source_states: Dict[str, str] = {}
    combined_entries: List[Dict[str, Any]] = []
    target_scores: Dict[str, int] = defaultdict(int)
    record_count_total = 0
    publish_dates: List[str] = []
    if requests_lib is None:
        return {
            "states": {name: "requests-missing" for name in sources},
            "recordCountTotal": 0,
            "focusEntries": [],
            "targetScores": {},
            "publishDates": [],
        }
    for name, url in sources.items():
        if not url:
            source_states[name] = "missing-url"
            continue
        try:
            response = requests_lib.get(url, timeout=20, headers=_ofac_headers())
            response.raise_for_status()
            parsed = _parse_ofac_xml(response.content, list_name="OFAC SDN" if name == "ofacSdn" else "OFAC Consolidated")
            source_states[name] = "ok"
            combined_entries.extend(parsed["focusEntries"])
            record_count_total += int(parsed["recordCount"] or 0)
            if parsed.get("publishDate"):
                publish_dates.append(parsed["publishDate"])
            for target, score in (parsed.get("targetScores") or {}).items():
                target_scores[target] += int(score or 0)
        except Exception:
            ctx["app"].logger.exception("geo shock ofac fetch failed source=%s", name)
            source_states[name] = "error"
    return {
        "states": source_states,
        "recordCountTotal": record_count_total,
        "focusEntries": combined_entries[:12],
        "targetScores": dict(target_scores),
        "publishDates": publish_dates,
    }


def _normalize_notice(doc: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    title = _text_or_none(doc.get("title"))
    if not title:
        return None
    summary = _text_or_none(doc.get("abstract")) or _text_or_none(doc.get("excerpts")) or ""
    targets = _target_hits(title, summary)
    if not targets and not _has_keyword(title, summary, keywords=SHOCK_KEYWORDS):
        return None
    doc_type = _text_or_none(doc.get("type")) or "Notice"
    severity = "critical" if _has_keyword(title, summary, keywords=NUCLEAR_KEYWORDS) else ("warning" if "executive order" in title.lower() or "ofac" in summary.lower() else "watch")
    return {
        "id": f"fr:{doc.get('document_number') or title}",
        "kind": "notice",
        "headline": title,
        "summary": " / ".join(_unique([doc_type, *targets[:2]])),
        "source": "Federal Register",
        "sourceUrl": doc.get("html_url"),
        "occurredAt": _iso_or_none(doc.get("publication_date")),
        "severity": severity,
        "targetLabels": targets,
    }


def _fetch_federal_register_snapshot(ctx: dict) -> Dict[str, Any]:
    url = ctx["SETTINGS"].geo_shock_federal_register_api_url
    if not url:
        return {"state": "missing-url", "items": [], "targetScores": {}}
    http_json_get = ctx.get("http_json_get")
    if not callable(http_json_get):
        return {"state": "requests-missing", "items": [], "targetScores": {}}

    seen: set[str] = set()
    items: List[Dict[str, Any]] = []
    target_scores: Dict[str, int] = defaultdict(int)
    any_ok = False
    for term in DEFAULT_FEDERAL_REGISTER_TERMS:
        try:
            payload = http_json_get(
                url,
                params={
                    "per_page": 6,
                    "order": "newest",
                    "conditions[term]": term,
                },
                timeout=15,
                headers={"Accept": "application/json", "User-Agent": "polydata-runtime/1.0"},
            )
            any_ok = True
        except Exception:
            ctx["app"].logger.exception("geo shock federal register fetch failed term=%s", term)
            continue
        for raw in (payload or {}).get("results") or []:
            key = str(raw.get("document_number") or raw.get("html_url") or raw.get("title") or "")
            if not key or key in seen:
                continue
            seen.add(key)
            item = _normalize_notice(raw)
            if item is None:
                continue
            items.append(item)
            for target in item.get("targetLabels") or []:
                target_scores[target] += 2
    if items:
        items.sort(key=lambda item: (_parse_datetime(item.get("occurredAt")) or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
    state = "ok" if any_ok else "error"
    return {"state": state, "items": items[:10], "targetScores": dict(target_scores)}


def _coerce_conflict_rows(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        for key in ("items", "results", "events", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]
    return []


def _normalize_conflict_item(raw: Dict[str, Any], index: int) -> Optional[Dict[str, Any]]:
    headline = _text_or_none(raw.get("headline")) or _text_or_none(raw.get("title")) or _text_or_none(raw.get("event_type")) or _text_or_none(raw.get("eventType"))
    country = _text_or_none(raw.get("country")) or _text_or_none(raw.get("region")) or _text_or_none(raw.get("location"))
    tags = raw.get("tags") or raw.get("layers") or raw.get("topics") or []
    tag_values = [str(value).strip() for value in tags] if isinstance(tags, list) else [part.strip() for part in str(tags).split(",") if part.strip()]
    if not headline and not country:
        return None
    occurred_at = _iso_or_none(
        raw.get("event_date")
        or raw.get("eventDate")
        or raw.get("published_at")
        or raw.get("publishedAt")
        or raw.get("timestamp")
        or raw.get("updated_at")
        or raw.get("updatedAt")
    )
    fatalities = raw.get("fatalities") or raw.get("fatality_count")
    try:
        fatality_count = int(fatalities or 0)
    except (TypeError, ValueError):
        fatality_count = 0
    text_blob = " ".join(part for part in (headline, country, " ".join(tag_values)) if part)
    if fatality_count >= 20 or _has_keyword(text_blob, keywords=NUCLEAR_KEYWORDS):
        severity = "critical"
    elif fatality_count > 0 or _has_keyword(text_blob, keywords=MILITARY_KEYWORDS):
        severity = "warning"
    else:
        severity = "watch"
    return {
        "id": f"conflict:{raw.get('id') or raw.get('event_id') or index}",
        "kind": "conflict",
        "headline": headline or country or f"Hotspot {index + 1}",
        "summary": " / ".join(_unique([country or "Unknown", *tag_values[:2]])),
        "source": _text_or_none(raw.get("source")) or "Conflict feed",
        "sourceUrl": raw.get("url"),
        "occurredAt": occurred_at,
        "severity": severity,
        "targetLabels": _target_hits(text_blob),
        "country": country,
        "tags": tag_values,
    }


def _fetch_conflict_snapshot(ctx: dict) -> Dict[str, Any]:
    url = ctx["SETTINGS"].geo_shock_conflict_api_url
    if not url:
        return {"state": "missing-url", "items": [], "targetScores": {}, "hotspotCount": 0}
    http_json_get = ctx.get("http_json_get")
    if not callable(http_json_get):
        return {"state": "requests-missing", "items": [], "targetScores": {}, "hotspotCount": 0}
    try:
        payload = http_json_get(
            url,
            timeout=15,
            headers={"Accept": "application/json", "User-Agent": "polydata-runtime/1.0"},
        )
    except Exception:
        ctx["app"].logger.exception("geo shock conflict fetch failed")
        return {"state": "error", "items": [], "targetScores": {}, "hotspotCount": 0}

    items: List[Dict[str, Any]] = []
    target_scores: Dict[str, int] = defaultdict(int)
    for index, row in enumerate(_coerce_conflict_rows(payload)):
        item = _normalize_conflict_item(row, index)
        if item is None:
            continue
        items.append(item)
        for target in item.get("targetLabels") or []:
            target_scores[target] += 2
    hotspot_count = len(_unique([item.get("country") or item.get("headline") or "" for item in items]))
    items.sort(
        key=lambda item: (
            _parse_datetime(item.get("occurredAt")) or datetime.min.replace(tzinfo=timezone.utc),
            SEVERITY_ORDER.get(str(item.get("severity")), 0),
        ),
        reverse=True,
    )
    return {
        "state": "ok",
        "items": items[:12],
        "targetScores": dict(target_scores),
        "hotspotCount": hotspot_count,
    }


def _merge_target_scores(*score_maps: Dict[str, int]) -> Dict[str, int]:
    combined: Dict[str, int] = defaultdict(int)
    for score_map in score_maps:
        for target, score in (score_map or {}).items():
            combined[target] += int(score or 0)
    return dict(combined)


def _top_targets(target_scores: Dict[str, int]) -> List[str]:
    ranked = sorted(target_scores.items(), key=lambda item: (-item[1], item[0]))
    return [label for label, score in ranked if score > 0][:3]


def _nuclear_risk(items: List[Dict[str, Any]], targets: List[str]) -> str:
    nuclear_items = [
        item for item in items
        if _has_keyword(item.get("headline"), item.get("summary"), " ".join(item.get("tags") or []), keywords=NUCLEAR_KEYWORDS)
    ]
    if len(nuclear_items) >= 2:
        return "critical"
    if nuclear_items or any(target in {"IRAN", "NORTH KOREA"} for target in targets):
        return "elevated"
    return "guarded"


def _military_feed_label(conflict_state: str, conflict_items: List[Dict[str, Any]]) -> str:
    if conflict_state == "ok" and conflict_items:
        return "active"
    if conflict_state == "ok":
        return "quiet"
    if conflict_state == "missing-url":
        return "limited"
    return "degraded"


def _gamma_active_sets(ctx: dict) -> tuple[set[str], set[str]]:
    getter = ctx.get("get_gamma_active_market_filter")
    if not callable(getter):
        return set(), set()
    try:
        payload = getter() or {}
    except Exception:
        return set(), set()
    condition_ids = {str(value or "").strip().lower() for value in (payload.get("conditionIds") or []) if str(value or "").strip()}
    slugs = {str(value or "").strip().lower() for value in (payload.get("slugs") or []) if str(value or "").strip()}
    return condition_ids, slugs


def _theme_terms(items: List[Dict[str, Any]]) -> List[str]:
    haystack = " ".join(
        " ".join(
            [
                str(item.get("headline") or ""),
                str(item.get("summary") or ""),
                " ".join(item.get("targetLabels") or []),
            ]
        )
        for item in items
    ).lower()
    themes: List[str] = []
    for keyword in ("sanctions", "war", "ceasefire", "nuclear", "military", "oil", "tariff"):
        if keyword.rstrip("s") in haystack or keyword in haystack:
            themes.append(keyword)
    return themes


def _score_market_row(row: Dict[str, Any], *, targets: List[str], themes: List[str], query: str, gamma_condition_ids: set[str], gamma_slugs: set[str]) -> int:
    text = " ".join([str(row.get("title") or ""), str(row.get("slug") or "")]).lower()
    score = 0
    lowered_query = query.lower()
    if lowered_query and lowered_query in text:
        score += 5
    for target in targets:
        if any(alias in text for alias in TARGET_ALIASES.get(target, ())):
            score += 4
    for theme in themes:
        if theme in text:
            score += 2
    condition_id = str(row.get("conditionId") or "").strip().lower()
    slug = str(row.get("slug") or "").strip().lower()
    if (condition_id and condition_id in gamma_condition_ids) or (slug and slug in gamma_slugs):
        score += 2
    return score


def _link_markets(ctx: dict, *, targets: List[str], items: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    search_markets = ctx.get("search_markets")
    if not callable(search_markets):
        return []
    queries: List[str] = []
    for target in targets[:3]:
        lowered = target.lower()
        queries.extend([lowered, f"{lowered} sanctions", f"{lowered} war"])
        if target in {"IRAN", "ISRAEL / GAZA", "UKRAINE"}:
            queries.append(f"{lowered} ceasefire")
    for theme in _theme_terms(items):
        queries.append(theme)
    queries.extend(["sanctions", "war escalation"])
    gamma_condition_ids, gamma_slugs = _gamma_active_sets(ctx)
    themes = _theme_terms(items)

    scored: Dict[str, Dict[str, Any]] = {}
    for query in _unique(queries)[:10]:
        try:
            payload = search_markets(query, limit=max(limit * 2, 8)) or {}
        except Exception:
            continue
        for row in payload.get("items") or []:
            key = str(row.get("id") or row.get("slug") or row.get("title") or "")
            if not key:
                continue
            score = _score_market_row(
                row,
                targets=targets,
                themes=themes,
                query=query,
                gamma_condition_ids=gamma_condition_ids,
                gamma_slugs=gamma_slugs,
            )
            if score <= 0:
                continue
            existing = scored.get(key)
            gamma_active = (
                str(row.get("conditionId") or "").strip().lower() in gamma_condition_ids
                or str(row.get("slug") or "").strip().lower() in gamma_slugs
            )
            candidate = {
                "marketId": row.get("id"),
                "slug": row.get("slug"),
                "title": row.get("title"),
                "matchedBy": query,
                "score": score,
                "gammaActive": gamma_active,
            }
            if existing is None or int(candidate["score"] or 0) > int(existing["score"] or 0):
                scored[key] = candidate
    rows = list(scored.values())
    rows.sort(key=lambda row: (bool(row.get("gammaActive")), int(row.get("score") or 0), str(row.get("title") or "")), reverse=True)
    return rows[: max(1, min(limit, 6))]


def _payload_status(source_states: Dict[str, str], items: List[Dict[str, Any]]) -> str:
    states = list(source_states.values())
    if not states:
        return "empty" if not items else "ok"
    if items and all(state == "ok" for state in states if state not in {"missing-url"}):
        return "ok" if all(state == "ok" for state in states) else "degraded"
    if items:
        return "degraded"
    if any(state == "ok" for state in states):
        return "empty"
    return "degraded"


def get_geo_sanctions_shock_snapshot(ctx: dict, limit: int = 6) -> Dict[str, Any]:
    cache_key = json.dumps({"limit": max(1, int(limit or 6))}, sort_keys=True, ensure_ascii=True)
    previous = _previous_snapshot(ctx, cache_key)

    def _builder() -> Dict[str, Any]:
        payload = _empty_payload(ctx, status="empty")
        ofac_snapshot = _fetch_ofac_snapshot(ctx)
        notices_snapshot = _fetch_federal_register_snapshot(ctx)
        conflict_snapshot = _fetch_conflict_snapshot(ctx)

        source_states = {
            **(ofac_snapshot.get("states") or {}),
            "federalRegister": notices_snapshot.get("state") or "error",
            "conflictFeed": conflict_snapshot.get("state") or "error",
        }

        items = [
            *(ofac_snapshot.get("focusEntries") or []),
            *(notices_snapshot.get("items") or []),
            *(conflict_snapshot.get("items") or []),
        ]
        items.sort(
            key=lambda item: (
                _parse_datetime(item.get("occurredAt")) or datetime.min.replace(tzinfo=timezone.utc),
                SEVERITY_ORDER.get(str(item.get("severity")), 0),
            ),
            reverse=True,
        )
        items = items[: max(4, min(limit * 2, 12))]

        target_scores = _merge_target_scores(
            ofac_snapshot.get("targetScores") or {},
            notices_snapshot.get("targetScores") or {},
            conflict_snapshot.get("targetScores") or {},
        )
        targets = _top_targets(target_scores)
        record_total = int(ofac_snapshot.get("recordCountTotal") or 0)
        previous_record_total = int(previous.get("ofacRecordCountTotal") or 0)
        recent_notice_count = len(notices_snapshot.get("items") or [])
        new_sanctions_count = max(0, record_total - previous_record_total) if previous_record_total else recent_notice_count

        linked_markets = _link_markets(ctx, targets=targets, items=items, limit=limit)
        payload.update(
            {
                "generatedAt": ctx["utc_now_iso"](),
                "sourceUrl": ctx["SETTINGS"].geo_shock_source_url,
                "status": _payload_status(source_states, items),
                "sources": source_states,
                "summary": {
                    "hotspotCount": int(conflict_snapshot.get("hotspotCount") or 0),
                    "newSanctionsCount": int(new_sanctions_count),
                    "targetLabels": targets,
                    "targetSummary": " / ".join(targets) if targets else "MONITORING",
                    "nuclearRisk": _nuclear_risk(items, targets),
                    "militaryFeed": _military_feed_label(str(conflict_snapshot.get("state") or ""), conflict_snapshot.get("items") or []),
                },
                "items": items[: max(3, min(limit, 8))],
                "linkedMarkets": linked_markets,
                "ofacRecordCountTotal": record_total,
                "publishDates": ofac_snapshot.get("publishDates") or [],
            }
        )
        return payload

    ttl_seconds = max(300, int(ctx["SETTINGS"].geo_shock_ttl_seconds or 900))
    return ctx["get_snapshot_payload"](
        GEO_SHOCK_SNAPSHOT_NAMESPACE,
        cache_key,
        _builder,
        ttl_seconds=ttl_seconds,
    )
