"""Sign-up from one link: the owner pastes their website or Google Maps link and the form fills itself.

What can be read is read; nothing is invented. The model only points at things on the page. Every item and price
it returns must appear in the page text, or it is dropped, and the owner checks the whole form before saving.
A Google Maps link is looked up with the official Places API when a key is set; otherwise only the name in
the link is used. Google pages themselves are never scraped.
"""

import asyncio
import json
import re
from typing import Any
from urllib.parse import parse_qs, unquote, urljoin, urlparse

import httpx
from pydantic import BaseModel, Field

from app.config import get_settings
from app.photos import UA, UnsafeURL, _check_url
from app.reviews import fetch_pages

PAGE_HINT = re.compile(r"(menu|price|rate|services?|products?|shop|about|contact|visit|find-us|location)", re.I)
MAX_TEXT = 20_000
KINDS = ["Café", "Restaurant", "Bakery", "Sweet shop", "Salon", "Clothing store", "Grocery", "Gym", "Clinic"]


class Item(BaseModel):
    name: str = Field(description="Item or service exactly as written on the page")
    price: float = Field(gt=0, description="Price in rupees exactly as shown on the page")


class Read(BaseModel):
    name: str | None = None
    kind: str | None = Field(None, description=f"One of {KINDS}, or a short plain word if none fits")
    city: str | None = None
    locality: str | None = Field(None, description="Area, street or neighbourhood within the city")
    phone: str | None = Field(None, description="The business's mobile or WhatsApp number as written")
    offerings: list[Item] = Field(default_factory=list, description="Up to 30 items or services that show a price")


SYSTEM = """You read a small business's own website to pre-fill its sign-up form.
Only report what the text states. Leave a field null if it is not stated. Never guess a city from a phone code,
never round or convert prices, never invent items. Copy item names as written (fix only obvious capitalisation).
Prices are in Indian rupees; skip items without a clear price, and skip ranges, combos you cannot price, and
delivery-app prices. kind is what the business is (e.g. Café, Salon), not a description."""


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().casefold()


def _price_shown(price: float, text: str) -> bool:
    n = f"{price:.2f}".rstrip("0").rstrip(".")
    return re.search(rf"(?<![\d.,]){re.escape(n)}(?:\.0+)?(?![\d])", text.replace(",", "")) is not None


def checked(read: Read, text: str) -> tuple[dict[str, Any], int]:
    """Keep only what the page actually says. -> (fields, dropped items)."""
    low = _norm(text)
    out: dict[str, Any] = {}
    for f in ("name", "city", "locality"):
        v = (getattr(read, f) or "").strip()
        if v and _norm(v) in low:
            out[f] = v
    if read.kind:
        out["kind"] = next((k for k in KINDS if k.casefold() == read.kind.strip().casefold()), read.kind.strip()[:40])
    if read.phone:  # only an Indian mobile can take WhatsApp claims; landlines and toll-free numbers are skipped
        digits = re.sub(r"\D", "", read.phone)
        prefix, last = digits[:-10], digits[-10:]
        if prefix in ("", "0", "91") and re.fullmatch(r"[6-9]\d{9}", last) and last in re.sub(r"\D", "", text):
            out["phone"] = "+91" + last
    items, seen = [], set()
    for it in read.offerings[:40]:
        key = _norm(it.name)
        if len(key) >= 2 and key in low and key not in seen and _price_shown(it.price, text):
            seen.add(key)
            items.append({"name": it.name.strip(), "price": it.price})
    out["offerings"] = items[:30]
    return out, len(read.offerings) - len(items)


def _ld_business(blocks: list[str]) -> dict[str, Any]:
    """schema.org LocalBusiness / Restaurant markup: the site states these fields itself."""
    found: dict[str, Any] = {}

    def walk(o: Any) -> None:
        if isinstance(o, list):
            for x in o:
                walk(x)
        elif isinstance(o, dict):
            if isinstance(o.get("address"), dict) and o.get("name") and not found:
                a = o["address"]
                found.update({"name": o.get("name"), "city": a.get("addressLocality"),
                              "locality": a.get("streetAddress"), "phone": o.get("telephone")})
            for v in o.values():
                walk(v)

    for b in blocks:
        try:
            walk(json.loads(b))
        except ValueError:
            continue
    return {k: v for k, v in found.items() if isinstance(v, str) and v.strip()}


