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
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            url         TEXT UNIQUE NOT NULL,
            domain      TEXT NOT NULL,
            title       TEXT,
            categories  TEXT NOT NULL DEFAULT '[]',
            sentiment   TEXT NOT NULL DEFAULT '{}',
            keywords    TEXT NOT NULL DEFAULT '[]',
            entities    TEXT NOT NULL DEFAULT '[]',
            locations   TEXT NOT NULL DEFAULT '[]',
            flagged     INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


def _row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "url": row["url"],
        "domain": row["domain"],
        "title": row["title"],
        "categories": json.loads(row["categories"]),
        "sentiment": json.loads(row["sentiment"]),
        "keywords": json.loads(row["keywords"]),
        "entities": json.loads(row["entities"]),
        "locations": json.loads(row["locations"]),
        "flagged": bool(row["flagged"]),
        "created_at": row["created_at"],
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
            (url, domain, title, categories, sentiment, keywords, entities, locations, flagged, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
            domain     = excluded.domain,
            title      = excluded.title,
            categories = excluded.categories,
            sentiment  = excluded.sentiment,
            keywords   = excluded.keywords,
            entities   = excluded.entities,
            locations  = excluded.locations,
            flagged    = excluded.flagged,
            created_at = excluded.created_at
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
        ),
    )
    conn.commit()
    conn.close()


def get_all_categorizations() -> List[dict]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM categorizations ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [_row_to_dict(row) for row in rows]
