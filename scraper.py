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
LEAN_BODY_CHARS = 800
JINA_FALLBACK_THRESHOLD = 150  # chars — try Jina if body text is shorter than this


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


_JINA_ERROR_PREFIXES = ("failed to fetch", "failed to parse", "error:", "unable to")

def _fetch_jina(url: str) -> str:
    """Fetch clean text via Jina AI Reader as fallback for JS-heavy / bot-blocked pages."""
    try:
        resp = requests.get(
            f"https://r.jina.ai/{url}",
            headers={"Accept": "text/plain", "X-Return-Format": "text"},
            timeout=20,
        )
        if resp.ok:
            text = re.sub(r"\s{2,}", " ", resp.text).strip()
            # Jina sometimes returns error text with a 200 — treat as failure
            if any(text.lower().startswith(p) for p in _JINA_ERROR_PREFIXES):
                return ""
            return text[:MAX_BODY_CHARS]
    except Exception:
        pass
    return ""


_PRODUCT_URL_RE = re.compile(
    r'/(product[s]?|item[s]?|p|dp|sku|buy|shop/[^/]+/[^/]+|c/product|pdp|detail)/',
    re.I,
)
_BUY_RE = re.compile(
    r'\b(add to (cart|bag|basket|trolley)|buy now|purchase now|checkout|'
    r'order now|add to cart|buy online)\b', re.I,
)
_PRICE_RE = re.compile(r'[\$\£\€\¥]\s*\d[\d,]*(\.\d{1,2})?')
_STOCK_RE = re.compile(
    r'\b(in stock|out of stock|ships in|free shipping|sold out|'
    r'qty[:\s]|quantity[:\s]|sku[:\s#]|item\s*#|add to cart|availability)\b', re.I,
)


def detect_page_type(soup: BeautifulSoup, body_text: str, url: str = "") -> str:
    """
    Returns 'product' if the page has clear purchase signals, else 'content'.
    A page is a product page only if a user can directly buy from it.
    Reviews, descriptions, and editorial content remain 'content'.
    """
    score = 0
    text_sample = body_text[:4000] if body_text else ""

    # URL path patterns — strong signal even without DOM access
    if url and _PRODUCT_URL_RE.search(url):
        score += 3

    # Schema.org Product or Offer markup — strongest DOM signal
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            import json as _json
            data = _json.loads(tag.string or "")
            types = []
            if isinstance(data, dict):
                types = [data.get("@type", "")]
            elif isinstance(data, list):
                types = [d.get("@type", "") for d in data if isinstance(d, dict)]
            if any(t in ("Product", "Offer", "ItemAvailability") for t in types):
                score += 4
        except Exception:
            pass

    # og:type = "product"
    og_type_tag = soup.find("meta", property="og:type")
    if og_type_tag and "product" in (og_type_tag.get("content") or "").lower():
        score += 3

    # Buy / cart button text in DOM
    button_text = " ".join(
        t.get_text(" ", strip=True)
        for t in soup.find_all(["button", "a", "input"])
    )
    if _BUY_RE.search(button_text):
        score += 3

    # Buy signals in body text (covers Jina-fetched pages with no DOM)
    if _BUY_RE.search(text_sample):
        score += 2

    # Price patterns
    if len(_PRICE_RE.findall(text_sample)) >= 1:
        score += 2

    # Stock / availability keywords
    if _STOCK_RE.search(text_sample):
        score += 1

    return "product" if score >= 3 else "content"


def scrape_url(raw_url: str, lean: bool = False, force_type: str = None) -> dict:
    """
    Scrape a URL and return structured page data.
    lean=True       — title + meta + headings only (fast, for bulk batches)
    lean=False      — full body text + Jina fallback for sparse pages
    force_type      — 'product' or 'content' to override auto-detection
    """
    url = _normalize_url(raw_url)
    domain = _extract_domain(url)

    session = requests.Session()
    session.headers.update(HEADERS)

    jina_fallback_text = ""
    final_url = url
    soup = None

    try:
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

    except Exception as http_exc:
        # Bot-blocked (403), JS-gated, or network error — try Jina immediately
        jina_text = _fetch_jina(url)
        if not jina_text:
            status = getattr(getattr(http_exc, "response", None), "status_code", None)
            if status == 403:
                raise Exception(
                    f"Access blocked (403) by {domain} — site blocks automated requests. "
                    f"Try a different URL from this domain."
                )
            raise
        jina_fallback_text = jina_text
        # Build a minimal soup from nothing so downstream code doesn't break
        soup = BeautifulSoup("", "html.parser")

    if soup is None:
        soup = BeautifulSoup("", "html.parser")

    # Title
    title = ""
    title_tag = soup.find("title")
    if title_tag:
        title = title_tag.get_text(strip=True)
    if not title:
        title = _get_meta(soup, prop="og:title") or _get_meta(soup, name="twitter:title")
    # Extract title from Jina text header when soup was empty (bot-blocked pages)
    if not title and jina_fallback_text:
        for line in jina_fallback_text.splitlines():
            m = re.match(r'^Title:\s*(.+)', line.strip())
            if m:
                title = m.group(1).strip()
                break
    # Last resort: derive a readable title from the URL slug
    if not title:
        from urllib.parse import urlparse
        path = urlparse(final_url or url).path.rstrip("/")
        slug = path.split("/")[-1]
        slug = re.sub(r'\.[a-z]{2,4}$', '', slug)       # strip extension
        slug = re.sub(r'^[\d\w]+-REG-?', '', slug, flags=re.I)  # strip SKU prefixes
        slug = re.sub(r'[-_]', ' ', slug).strip()
        if len(slug) > 4:
            title = slug.title()

    # Meta description
    meta_desc = (
        _get_meta(soup, name="description")
        or _get_meta(soup, prop="og:description")
        or _get_meta(soup, name="twitter:description")
    )

    # Keywords meta
    meta_keywords = _get_meta(soup, name="keywords")

    # Headings (first 5 of each level)
    headings = []
    for level in ("h1", "h2", "h3"):
        for tag in soup.find_all(level)[:5]:
            text = tag.get_text(strip=True)
            if text and len(text) < 200:
                headings.append(f"{level.upper()}: {text}")

    # Body text — skipped in lean mode
    body_text = ""
    if jina_fallback_text:
        # Already fetched via Jina due to HTTP error
        body_text = jina_fallback_text
    elif not lean:
        for tag in soup(STRIP_TAGS):
            tag.decompose()

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

        # Jina fallback for sparse pages (JS-rendered, bot-blocked, etc.)
        if len(body_text) < JINA_FALLBACK_THRESHOLD:
            jina_text = _fetch_jina(final_url)
            if len(jina_text) > len(body_text):
                body_text = jina_text

    # Page type detection
    if force_type in ("product", "content"):
        page_type = force_type
    else:
        page_type = detect_page_type(soup, body_text, url=final_url or url)

    return {
        "url": final_url,
        "domain": domain,
        "title": title,
        "meta_description": meta_desc,
        "meta_keywords": meta_keywords,
        "headings": headings,
        "body_text": body_text,
        "lean": lean,
        "page_type": page_type,
    }
