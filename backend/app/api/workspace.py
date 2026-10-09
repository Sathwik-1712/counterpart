"""Accounts and workspace: sign-up and sign-in, the demo, onboarding a new business, its photo library,
and the read-outs that show the owner what the agents are doing and how campaigns convert."""

import base64
import binascii
import re
import secrets
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Request
from pydantic import BaseModel, Field

from app import auth, ledger, photos, services
from app.api.deps import get_router, require_owner
from app.auth import CurrentUser, business_for, require_member
from app.config import get_settings
from app.db import connection, fetch_all, fetch_one, jsonb
from app.domain.facts import AI_CLICHES, machine_voice
from app.storage import get_storage

accounts = APIRouter(prefix="/api", dependencies=[Depends(require_owner)])


# ------------------------------------------------------------------ sign-in


class Credentials(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=254)
    password: str = Field(min_length=8, max_length=128)


class RefreshBody(BaseModel):
    refresh_token: str


@accounts.post("/auth/signup")
async def signup(body: Credentials) -> dict[str, Any]:
    return await auth.sign_up(body.email, body.password)


@accounts.post("/auth/login")
async def login(body: Credentials) -> dict[str, Any]:
    return await auth.sign_in(body.email, body.password)


@accounts.post("/auth/refresh")
async def refresh(body: RefreshBody) -> dict[str, Any]:
    return await auth.refresh(body.refresh_token)


@accounts.post("/auth/logout")
async def logout(authorization: str | None = Header(default=None)) -> dict[str, bool]:
    if authorization and authorization.lower().startswith("bearer "):
        await auth.sign_out(authorization[7:].strip())
    return {"ok": True}


@accounts.post("/auth/demo")
async def demo() -> dict[str, Any]:
    """'Try the demo': a shared account that can open the demo business only."""
    s = get_settings()
    if s.demo_password is None:
        raise services.Conflict("The demo is not set up on this server (DEMO_PASSWORD).")
    session = await auth.sign_in_or_create(s.demo_email, s.demo_password.get_secret_value())
    async with connection() as conn:
        await conn.execute(
            """insert into memberships (user_id, business_id, role)
               select %s, id, 'owner' from businesses where is_demo on conflict do nothing""",
            (session["user"]["id"],))
    return session


@accounts.get("/me")
async def me(user: CurrentUser) -> dict[str, Any]:
    async with connection() as conn:
        rows = await fetch_all(
            conn, """select b.id, b.slug, b.name, b.locality, b.city, b.languages, b.is_demo,
                            b.profile->>'kind' as kind, b.profile->'owner'->>'name' as owner_name, m.role,
                            d.dna->>'theme' as theme, coalesce(d.dna->'palette', '[]') as palette,
                            coalesce(d.dna->'palette_hex', '{}') as palette_hex,
                            coalesce(d.dna->'voice', '[]') as voice,
                            coalesce((d.dna->>'watermark')::boolean, true) as watermark
                     from memberships m join businesses b on b.id = m.business_id
                     left join brand_dna d on d.business_id = b.id and d.status = 'active'
                     where m.user_id = %s order by b.is_demo, b.created_at""", (user.id,))
    s = get_settings()
    return {"user": user.model_dump(), "businesses": rows,
            "features": {"google_photos": s.google_maps_api_key is not None}}


# ------------------------------------------------------------------ onboarding


