import re
import warnings
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse

warnings.filterwarnings("ignore", message="Unverified HTTPS request")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate",
}

STRIP_TAGS = [
    "script", "style", "noscript", "nav", "footer", "header",
    "aside", "iframe", "svg", "form", "button", "input", "select",
    "textarea", "figure", "figcaption",
]

MAX_BODY_CHARS = 4500


def _normalize_url(url: str) -> str:
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


def _extract_domain(url: str) -> str:
    parsed = urlparse(url)
    domain = parsed.netloc or parsed.path
    return domain.replace("www.", "")


def _get_meta(soup: BeautifulSoup, name: str = None, prop: str = None) -> str:
    tag = None
    if name:
        tag = soup.find("meta", attrs={"name": name})
    if not tag and prop:
        tag = soup.find("meta", property=prop)
    if tag:
        return (tag.get("content") or "").strip()
    return ""


def scrape_url(raw_url: str) -> dict:
    url = _normalize_url(raw_url)
    domain = _extract_domain(url)

    session = requests.Session()
    session.headers.update(HEADERS)

    try:
        response = session.get(url, timeout=15, allow_redirects=True)
        response.raise_for_status()
    except requests.exceptions.SSLError:
        response = session.get(url, timeout=15, allow_redirects=True, verify=False)
        response.raise_for_status()

    final_url = response.url

    try:
        soup = BeautifulSoup(response.content, "lxml")
    except Exception:
        soup = BeautifulSoup(response.content, "html.parser")

    # Title
    title = ""
    title_tag = soup.find("title")
    if title_tag:
        title = title_tag.get_text(strip=True)
    if not title:
        title = _get_meta(soup, prop="og:title") or _get_meta(soup, name="twitter:title")

    # Meta description
    meta_desc = (
        _get_meta(soup, name="description")
        or _get_meta(soup, prop="og:description")
        or _get_meta(soup, name="twitter:description")
    )

    # Keywords meta (often empty, but worth capturing)
    meta_keywords = _get_meta(soup, name="keywords")

    # Headings (first 5 of each level)
    headings = []
    for level in ("h1", "h2", "h3"):
        for tag in soup.find_all(level)[:5]:
            text = tag.get_text(strip=True)
            if text and len(text) < 200:
                headings.append(f"{level.upper()}: {text}")

    # Body text — strip noisy elements first
    for tag in soup(STRIP_TAGS):
        tag.decompose()

    # Prefer <main> or <article> content; fall back to <body>
    content_root = (
        soup.find("main")
        or soup.find("article")
        or soup.find(id=re.compile(r"(content|main|body)", re.I))
        or soup.find("body")
        or soup
    )

    raw_text = content_root.get_text(separator=" ", strip=True)
    body_text = re.sub(r"\s{2,}", " ", raw_text).strip()

    if len(body_text) > MAX_BODY_CHARS:
        body_text = body_text[:MAX_BODY_CHARS] + "…"

    return {
        "url": final_url,
        "domain": domain,
        "title": title,
        "meta_description": meta_desc,
        "meta_keywords": meta_keywords,
        "headings": headings,
        "body_text": body_text,
    }
