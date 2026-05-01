import os
import json
import anthropic
from taxonomy import get_taxonomy_context


def _client():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set. Add it to your .env file.")
    return anthropic.Anthropic(api_key=api_key)

SYSTEM_PROMPT = """You are an expert content analyst and URL categorizer using the IAB Content Taxonomy 3.0.

Given information about a web page, you will:
1. Assign one or more IAB 3.0 categories that accurately describe the content
2. Provide a confidence score (0.0–1.0) per category
3. Identify overall sentiment
4. Extract the 5–10 most important keywords
5. Extract named entities (people, organizations, brands, products)
6. Extract geographic locations mentioned

CATEGORIZATION RULES:
- Always assign at least one Tier 1 category; include the best-matching Tier 2 subcategory when one clearly applies
- Include additional categories only if content is genuinely diverse (e.g., a tech news article = Technology + News, not just Technology)
- Confidence reflects how certain you are given the available content; be honest about uncertainty
- Do NOT invent categories not in the provided taxonomy list
- Base judgments on page content — not just the domain name or URL path

Return ONLY a single valid JSON object. No explanation, no markdown fences, no extra text. Use this exact schema:

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
  "keywords": ["machine learning", "neural networks", "GPT"],
  "entities": ["OpenAI", "Sam Altman", "Microsoft"],
  "locations": ["San Francisco", "United States"]
}

sentiment.label must be one of: positive, negative, neutral
sentiment.score is a float from -1.0 (most negative) to 1.0 (most positive)
tier2_id and tier2_name may be null if no subcategory clearly applies"""


def categorize_content(url: str, page_data: dict) -> dict:
    taxonomy_context = get_taxonomy_context()

    headings_block = "\n".join(page_data.get("headings", [])) or "None found"
    body_preview = page_data.get("body_text", "") or "No content extracted"

    user_message = f"""Categorize this web page using the IAB Content Taxonomy 3.0 categories listed below.

--- PAGE INFO ---
URL: {url}
Domain: {page_data.get('domain', '')}
Title: {page_data.get('title', 'N/A')}
Meta Description: {page_data.get('meta_description', 'N/A')}
Meta Keywords: {page_data.get('meta_keywords', 'N/A')}

Headings:
{headings_block}

Content Preview:
{body_preview}

--- IAB 3.0 TAXONOMY ---
{taxonomy_context}"""

    response = _client().messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    raw = response.content[0].text.strip()

    # Strip accidental markdown fences
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.rsplit("```", 1)[0].strip()

    result = json.loads(raw)

    # Annotate each category with a flagged field
    categories = result.get("categories", [])
    for cat in categories:
        cat["flagged"] = float(cat.get("confidence", 0)) < 0.5

    any_flagged = any(c["flagged"] for c in categories)

    return {
        "url": page_data.get("url", url),
        "domain": page_data.get("domain", ""),
        "title": page_data.get("title", ""),
        "categories": categories,
        "sentiment": result.get("sentiment", {"label": "neutral", "score": 0.0}),
        "keywords": result.get("keywords", []),
        "entities": result.get("entities", []),
        "locations": result.get("locations", []),
        "flagged": any_flagged,
    }
