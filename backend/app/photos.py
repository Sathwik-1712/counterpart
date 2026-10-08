"""Photos of the business itself: its own website, its Google Maps listing (Places API), and owner uploads.

Posts use real photos of the real place instead of invented pictures. A vision model reads each photo once
(caption, kind, tags, usable or not); posts are then matched to photos deterministically, without a model call.

Fetching is guarded: only public http(s) hosts on standard ports (no internal addresses), a size cap per file,
and a cap on how many files one import may pull.
"""

import asyncio
import base64
import io
import ipaddress
import logging
import re
import socket
import uuid
from html.parser import HTMLParser
from typing import Any, Literal
from urllib.parse import urljoin, urlparse

import httpx
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from app import ledger
from app.config import get_settings
from app.db import Conn, connection, fetch_all, fetch_one
from app.storage import get_storage

log = logging.getLogger(__name__)

MAX_BYTES = 8 * 1024 * 1024
MIN_SIDE = 300
MAX_SIDE = 1600
MAX_PER_IMPORT = 24
UA = "Mozilla/5.0 (compatible; CounterpartBot/0.2; +https://counterpart.app/bot)"
SKIP = re.compile(r"(logo|icon|favicon|sprite|avatar|pixel|tracking|badge|placeholder|spinner|loader|emoji|flag|social|insta|facebook|twitter|whatsapp|youtube|cart|map\.|qr)",
                  re.I)
PAGE_HINT = re.compile(r"(gallery|photo|menu|food|about|products?|shop|services?|our-|portfolio)", re.I)
USABLE_KINDS = {"food", "drink", "product", "interior", "exterior", "people", "service"}


class UnsafeURL(ValueError):
    pass


# ------------------------------------------------------------------ fetching


def _check_url(url: str) -> str:
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise UnsafeURL("Only http and https links can be imported.")
    if p.port not in (None, 80, 443):
        raise UnsafeURL("Only standard web ports can be imported.")
    try:
        infos = socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme == "https" else 80))
    except socket.gaierror as e:
        raise UnsafeURL(f"Could not find {p.hostname}.") from e
    for info in infos:
        if not ipaddress.ip_address(info[4][0]).is_global:
            raise UnsafeURL("That address is not a public website.")
    return url


async def _get(c: httpx.AsyncClient, url: str, *, limit: int = MAX_BYTES) -> tuple[str, bytes] | None:
    """GET with the safety check applied to every redirect hop and a byte cap. Returns (content type, body)."""
    for _ in range(5):
        await asyncio.to_thread(_check_url, url)
        async with c.stream("GET", url, headers={"User-Agent": UA}) as r:
            if r.is_redirect and r.headers.get("location"):
                url = urljoin(url, r.headers["location"])
                continue
            if r.status_code != 200:
                return None
            body = bytearray()
            async for chunk in r.aiter_bytes():
                body.extend(chunk)
                if len(body) > limit:
                    return None
            return r.headers.get("content-type", ""), bytes(body)
    return None


class _ImgParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.images: list[str] = []
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k: v or "" for k, v in attrs}
        if tag == "meta" and a.get("property", a.get("name", "")) in ("og:image", "og:image:url", "twitter:image"):
            self.images.insert(0, a.get("content", ""))
        elif tag == "img" or tag == "source":
            if srcset := a.get("srcset") or a.get("data-srcset"):
                # take the largest candidate in a srcset
                best = max((part.strip().split(" ") for part in srcset.split(",") if part.strip()),
                           key=lambda x: int(re.sub(r"\D", "", x[1]) or 0) if len(x) > 1 else 0)
                self.images.append(best[0])
            for k in ("data-src", "data-lazy-src", "src"):
                if a.get(k) and not a[k].startswith("data:"):
                    self.images.append(a[k])
                    break
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"])


def _normalise(img: bytes) -> tuple[bytes, int, int] | None:
    """Open, drop tiny or odd images, strip metadata, resize, re-encode as JPEG."""
    try:
        im = Image.open(io.BytesIO(img))
        im.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        return None
    w, h = im.size
    if min(w, h) < MIN_SIDE or max(w, h) / max(min(w, h), 1) > 3:
        return None
    im = im.convert("RGB")
    im.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    im.save(out, "JPEG", quality=86, optimize=True)
    return out.getvalue(), im.size[0], im.size[1]


