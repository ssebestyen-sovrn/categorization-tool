import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

load_dotenv(override=True)

from database import init_db, get_categorization, save_categorization, get_all_categorizations, search_categorizations, query_targeting
from scraper import scrape_url
from categorizer import categorize, categorize_content, MODEL_SONNET, MODEL_HAIKU, translate_targeting_query


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="URL Categorization Tool — IAB 3.0", lifespan=lifespan)


class CategorizeRequest(BaseModel):
    url: str
    force_type: str = None  # 'product' | 'content' | None (auto-detect)


class BulkCategorizeRequest(BaseModel):
    urls: list
    force_type: str = None  # 'product' | 'content' | None (auto-detect)


@app.post("/api/bulk-categorize")
async def api_bulk_categorize(req: BulkCategorizeRequest):
    urls = [u.strip() for u in req.urls if isinstance(u, str) and u.strip()]
    if not urls:
        raise HTTPException(status_code=400, detail="No URLs provided")
    if len(urls) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 URLs per batch")

    results = []
    for url in urls:
        cached = get_categorization(url)
        if cached:
            results.append({"url": url, "status": "success", "cached": True, "data": cached})
            continue
        try:
            page_data = scrape_url(url, lean=True, force_type=req.force_type)
        except Exception as exc:
            results.append({"url": url, "status": "error", "error": f"Could not fetch URL: {exc}"})
            continue
        try:
            result = categorize(url, page_data, model=MODEL_HAIKU, force_type=req.force_type)
        except Exception as exc:
            results.append({"url": url, "status": "error", "error": f"Categorization failed: {exc}"})
            continue
        save_categorization(result)
        results.append({"url": url, "status": "success", "cached": False, "data": result})

    return {
        "results": results,
        "total": len(results),
        "succeeded": sum(1 for r in results if r["status"] == "success"),
        "failed": sum(1 for r in results if r["status"] == "error"),
    }


@app.post("/api/categorize")
def api_categorize(req: CategorizeRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    # Return cached result without re-crawling
    cached = get_categorization(url)
    if cached:
        return {**cached, "cached": True}

    # Scrape (full mode for single URL; pass force_type for detection override)
    try:
        page_data = scrape_url(url, force_type=req.force_type)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not fetch URL: {exc}")

    # Categorize via Claude — auto-routes product vs content
    try:
        result = categorize(url, page_data, model=MODEL_SONNET, force_type=req.force_type)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Categorization failed: {exc}")

    # Persist
    save_categorization(result)

    return {**result, "cached": False}


@app.get("/api/history")
async def api_history():
    return get_all_categorizations()


@app.get("/api/search")
async def api_search(q: str = "", page_type: str = "", limit: int = 500):
    return search_categorizations(q=q.strip(), page_type=page_type, limit=limit)


class TargetingRequest(BaseModel):
    description: str


@app.post("/api/targeting")
def api_targeting(req: TargetingRequest):
    description = req.description.strip()
    if not description:
        raise HTTPException(status_code=400, detail="Description is required")

    try:
        parsed = translate_targeting_query(description)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to interpret description: {exc}")

    iab_ids         = parsed.get("iab_ids", [])
    iab_names       = parsed.get("iab_names", iab_ids)
    google_keywords = parsed.get("google_keywords", [])
    match_keywords  = parsed.get("match_keywords", [])
    rationale       = parsed.get("rationale", "")

    if not iab_ids and not google_keywords:
        raise HTTPException(status_code=422, detail="Could not extract targeting criteria from that description")

    results = query_targeting(
        iab_ids=iab_ids,
        google_keywords=google_keywords,
        match_keywords=match_keywords,
    )

    return {
        "rationale": rationale,
        "iab_ids": iab_ids,
        "iab_names": iab_names,
        "match_keywords": match_keywords,
        "google_keywords": google_keywords,
        "results": results,
        "total": len(results),
    }


@app.get("/api/lookup")
async def api_lookup(url: str):
    record = get_categorization(url)
    if not record:
        raise HTTPException(status_code=404, detail="URL not found in cache")
    return {**record, "cached": True}


# Serve the frontend — must come after API routes
static_dir = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
