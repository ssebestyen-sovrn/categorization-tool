import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

load_dotenv(override=True)

from database import init_db, get_categorization, save_categorization, get_all_categorizations
from scraper import scrape_url
from categorizer import categorize_content


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="URL Categorization Tool — IAB 3.0", lifespan=lifespan)


class CategorizeRequest(BaseModel):
    url: str


@app.post("/api/categorize")
async def api_categorize(req: CategorizeRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    # Return cached result without re-crawling
    cached = get_categorization(url)
    if cached:
        return {**cached, "cached": True}

    # Scrape
    try:
        page_data = scrape_url(url)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not fetch URL: {exc}")

    # Categorize via Claude
    try:
        result = categorize_content(url, page_data)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Categorization failed: {exc}")

    # Persist
    save_categorization(result)

    return {**result, "cached": False}


@app.get("/api/history")
async def api_history():
    return get_all_categorizations()


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
