import os
import json
import anthropic
from taxonomy import get_taxonomy_context, get_google_taxonomy_context

MODEL_SONNET = "claude-sonnet-4-6"
MODEL_HAIKU  = "claude-haiku-4-5-20251001"

# ── IAB content categorizer ───────────────────────────────────────

_CONTENT_SYSTEM_BASE = """You are an expert content analyst and URL categorizer using the IAB Content Taxonomy 3.0.

Given information about a web page, you will:
1. Assign one or more IAB 3.0 categories that accurately describe the content
2. Provide a confidence score (0.0–1.0) per category
3. Identify overall sentiment
4. Extract the 5–10 most important keywords
5. Extract named entities (people, organizations, brands, products)
6. Extract geographic locations mentioned

CATEGORIZATION RULES:
- Always assign at least one Tier 1 category; include the best-matching Tier 2 subcategory when one clearly applies
- Go deeper to Tier 3 or beyond if the taxonomy supports it and the content warrants it
- Include additional categories only if content is genuinely diverse
- Confidence reflects certainty given available content; be honest about uncertainty
- Do NOT invent categories not in the taxonomy below
- Base judgments on page content — not just the domain name or URL path
- When only title/meta/headings are available (lean mode), still make your best assessment

Return ONLY a single valid JSON object. No explanation, no markdown fences, no extra text:

{
  "categories": [
    {
      "tier1_id": "26",
      "tier1_name": "Technology & Computing",
      "tier2_id": "26-1",
      "tier2_name": "Artificial Intelligence",
      "confidence": 0.94
    }
  ],
  "sentiment": {
    "label": "positive",
    "score": 0.65
  },
  "keywords": ["machine learning", "neural networks"],
  "entities": ["OpenAI", "Microsoft"],
  "locations": ["San Francisco"]
}

sentiment.label must be: positive, negative, or neutral
sentiment.score is a float from -1.0 (most negative) to 1.0 (most positive)
tier2_id and tier2_name may be null if no subcategory clearly applies"""


def _build_content_system(taxonomy_context: str) -> list:
    return [
        {"type": "text", "text": _CONTENT_SYSTEM_BASE},
        {
            "type": "text",
            "text": f"IAB Content Taxonomy 3.0 — available categories:\n\n{taxonomy_context}",
            "cache_control": {"type": "ephemeral"},
        },
    ]


# ── Google Product categorizer ────────────────────────────────────

_PRODUCT_SYSTEM_BASE = """You are an expert e-commerce analyst. You categorize product pages using the Google Product Taxonomy.

Given information about a product page, you will:
1. Assign the most specific matching Google Product Taxonomy category as a full readable path
2. Provide a confidence score (0.0–1.0)
3. Extract the brand name (the manufacturer or brand of the product, not the retailer)
4. Extract the merchant name (the retailer/store selling the product — usually evident from the domain)
5. Extract 5–10 keywords describing the product

RULES:
- Return the full taxonomy path using " > " as separator (e.g. "Apparel & Accessories > Shoes > Athletic Shoes")
- Assign the most specific subcategory that clearly matches — do not be too broad
- Brand: extract from page content; if ambiguous, infer from product name. Leave blank if truly unknown.
- Merchant: derive from the domain name (e.g. amazon.com → Amazon, nike.com → Nike)
- Confidence reflects certainty given available content
- Do NOT include sentiment, entities, or locations

Return ONLY a single valid JSON object. No explanation, no markdown fences, no extra text:

{
  "google_category": "Apparel & Accessories > Shoes > Athletic Shoes",
  "confidence": 0.91,
  "brand": "Nike",
  "merchant": "Nike",
  "keywords": ["running shoes", "air max", "cushioning", "breathable"]
}"""


def _build_product_system(taxonomy_context: str) -> list:
    return [
        {"type": "text", "text": _PRODUCT_SYSTEM_BASE},
        {
            "type": "text",
            "text": f"Google Product Taxonomy — available categories:\n\n{taxonomy_context}",
            "cache_control": {"type": "ephemeral"},
        },
    ]


# ── Shared helpers ────────────────────────────────────────────────

def _client():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set. Add it to your .env file.")
    return anthropic.Anthropic(api_key=api_key)


def _parse_json(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.rsplit("```", 1)[0].strip()
    return json.loads(raw)


def _page_context(url: str, page_data: dict) -> str:
    headings_block = "\n".join(page_data.get("headings", [])) or "None found"
    body_preview   = page_data.get("body_text", "") or "Not extracted (lean mode)"
    lean_note      = " [lean mode — title/meta/headings only]" if page_data.get("lean") else ""
    return (
        f"URL: {url}\n"
        f"Domain: {page_data.get('domain', '')}\n"
        f"Title: {page_data.get('title', 'N/A')}\n"
        f"Meta Description: {page_data.get('meta_description', 'N/A')}\n"
        f"Meta Keywords: {page_data.get('meta_keywords', 'N/A')}\n\n"
        f"Headings:\n{headings_block}\n\n"
        f"Content Preview{lean_note}:\n{body_preview}"
    )


# ── Public API ────────────────────────────────────────────────────

def categorize_content(url: str, page_data: dict, model: str = MODEL_SONNET) -> dict:
    taxonomy_context = get_taxonomy_context()
    user_message = f"Categorize this content page.\n\n{_page_context(url, page_data)}"

    response = _client().messages.create(
        model=model,
        max_tokens=1024,
        system=_build_content_system(taxonomy_context),
        messages=[{"role": "user", "content": user_message}],
    )

    result = _parse_json(response.content[0].text)
    categories = result.get("categories", [])
    for cat in categories:
        cat["flagged"] = float(cat.get("confidence", 0)) < 0.5

    return {
        "url": page_data.get("url", url),
        "domain": page_data.get("domain", ""),
        "title": page_data.get("title", ""),
        "page_type": "content",
        "categories": categories,
        "sentiment": result.get("sentiment", {"label": "neutral", "score": 0.0}),
        "keywords": result.get("keywords", []),
        "entities": result.get("entities", []),
        "locations": result.get("locations", []),
        "flagged": any(c["flagged"] for c in categories),
        "model": model,
    }


def categorize_product(url: str, page_data: dict, model: str = MODEL_SONNET) -> dict:
    taxonomy_context = get_google_taxonomy_context()
    user_message = f"Categorize this product page.\n\n{_page_context(url, page_data)}"

    response = _client().messages.create(
        model=model,
        max_tokens=512,
        system=_build_product_system(taxonomy_context),
        messages=[{"role": "user", "content": user_message}],
    )

    result = _parse_json(response.content[0].text)
    confidence = float(result.get("confidence", 0))

    return {
        "url": page_data.get("url", url),
        "domain": page_data.get("domain", ""),
        "title": page_data.get("title", ""),
        "page_type": "product",
        "google_category": result.get("google_category", ""),
        "confidence": confidence,
        "flagged": confidence < 0.5,
        "brand": result.get("brand", ""),
        "merchant": result.get("merchant", ""),
        "keywords": result.get("keywords", []),
        "categories": [],
        "sentiment": {},
        "entities": [],
        "locations": [],
        "model": model,
    }


def categorize(url: str, page_data: dict, model: str = MODEL_SONNET, force_type: str = None) -> dict:
    """Route to product or content categorizer based on detected page type."""
    page_type = force_type or page_data.get("page_type", "content")
    if page_type == "product":
        return categorize_product(url, page_data, model=model)
    return categorize_content(url, page_data, model=model)
