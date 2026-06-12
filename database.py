import sqlite3
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List

DB_PATH = Path(__file__).parent / "categorizations.db"


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS categorizations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            url             TEXT UNIQUE NOT NULL,
            domain          TEXT NOT NULL,
            title           TEXT,
            categories      TEXT NOT NULL DEFAULT '[]',
            sentiment       TEXT NOT NULL DEFAULT '{}',
            keywords        TEXT NOT NULL DEFAULT '[]',
            entities        TEXT NOT NULL DEFAULT '[]',
            locations       TEXT NOT NULL DEFAULT '[]',
            flagged         INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL,
            page_type       TEXT NOT NULL DEFAULT 'content',
            google_category TEXT,
            brand           TEXT,
            merchant        TEXT
        )
    """)
    # Migrate existing tables missing new columns
    existing = {row[1] for row in cursor.execute("PRAGMA table_info(categorizations)")}
    for col, ddl in [
        ("page_type",       "TEXT NOT NULL DEFAULT 'content'"),
        ("google_category", "TEXT"),
        ("brand",           "TEXT"),
        ("merchant",        "TEXT"),
        ("confidence",      "REAL"),
    ]:
        if col not in existing:
            cursor.execute(f"ALTER TABLE categorizations ADD COLUMN {col} {ddl}")
    conn.commit()
    conn.close()


def _row_to_dict(row: sqlite3.Row) -> dict:
    keys = row.keys()
    return {
        "id": row["id"],
        "url": row["url"],
        "domain": row["domain"],
        "title": row["title"],
        "page_type": row["page_type"] if "page_type" in keys else "content",
        "categories": json.loads(row["categories"]),
        "sentiment": json.loads(row["sentiment"]),
        "keywords": json.loads(row["keywords"]),
        "entities": json.loads(row["entities"]),
        "locations": json.loads(row["locations"]),
        "flagged": bool(row["flagged"]),
        "created_at": row["created_at"],
        "google_category": row["google_category"] if "google_category" in keys else None,
        "brand": row["brand"] if "brand" in keys else None,
        "merchant": row["merchant"] if "merchant" in keys else None,
        "confidence": row["confidence"] if "confidence" in keys else None,
    }


def get_categorization(url: str) -> Optional[dict]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM categorizations WHERE url = ?", (url,))
    row = cursor.fetchone()
    conn.close()
    return _row_to_dict(row) if row else None


def save_categorization(data: dict):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO categorizations
            (url, domain, title, categories, sentiment, keywords, entities, locations,
             flagged, created_at, page_type, google_category, brand, merchant, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
            domain          = excluded.domain,
            title           = excluded.title,
            categories      = excluded.categories,
            sentiment       = excluded.sentiment,
            keywords        = excluded.keywords,
            entities        = excluded.entities,
            locations       = excluded.locations,
            flagged         = excluded.flagged,
            created_at      = excluded.created_at,
            page_type       = excluded.page_type,
            google_category = excluded.google_category,
            brand           = excluded.brand,
            merchant        = excluded.merchant,
            confidence      = excluded.confidence
        """,
        (
            data["url"],
            data["domain"],
            data.get("title", ""),
            json.dumps(data.get("categories", [])),
            json.dumps(data.get("sentiment", {})),
            json.dumps(data.get("keywords", [])),
            json.dumps(data.get("entities", [])),
            json.dumps(data.get("locations", [])),
            1 if data.get("flagged") else 0,
            datetime.now(timezone.utc).isoformat(),
            data.get("page_type", "content"),
            data.get("google_category"),
            data.get("brand"),
            data.get("merchant"),
            data.get("confidence"),
        ),
    )
    conn.commit()
    conn.close()


def get_all_categorizations(limit: int = 200) -> List[dict]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM categorizations ORDER BY created_at DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [_row_to_dict(row) for row in rows]


def _keyword_score(item: dict, match_keywords: list) -> float:
    """Fraction of match_keywords found anywhere in the record's text fields."""
    if not match_keywords:
        return 1.0
    searchable = " ".join(filter(None, [
        item.get("title") or "",
        " ".join(item.get("keywords") or []),
        " ".join(item.get("entities") or []),
        item.get("google_category") or "",
        " ".join(
            (cat.get("tier2_name") or "") + " " + (cat.get("tier1_name") or "")
            for cat in (item.get("categories") or [])
        ),
    ])).lower()
    hits = sum(1 for kw in match_keywords if kw.lower() in searchable)
    return hits / len(match_keywords)


def query_targeting(
    iab_ids: list,
    google_keywords: list,
    match_keywords: list = None,
    min_confidence: float = 0.60,
    limit: int = 150,
) -> list:
    match_keywords = match_keywords or []

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    sub_conditions = []
    params = []

    if iab_ids:
        iab_placeholders = " OR ".join(["categories LIKE ?" for _ in iab_ids])
        sub_conditions.append(f"(page_type = 'content' AND ({iab_placeholders}))")
        params.extend([f'%"{i}"%' for i in iab_ids])

    if google_keywords:
        goog_placeholders = " OR ".join(["google_category LIKE ?" for _ in google_keywords])
        sub_conditions.append(f"(page_type = 'product' AND ({goog_placeholders}))")
        params.extend([f'%{k}%' for k in google_keywords])

    if not sub_conditions:
        return []

    where = " OR ".join(sub_conditions)
    # Fetch a large candidate pool; scoring/filtering happens in Python
    cursor.execute(
        f"SELECT * FROM categorizations WHERE ({where}) ORDER BY created_at DESC LIMIT ?",
        params + [limit * 8],
    )
    rows = cursor.fetchall()
    conn.close()

    iab_set = set(iab_ids)
    results = []

    for row in [_row_to_dict(r) for r in rows]:
        if row["page_type"] == "content":
            best_conf = 0.0
            for cat in row.get("categories", []):
                if cat.get("tier1_id") in iab_set or cat.get("tier2_id") in iab_set:
                    best_conf = max(best_conf, float(cat.get("confidence", 0)))
            if best_conf < min_confidence:
                continue
            cat_conf = best_conf
        else:
            cat_conf = float(row.get("confidence") or 0.0)
            if cat_conf < min_confidence:
                continue

        kw_score = _keyword_score(row, match_keywords)

        # Discard results with no keyword overlap unless the category match is very strong
        if kw_score == 0.0 and cat_conf < 0.88:
            continue

        # Composite score: category confidence weighted with keyword relevance
        composite = cat_conf * 0.55 + kw_score * 0.45
        row["match_confidence"] = round(composite, 4)
        row["keyword_score"] = round(kw_score, 4)
        results.append(row)

    results.sort(key=lambda r: r["match_confidence"], reverse=True)
    return results[:limit]


def search_categorizations(q: str = "", page_type: str = "", limit: int = 500) -> List[dict]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    conditions = []
    params = []

    if q:
        conditions.append("(url LIKE ? OR domain LIKE ? OR title LIKE ? OR google_category LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like, like])

    if page_type in ("content", "product"):
        conditions.append("page_type = ?")
        params.append(page_type)

    where = " AND ".join(conditions) if conditions else "1=1"
    cursor.execute(
        f"SELECT * FROM categorizations WHERE {where} ORDER BY created_at DESC LIMIT ?",
        params + [limit],
    )
    rows = cursor.fetchall()
    conn.close()
    return [_row_to_dict(row) for row in rows]