class Offering(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    price: float = Field(gt=0, le=1_000_000)
    unit_cost: float | None = Field(None, ge=0, description="What one costs the business; enables the margin check.")


class NewBusiness(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    kind: str = Field(min_length=2, max_length=60, description="e.g. café, salon, bakery, clothing store")
    city: str = Field(min_length=2, max_length=60)
    locality: str = Field(min_length=2, max_length=80)
    languages: list[Literal["en", "kn", "hi"]] = Field(min_length=1)
    owner_name: str | None = Field(None, max_length=60)
    description: str | None = Field(None, max_length=800, description="What customers love, in the owner's words.")
    website: str | None = Field(None, max_length=300)
    find_on_google: bool = True
    offerings: list[Offering] = Field(min_length=1, max_length=60)


class Phrase(BaseModel):
    lang: Literal["en", "kn", "hi"]
    phrase: str


class BrandDraft(BaseModel):
    voice: list[str] = Field(description="3 to 5 plain adjectives for how the owner talks to regulars "
                                         "(e.g. 'chatty', 'no-nonsense'), never marketing words like 'vibrant'.")
    do: list[str] = Field(description="2 to 4 short, concrete writing rules, e.g. 'name the dish, not the "
                                      "experience'.")
    avoid: list[str] = Field(description="2 to 4 things never to do.")
    signature_phrases: list[Phrase] = Field(description="One short sign-off line per language, natively written.")
    imagery: str = Field(description="One or two sentences describing what photos of this business should show.")
    palette: list[str] = Field(description="3 or 4 colours, as words.")
    banned_words: list[str] = Field(description="Hype words this business would never use.")
    emoji_policy: str


def _slug(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "business"
    return f"{base}-{secrets.token_hex(2)}"


def _default_brand(b: NewBusiness) -> dict[str, Any]:
    return {"voice": ["warm", "friendly", "local", "straightforward"],
            "do": ["Talk like a regular customer would, not like an advertisement", "Mention what people actually love here"],
            "avoid": ["hype words such as amazing, epic, mind-blowing", "ALL CAPS"],
            "signature_phrases": {}, "imagery": f"Real, natural-light photos of {b.name}'s own products and space.",
            "palette": [], "banned_words": ["amazing", "epic", "mind-blowing", "ultimate"],
            "emoji_policy": "At most two", "languages_priority": b.languages, "examples": []}


async def _draft_brand(request: Request, b: NewBusiness) -> tuple[dict[str, Any], str]:
    router = get_router(request)
    items = ", ".join(o.name for o in b.offerings[:20])
    prompt = (f"A new {b.kind} called {b.name} in {b.locality}, {b.city} is setting up its marketing. "
              f"They sell: {items}. In the owner's words: {b.description or '(nothing more given)'}. "
              f"Languages: {', '.join(b.languages)} (en English, kn Kannada script, hi Hindi Devanagari). "
              "Draft a starting brand voice the owner can edit. Do not invent facts about the business. "
              "It must sound like the owner chatting with a regular at the counter, not like an ad agency or an AI: "
              "plain everyday words, short sentences, local flavour. Signature lines are things the owner would "
              "actually say out loud. Never use words such as: " + ", ".join(AI_CLICHES[:30]) + ".")
    try:
        draft, _ = await router.chat_json("reasoning", [{"role": "user", "content": prompt}], BrandDraft)
    except Exception:
        return _default_brand(b), "Starting voice (the model was unavailable; edit it any time)"
    dna = draft.model_dump()
    dna["signature_phrases"] = {}
    for p in draft.signature_phrases:
        if p.lang in b.languages:
            dna["signature_phrases"].setdefault(p.lang, []).append(p.phrase)
    dna["banned_words"] = sorted({w.strip().lower() for w in dna["banned_words"] if w.strip()})
    if robotic := machine_voice(" ".join([*dna["voice"], *dna["do"], dna["imagery"]])):
        dna["voice_note"] = f"Reworded automatically to avoid: {', '.join(robotic)}"
        dna["voice"] = [v for v in dna["voice"] if not machine_voice(v)] or _default_brand(b)["voice"]
        dna["do"] = [d for d in dna["do"] if not machine_voice(d)] or _default_brand(b)["do"]
    dna |= {"languages_priority": b.languages, "examples": []}
    return dna, "Drafted by Counterpart from onboarding; the owner can edit it"


@accounts.post("/businesses")
async def create_business(user: CurrentUser, body: NewBusiness, request: Request, bg: BackgroundTasks) -> dict[str, Any]:
    dna, rationale = await _draft_brand(request, body)  # model call before opening a transaction
    profile = {
        "kind": body.kind, "owner": {"name": body.owner_name} if body.owner_name else {},
        "description": body.description, "website": body.website,
        "menu": [o.model_dump() for o in body.offerings], "allowed_phrases": [],
        "baseline_covers_per_window": 30,
        "channels": ["instagram_post", "instagram_story", "whatsapp", "poster"],
    }
    async with connection() as conn:
        b = await fetch_one(
            conn, """insert into businesses (slug, name, locality, city, languages, profile)
                     values (%s, %s, %s, %s, %s, %s) returning *""",
            (_slug(body.name), body.name.strip(), body.locality.strip(), body.city.strip(), body.languages,
             jsonb(profile)))
        assert b is not None
        await conn.execute("insert into memberships (user_id, business_id, role) values (%s, %s, 'owner')",
                           (user.id, b["id"]))
        await conn.execute(
            """insert into brand_dna (business_id, version, status, dna, rationale, created_by)
               values (%s, 1, 'active', %s, %s, 'agent')""", (b["id"], jsonb(dna), rationale))
        await ledger.record(conn, b["id"], "business.created", f"{b['name']} joined Counterpart", actor="owner")
    if body.website or body.find_on_google:
        bg.add_task(photos.import_all, get_router(request), b, website=body.website,
                    google=body.find_on_google and get_settings().google_maps_api_key is not None)
    return b


class BrandUpdate(BaseModel):
    dna: dict[str, Any]


@accounts.put("/businesses/{slug}/brand")
async def update_brand(user: CurrentUser, slug: str, body: BrandUpdate) -> dict[str, Any]:
    """The owner edits the voice: a new active version, the old one superseded."""
    async with connection() as conn:
        b = await business_for(conn, user, slug)
        cur = await services.active_brand(conn, b["id"])
        version = (cur["version"] if cur else 0) + 1
        await conn.execute("update brand_dna set status = 'superseded' where business_id = %s and status = 'active'",
                           (b["id"],))
        row = await fetch_one(conn, """insert into brand_dna (business_id, version, status, dna, rationale, created_by)
                                       values (%s, %s, 'active', %s, 'Edited by the owner', 'owner') returning *""",
                              (b["id"], version, jsonb(body.dna)))
        await ledger.record(conn, b["id"], "brand.updated", f"Brand voice updated to version {version}", actor="owner")
    return row  # type: ignore[return-value]


# ------------------------------------------------------------------ photos


def _photo_out(p: dict[str, Any]) -> dict[str, Any]:
    return {**p, "url": get_storage().url(p["image_key"])}


@accounts.get("/businesses/{slug}/photos")
async def list_photos(user: CurrentUser, slug: str) -> dict[str, Any]:
    async with connection() as conn:
        b = await business_for(conn, user, slug)
        rows = await fetch_all(conn, "select * from business_photos where business_id = %s order by status, created_at desc",
                               (b["id"],))
    s = get_settings()
    return {"photos": [_photo_out(p) for p in rows], "website": b["profile"].get("website"),
            "google_available": s.google_maps_api_key is not None}


class ImportBody(BaseModel):
    website: str | None = Field(None, max_length=300)
    google: bool = False


@accounts.post("/businesses/{slug}/photos/import")
async def import_photos(user: CurrentUser, slug: str, body: ImportBody, request: Request,
                        bg: BackgroundTasks) -> dict[str, str]:
    async with connection() as conn:
        b = await business_for(conn, user, slug)
        if body.website and body.website != b["profile"].get("website"):
            await conn.execute("""update businesses set profile = jsonb_set(profile, '{website}', to_jsonb(%s::text))
                                  where id = %s""", (body.website, b["id"]))
    bg.add_task(photos.import_all, get_router(request), b, website=body.website,
                google=body.google and get_settings().google_maps_api_key is not None)
    return {"status": "accepted"}


class Upload(BaseModel):
    data_url: str = Field(max_length=12_000_000, description="data:image/...;base64,...")


@accounts.post("/businesses/{slug}/photos")
async def upload_photo(user: CurrentUser, slug: str, body: Upload, request: Request, bg: BackgroundTasks) -> dict[str, Any]:
    m = re.match(r"^data:image/[\w.+-]+;base64,(.+)$", body.data_url, re.S)
    if not m:
        raise services.Conflict("Upload a JPG, PNG or WebP photo.")
    try:
        data = base64.b64decode(m.group(1), validate=True)
    except (binascii.Error, ValueError) as e:
        raise services.Conflict("That file could not be read.") from e
    if len(data) > photos.MAX_BYTES:
        raise services.Conflict("That photo is larger than 8 MB.")
    async with connection() as conn:
        b = await business_for(conn, user, slug)
        row = await photos.save_photo(conn, b, data, source="upload", attribution="Uploaded by the owner")
        if not row:
            raise services.Conflict("That photo is too small or not an image (at least 300 px on each side).")
        await ledger.record(conn, b["id"], "photos.uploaded", "You added a photo", actor="owner")
    bg.add_task(photos.describe_new, get_router(request), b)
    return _photo_out(row)


class PhotoUpdate(BaseModel):
    status: Literal["active", "hidden"]


@accounts.patch("/photos/{photo_id}")
async def update_photo(user: CurrentUser, photo_id: str, body: PhotoUpdate) -> dict[str, Any]:
    async with connection() as conn:
        p = await fetch_one(conn, "select * from business_photos where id = %s", (photo_id,))
        if not p:
            raise services.NotFound("photo not found")
        await require_member(conn, user, p["business_id"])
        row = await fetch_one(conn, "update business_photos set status = %s where id = %s returning *",
                              (body.status, photo_id))
    return _photo_out(row)  # type: ignore[arg-type]


class PhotoChoice(BaseModel):
    photo_id: str


@accounts.post("/assets/{asset_id}/photo")
async def set_asset_photo(user: CurrentUser, asset_id: str, body: PhotoChoice) -> dict[str, Any]:
    """The owner swaps a post's picture for another photo from the library."""
    async with connection() as conn:
        asset = await services.get_asset(conn, asset_id)
        c = await services.get_campaign(conn, asset["campaign_id"])
        await require_member(conn, user, c["business_id"])
        p = await fetch_one(conn, "select * from business_photos where id = %s and business_id = %s",
                            (body.photo_id, c["business_id"]))
        if not p:
            raise services.NotFound("photo not found")
        await conn.execute("update asset_revisions set image_key = %s where asset_id = %s and n = %s",
                           (p["image_key"], asset_id, asset["current_revision"]))
        await ledger.record(conn, c["business_id"], "asset.visual",
                            f"You changed the picture of the {services.asset_label(asset)}", actor="owner",
                            campaign_id=c["id"], payload={"asset_id": asset_id, "photo_id": body.photo_id})
    return {"ok": True, "image_url": get_storage().url(p["image_key"])}


# ------------------------------------------------------------------ what the agents are doing


AGENTS = [
    {"role": "reasoning", "name": "Planner", "job": "Reads the situation, decides the next step and calls tools: "
     "drafts the offer, checks margins, plans audiences and channels, asks you for approvals."},
    {"role": "generation", "name": "Writer", "job": "Writes each post's headline and message in its language, "
     "in your brand voice. Never types offer details; the system adds those from the locked offer."},
    {"role": "verification", "name": "Checker", "job": "A different model that reads every post and translation "
     "back into English and blocks anything that does not match the locked offer."},
    {"role": "vision", "name": "Photo reader", "job": "Looks at the photos of your business once, describes them, "
     "and sets aside blurry shots, logos and menus so each post gets a fitting real photo."},
    {"role": "image", "name": "Picture maker", "job": "Only when you have no photos yet: makes an AI picture, "
     "labelled as such."},
]


@accounts.get("/businesses/{slug}/agents")
async def agents(user: CurrentUser, slug: str, request: Request) -> dict[str, Any]:
    async with connection() as conn:
        b = await business_for(conn, user, slug)
        recent = await fetch_all(
            conn, """select id, type, summary, actor, campaign_id, created_at from ledger_events
                     where business_id = %s and actor in ('agent', 'system') order by id desc limit 30""", (b["id"],))
    router = get_router(request)
    status = router.status()
    calls = router.calls_for(str(b["id"]))
    out = []
    for a in AGENTS:
        mine = [c for c in calls if c["role"] == a["role"]]
        out.append({**a, "models": status["roles"].get(a["role"], []), "calls": len(mine),
                    "last": mine[-1] if mine else None})
    return {"agents": out, "calls": calls[::-1][:40], "activity": recent}


# ------------------------------------------------------------------ results


@accounts.get("/businesses/{slug}/results")
async def results(user: CurrentUser, slug: str) -> dict[str, Any]:
    """Per tracked post: scans (opened the link), claims (tapped 'get my code'), redeemed at the counter."""
    async with connection() as conn:
        b = await business_for(conn, user, slug)
        rows = await fetch_all(
            conn, """select c.id as campaign_id, c.name as campaign, a.id as asset_id, a.channel, a.language,
                            a.segment, a.variant, t.code,
                            coalesce(sum(o.qty) filter (where o.type = 'scan'), 0)::int as scans,
                            coalesce(sum(o.qty) filter (where o.type = 'click'), 0)::int as claims,
                            coalesce(sum(o.qty) filter (where o.type = 'redeem'), 0)::int as redeemed
                     from touchpoints t join assets a on a.id = t.asset_id join campaigns c on c.id = t.campaign_id
                     left join outcome_events o on o.touchpoint_code = t.code
                     where c.business_id = %s and not c.is_historical
                     group by c.id, c.name, a.id, t.code order by c.created_at desc, redeemed desc""", (b["id"],))
    base = get_settings().public_base_url.rstrip("/")
    for r in rows:
        r["link"] = f"{base}/r/{r['code']}"
        r["conversion"] = round(r["redeemed"] / r["scans"], 4) if r["scans"] else None
    totals = {k: sum(r[k] for r in rows) for k in ("scans", "claims", "redeemed")}
    totals["conversion"] = round(totals["redeemed"] / totals["scans"], 4) if totals["scans"] else None
    return {"posts": rows, "totals": totals}