def is_maps_link(link: str) -> bool:
    host = urlparse(link if "://" in link else f"https://{link}").hostname or ""
    path = urlparse(link if "://" in link else f"https://{link}").path
    return host in ("maps.app.goo.gl", "g.co") or host.startswith("maps.google.") or (
        ("google." in host or host == "goo.gl") and path.startswith("/maps"))


async def _final_url(link: str) -> str:
    """Follow a short Maps link's redirects (each hop checked) without reading the page."""
    url = link if "://" in link else f"https://{link}"
    async with httpx.AsyncClient(timeout=10) as c:
        for _ in range(6):
            await asyncio.to_thread(_check_url, url)
            r = await c.head(url, headers={"User-Agent": UA})
            if r.is_redirect and r.headers.get("location"):
                url = urljoin(url, r.headers["location"])
                continue
            break
    return url


def name_in_maps_url(url: str) -> str | None:
    p = urlparse(url)
    if m := re.search(r"/maps/place/([^/@]+)", p.path):
        return unquote(m.group(1).replace("+", " ")).strip() or None
    q = parse_qs(p.query).get("q") or parse_qs(p.query).get("query")
    return q[0].strip() if q else None


async def _places(query: str) -> dict[str, Any]:
    key = get_settings().google_maps_api_key
    if key is None:
        return {}
    fields = "places.displayName,places.addressComponents,places.internationalPhoneNumber,places.websiteUri"
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post("https://places.googleapis.com/v1/places:searchText",
                         headers={"X-Goog-Api-Key": key.get_secret_value(), "X-Goog-FieldMask": fields},
                         json={"textQuery": query, "maxResultCount": 1})
    places = r.json().get("places") if r.status_code == 200 else None
    if not places:
        return {}
    p = places[0]
    comp = {t: c.get("longText") for c in p.get("addressComponents") or [] for t in c.get("types") or []}
    return {k: v for k, v in {
        "name": (p.get("displayName") or {}).get("text"),
        "city": comp.get("locality") or comp.get("administrative_area_level_3"),
        "locality": comp.get("sublocality_level_1") or comp.get("sublocality") or comp.get("neighborhood"),
        "phone": p.get("internationalPhoneNumber"),
        "website": p.get("websiteUri"),
    }.items() if v}


async def read_link(router: Any, link: str) -> dict[str, Any]:
    """-> the fields the form can use, plus `from` (what was read) and `notes` for the owner."""
    link = link.strip()
    notes: list[str] = []
    out: dict[str, Any] = {"offerings": []}
    website = link
    if is_maps_link(link):
        final = await _final_url(link)
        name = name_in_maps_url(final)
        place = await _places(name or final) if (name or "/maps" in final) else {}
        if place:
            out.update({k: v for k, v in place.items() if k != "website"})
            notes.append("Name, area and phone from your Google Maps listing.")
        elif name:
            out["name"] = name
            notes.append("Only the name could be read from a Maps link on this server. Add your website for more.")
        else:
            raise UnsafeURL("Could not read that Maps link. Paste your website instead, or fill the form yourself.")
        website = place.get("website")
        if website:
            out["website"] = website
    else:
        out["website"] = link if "://" in link else f"https://{link}"
    if website:
        try:
            text, ld = await fetch_pages(website, PAGE_HINT, max_pages=4)
        except (UnsafeURL, httpx.HTTPError):
            if not out.get("name"):
                raise UnsafeURL("Could not open that website. Check the address, or fill the form yourself.") from None
            text, ld = "", []
        marked = _ld_business(ld)
        if text.strip():
            result, _ = await router.chat_json(
                "verification",
                [{"role": "system", "content": SYSTEM},
                 {"role": "user", "content": (text + ("\n\nThe site's own markup: " + json.dumps(marked) if marked else ""))[:MAX_TEXT]}],
                Read, temperature=0)
            fields, dropped = checked(result, text + "\n" + " ".join(marked.values()))
            for k, v in fields.items():
                if v and not out.get(k):
                    out[k] = v
            if dropped:
                notes.append(f"Left out {dropped} item{'s' if dropped != 1 else ''} whose price was not clearly on the page.")
        if any("ಀ" <= ch <= "೿" for ch in text):
            out["languages"] = ["en", "kn"] + (["hi"] if any("ऀ" <= ch <= "ॿ" for ch in text) else [])
        elif any("ऀ" <= ch <= "ॿ" for ch in text):
            out["languages"] = ["en", "hi"]
    if out["offerings"]:
        notes.append(f"Found {len(out['offerings'])} items with prices. Check them, and add what you pay for each if you like.")
    return {**out, "notes": notes}