async def save_photo(conn: Conn, business: dict[str, Any], data: bytes, *, source: str, source_url: str | None = None,
                     attribution: str | None = None) -> dict[str, Any] | None:
    norm = await asyncio.to_thread(_normalise, data)
    if not norm:
        return None
    jpg, w, h = norm
    if source_url and await fetch_one(conn, "select 1 from business_photos where business_id = %s and source_url = %s",
                                      (business["id"], source_url)):
        return None
    key = await get_storage().put(f"{business['slug']}/photos/{uuid.uuid4().hex}.jpg", jpg, "image/jpeg")
    return await fetch_one(
        conn,
        """insert into business_photos (business_id, source, source_url, attribution, image_key, width, height)
           values (%s, %s, %s, %s, %s, %s, %s) returning *""",
        (business["id"], source, source_url, attribution, key, w, h))


async def import_website(business: dict[str, Any], url: str) -> int:
    """The business's own site: Open Graph image, page images, and a few gallery/menu/about pages."""
    url = url if "://" in url else f"https://{url}"
    host = urlparse(url).hostname
    found: list[str] = []
    async with httpx.AsyncClient(timeout=15) as c:
        pages, seen_pages = [url], set()
        while pages and len(seen_pages) < 5:
            page = pages.pop(0)
            if page in seen_pages:
                continue
            seen_pages.add(page)
            try:
                got = await _get(c, page, limit=3 * 1024 * 1024)
            except httpx.HTTPError:
                got = None
            if got is None or "html" not in got[0]:
                if page == url:
                    raise UnsafeURL("Could not open that website.")
                continue
            p = _ImgParser()
            p.feed(got[1].decode("utf-8", errors="replace"))
            for src in p.images:
                full = urljoin(page, src.strip())
                if full not in found and not SKIP.search(full) and not full.lower().split("?")[0].endswith((".svg", ".gif")):
                    found.append(full)
            if page == url:
                for href in p.links:
                    full = urljoin(page, href).split("#")[0]
                    if urlparse(full).hostname == host and PAGE_HINT.search(full) and full not in pages:
                        pages.append(full)
        saved = 0
        for src in found[: MAX_PER_IMPORT * 2]:
            if saved >= MAX_PER_IMPORT:
                break
            try:
                got = await _get(c, src)
            except (UnsafeURL, httpx.HTTPError):
                continue
            if got is None or not got[0].startswith("image/"):
                continue
            async with connection() as conn:
                if await save_photo(conn, business, got[1], source="website", source_url=src,
                                    attribution=f"From {host}"):
                    saved += 1
    return saved


async def import_google(business: dict[str, Any], query: str | None = None) -> int:
    """Photos from the business's Google Maps listing via the official Places API (New), with attribution."""
    key = get_settings().google_maps_api_key
    if key is None:
        return 0
    k = key.get_secret_value()
    q = query or f"{business['name']}, {business['locality']}, {business['city']}"
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as c:
        r = await c.post("https://places.googleapis.com/v1/places:searchText",
                         headers={"X-Goog-Api-Key": k, "X-Goog-FieldMask": "places.id,places.photos"},
                         json={"textQuery": q, "maxResultCount": 1})
        if r.status_code != 200:
            raise RuntimeError(f"Google Places search failed: {r.text[:200]}")
        places = r.json().get("places") or []
        if not places:
            return 0
        saved = 0
        for ph in (places[0].get("photos") or [])[:10]:
            m = await c.get(f"https://places.googleapis.com/v1/{ph['name']}/media",
                            params={"maxWidthPx": MAX_SIDE, "key": k})
            if m.status_code != 200 or not m.headers.get("content-type", "").startswith("image/"):
                continue
            who = ", ".join(a.get("displayName", "") for a in ph.get("authorAttributions") or [] if a.get("displayName"))
            async with connection() as conn:
                if await save_photo(conn, business, m.content, source="google", source_url=f"google:{ph['name']}",
                                    attribution=f"Google Maps{f', photo by {who}' if who else ''}"):
                    saved += 1
    return saved


# ------------------------------------------------------------------ reading photos (vision model)


class PhotoNote(BaseModel):
    index: int
    caption: str = Field(description="One plain sentence: what is in the photo.")
    kind: Literal["food", "drink", "product", "interior", "exterior", "people", "service", "menu_or_text", "logo",
                  "other"]
    tags: list[str] = Field(description="3 to 8 lowercase words: items, setting, mood.")
    usable: bool = Field(description="False if blurry, mostly text, a logo, a screenshot, or not of this business.")


class PhotoNotes(BaseModel):
    photos: list[PhotoNote]


def _thumb(data: bytes) -> str:
    im = Image.open(io.BytesIO(data)).convert("RGB")
    im.thumbnail((512, 512))
    out = io.BytesIO()
    im.save(out, "JPEG", quality=80)
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode()


async def _read_bytes(key: str) -> bytes | None:
    s = get_settings()
    if s.storage_backend == "local":
        path = s.storage_dir / key
        return path.read_bytes() if path.exists() else None
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(get_storage().url(key))
        return r.content if r.status_code == 200 else None


