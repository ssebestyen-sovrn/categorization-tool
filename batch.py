#!/usr/bin/env python3
"""
Batch URL categorizer — processes large volumes efficiently.

Usage:
  python batch.py urls.txt
  python batch.py domains.csv --col 0 --workers 8 --output results.csv
  python batch.py urls.txt --model sonnet --full
  python batch.py urls.txt --workers 10 --delay 0.5

Options:
  input           TXT or CSV file with URLs (one per line / comma-separated)
  --col INT       Column index for URLs in CSV (default: 0)
  --workers INT   Concurrent workers (default: 5)
  --output PATH   Output CSV path (default: results_<stem>.csv)
  --model         haiku (default, fast+cheap) | sonnet (accurate)
  --full          Full content extraction instead of lean mode
  --delay FLOAT   Seconds between Claude calls — increase if hitting rate limits (default: 0.2)
  --skip-cached   Skip URLs already in the database (default: True — always skips)
"""

import asyncio
import csv
import sys
import time
import argparse
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(override=True)

from database import init_db, get_categorization, save_categorization
from scraper import scrape_url
from categorizer import categorize_content, MODEL_SONNET, MODEL_HAIKU

logging.basicConfig(
    level=logging.WARNING,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

CSV_HEADERS = [
    "url", "domain", "title",
    "tier1_id", "tier1_name", "tier2_id", "tier2_name",
    "confidence", "flagged",
    "sentiment_label", "sentiment_score",
    "keywords", "entities", "locations",
    "model", "status", "error",
]


# ── URL parsing ───────────────────────────────────────────────────

def load_urls(path: Path, col: int) -> list:
    urls = []
    with open(path, newline="", encoding="utf-8") as f:
        if path.suffix.lower() == ".csv":
            for row in csv.reader(f):
                if row and len(row) > col:
                    for u in row[col].split(","):
                        u = u.strip()
                        if u and not u.startswith("#"):
                            urls.append(u)
        else:
            for line in f:
                for u in line.split(","):
                    u = u.strip()
                    if u and not u.startswith("#"):
                        urls.append(u)
    # Deduplicate, preserve order
    seen = set()
    deduped = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            deduped.append(u)
    return deduped


# ── Result row builder ────────────────────────────────────────────

def to_csv_row(url: str, result, status: str, error: str = "") -> list:
    if result is None:
        return [url, "", "", "", "", "", "", "", "", "", "", "", "", "", "", status, error]
    top  = result.get("categories", [{}])[0] if result.get("categories") else {}
    sent = result.get("sentiment", {})
    return [
        result.get("url", url),
        result.get("domain", ""),
        result.get("title", ""),
        top.get("tier1_id", ""),
        top.get("tier1_name", ""),
        top.get("tier2_id", ""),
        top.get("tier2_name", ""),
        f"{top.get('confidence', ''):.2f}" if top.get("confidence") is not None else "",
        top.get("flagged", ""),
        sent.get("label", ""),
        f"{sent.get('score', 0):.2f}",
        "|".join(result.get("keywords", [])),
        "|".join(result.get("entities", [])),
        "|".join(result.get("locations", [])),
        result.get("model", ""),
        status,
        error,
    ]


# ── Per-URL worker ────────────────────────────────────────────────

async def process_one(
    url: str,
    executor: ThreadPoolExecutor,
    semaphore: asyncio.Semaphore,
    model: str,
    lean: bool,
    delay: float,
    stats: dict,
) -> dict:
    """Returns {"url", "status", "data"|"error"}."""

    # Cache hit — free
    cached = get_categorization(url)
    if cached:
        stats["cached"] += 1
        return {"url": url, "status": "cached", "data": cached}

    loop = asyncio.get_event_loop()

    async with semaphore:
        # ── Scrape ──────────────────────────────────────────────
        try:
            page_data = await loop.run_in_executor(
                executor, lambda: scrape_url(url, lean=lean)
            )
        except Exception as exc:
            stats["failed"] += 1
            log.warning("Scrape failed for %s: %s", url, exc)
            return {"url": url, "status": "error", "error": f"Scrape: {exc}"}

        # ── Categorize — with retry on rate limit ────────────────
        for attempt in range(4):
            if attempt > 0:
                wait = 2 ** attempt * 8  # 16s, 32s, 64s
                print(f"\r  ⏳ Rate limited — waiting {wait}s before retry {attempt}/3…", flush=True)
                await asyncio.sleep(wait)

            try:
                result = await loop.run_in_executor(
                    executor, lambda: categorize_content(url, page_data, model=model)
                )
                save_categorization(result)
                stats["success"] += 1
                if delay:
                    await asyncio.sleep(delay)
                return {"url": url, "status": "success", "data": result}

            except Exception as exc:
                msg = str(exc)
                if "429" in msg or "rate" in msg.lower() or "overloaded" in msg.lower():
                    if attempt < 3:
                        continue
                log.warning("Categorize failed for %s: %s", url, exc)
                stats["failed"] += 1
                return {"url": url, "status": "error", "error": f"Categorize: {exc}"}

    stats["failed"] += 1
    return {"url": url, "status": "error", "error": "Retries exhausted"}


# ── Progress printer ──────────────────────────────────────────────

def print_progress(done: int, total: int, stats: dict, start: float):
    elapsed = time.time() - start
    rate = done / elapsed if elapsed > 0 else 0
    remaining = (total - done) / rate if rate > 0 else 0
    eta = str(timedelta(seconds=int(remaining))) if done > 0 else "—"
    bar_len = 30
    filled = int(bar_len * done / total) if total else 0
    bar = "█" * filled + "░" * (bar_len - filled)
    print(
        f"\r  [{bar}] {done}/{total}  "
        f"✓{stats['success']} ⚡{stats['cached']} ✗{stats['failed']}  "
        f"{rate:.1f}/s  ETA {eta}   ",
        end="",
        flush=True,
    )


# ── Main ──────────────────────────────────────────────────────────

async def run(args):
    input_path  = Path(args.input)
    output_path = Path(args.output) if args.output else \
                  input_path.with_name(f"results_{input_path.stem}_{datetime.now():%Y%m%d_%H%M%S}.csv")

    if not input_path.exists():
        print(f"Error: input file not found: {input_path}")
        sys.exit(1)

    urls = load_urls(input_path, args.col)
    if not urls:
        print("No URLs found in input file.")
        sys.exit(1)

    init_db()

    model = MODEL_SONNET if args.model == "sonnet" else MODEL_HAIKU
    lean  = not args.full

    already_cached = sum(1 for u in urls if get_categorization(u))
    to_process     = len(urls) - already_cached

    print(f"\n  URL Categorizer — Batch Mode")
    print(f"  ─────────────────────────────────────────────")
    print(f"  Input:     {input_path}  ({len(urls):,} URLs)")
    print(f"  Cached:    {already_cached:,}  (will be skipped)")
    print(f"  To fetch:  {to_process:,}")
    print(f"  Model:     {model}  ({'lean' if lean else 'full'} extraction)")
    print(f"  Workers:   {args.workers}")
    print(f"  Output:    {output_path}")
    print(f"  ─────────────────────────────────────────────\n")

    if to_process == 0:
        print("  All URLs already cached. Writing output CSV…")

    stats    = {"success": 0, "cached": 0, "failed": 0}
    results  = []
    start    = time.time()

    semaphore = asyncio.Semaphore(args.workers)

    try:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            tasks = [
                process_one(url, executor, semaphore, model, lean, args.delay, stats)
                for url in urls
            ]

            done_count = 0
            for coro in asyncio.as_completed(tasks):
                result = await coro
                results.append(result)
                done_count += 1
                print_progress(done_count, len(urls), stats, start)

    except KeyboardInterrupt:
        print("\n\n  Interrupted — saving partial results…")

    print()  # newline after progress bar

    # ── Write CSV ──────────────────────────────────────────────────
    url_order = {u: i for i, u in enumerate(urls)}
    results.sort(key=lambda r: url_order.get(r["url"], 9999))

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_HEADERS)
        for r in results:
            if r["status"] in ("success", "cached"):
                writer.writerow(to_csv_row(r["url"], r["data"], r["status"]))
            else:
                writer.writerow(to_csv_row(r["url"], None, "error", r.get("error", "")))

    elapsed = time.time() - start
    total_done = stats["success"] + stats["cached"] + stats["failed"]
    print(f"\n  Done in {timedelta(seconds=int(elapsed))}")
    print(f"  ✓  {stats['success']:,} categorized   ⚡ {stats['cached']:,} from cache   ✗ {stats['failed']:,} failed")
    print(f"  Results → {output_path}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Batch URL categorizer using IAB 3.0 taxonomy",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("input",               help="Input TXT or CSV file")
    parser.add_argument("--col",    type=int,   default=0,     help="CSV column index (default: 0)")
    parser.add_argument("--workers",type=int,   default=5,     help="Concurrent workers (default: 5)")
    parser.add_argument("--output",             default=None,  help="Output CSV path")
    parser.add_argument("--model",  choices=["haiku","sonnet"], default="haiku",
                        help="Model to use (default: haiku)")
    parser.add_argument("--full",   action="store_true",       help="Full content extraction (slower)")
    parser.add_argument("--delay",  type=float, default=0.2,   help="Delay between Claude calls in seconds (default: 0.2)")
    args = parser.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