async def describe_new(router: Any, business: dict[str, Any], *, batch: int = 6, max_batches: int = 4) -> int:
    """Caption photos that have none yet, several per model call (the free tier counts requests, not images)."""
    if not router.available("vision"):
        return 0
    from app.providers.router import call_scope

    done = 0
    for _ in range(max_batches):
        async with connection() as conn:
            rows = await fetch_all(conn, """select id, image_key from business_photos where business_id = %s
                                            and caption is null order by created_at limit %s""", (business["id"], batch))
        if not rows:
            break
        parts: list[dict[str, Any]] = [{"type": "text", "text": (
            f"These are photos found for {business['name']}, a {business['profile'].get('kind', 'local business')} in "
            f"{business['locality']}, {business['city']}. For each photo (index = order, from 0) give a caption, "
            "kind, tags and whether it is usable as the picture of a marketing post for this business.")}]
        for r in rows:
            data = await _read_bytes(r["image_key"])
            if data:
                parts.append({"type": "image_url", "image_url": {"url": await asyncio.to_thread(_thumb, data)}})
        try:
            with call_scope(business_id=str(business["id"]), task="read_photos"):
                notes, _ = await router.chat_json("vision", [{"role": "user", "content": parts}], PhotoNotes)
        except Exception as e:  # keep the photos; they can be read later
            log.warning("photo reading failed: %s", e)
            break
        by_index = {n.index: n for n in notes.photos}
        async with connection() as conn:
            for i, r in enumerate(rows):
                n = by_index.get(i)
                if n is None:
                    await conn.execute("update business_photos set caption = '' where id = %s", (r["id"],))
                    continue
                ok = n.usable and n.kind in USABLE_KINDS
                await conn.execute(
                    """update business_photos set caption = %s, kind = %s, tags = %s,
                       status = case when %s then status else 'hidden' end where id = %s""",
                    (n.caption[:300], n.kind, [t.lower()[:40] for t in n.tags[:8]], ok, r["id"]))
                done += 1
    return done


async def import_all(router: Any, business: dict[str, Any], *, website: str | None, google: bool) -> dict[str, Any]:
    """Background job after onboarding or when the owner asks: fetch, read, and log what happened."""
    out: dict[str, Any] = {"website": 0, "google": 0, "errors": []}
    if website:
        try:
            out["website"] = await import_website(business, website)
        except (UnsafeURL, httpx.HTTPError) as e:
            out["errors"].append(f"Website: {e}")
    if google:
        try:
            out["google"] = await import_google(business)
        except (RuntimeError, httpx.HTTPError) as e:
            out["errors"].append(str(e)[:200])
    out["read"] = await describe_new(router, business)
    async with connection() as conn:
        n = out["website"] + out["google"]
        await ledger.record(conn, business["id"], "photos.imported",
                            f"Found {n} photo{'s' if n != 1 else ''} of {business['name']}"
                            + (f" ({out['website']} from the website, {out['google']} from Google Maps)" if n else "")
                            + (f". {'; '.join(out['errors'])}" if out["errors"] else ""),
                            actor="agent", payload=out)
    return out


# ------------------------------------------------------------------ matching a post to a photo


_WORD = re.compile(r"[a-z]{3,}")


def score(photo: dict[str, Any], concept: str, used: int) -> float:
    words = set(_WORD.findall(concept.lower()))
    have = set(photo.get("tags") or []) | set(_WORD.findall((photo.get("caption") or "").lower()))
    s = 2.0 * len(words & have)
    s += {"food": 1.5, "drink": 1.5, "product": 1.5, "interior": 0.8, "service": 1.0, "exterior": 0.5}.get(
        photo.get("kind") or "", 0)
    s += 0.3 if photo.get("source") in ("upload", "google", "website") else 0
    return s - 5.0 * used  # variety across a campaign beats one more matching word


async def choose(conn: Conn, business_id: Any, campaign_id: Any, concept: str) -> dict[str, Any] | None:
    photos = await fetch_all(conn, """select * from business_photos where business_id = %s and status = 'active'
                                      and coalesce(kind, 'other') <> all(%s)""",
                             (business_id, ["menu_or_text", "logo"]))
    if not photos:
        return None
    used_rows = await fetch_all(
        conn, """select r.image_key, count(*)::int as n from assets a join asset_revisions r
                 on r.asset_id = a.id and r.n = a.current_revision
                 where a.campaign_id = %s and r.image_key is not null group by r.image_key""", (campaign_id,))
    used = {r["image_key"]: r["n"] for r in used_rows}
    return max(photos, key=lambda p: (score(p, concept, used.get(p["image_key"], 0)), p["created_at"]))
