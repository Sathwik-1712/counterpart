"""Public, unauthenticated routes: what a customer's phone hits after scanning a QR code."""

import io
from typing import Any, Literal
from urllib.parse import quote

import qrcode
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app import reviews, services
from app.api.deps import get_router
from app.channels import whatsapp
from app.config import get_settings
from app.db import connection, fetch_all, fetch_one
from app.storage import get_storage

public = APIRouter(prefix="/api/public")


async def _landing(conn: Any, code: str) -> dict[str, Any]:
    row = await fetch_one(
        conn,
        """select t.code, a.channel, a.language, r.rendered, r.image_key, b.name, b.locality, b.city,
                  b.profile->>'whatsapp' is not null as whatsapp,
                  (select regexp_replace(ca.display, '[^0-9]', '', 'g') from channel_accounts ca
                    where ca.business_id = b.id and ca.channel = 'whatsapp') as whatsapp_bot
           from touchpoints t join assets a on a.id = t.asset_id
           join asset_revisions r on r.asset_id = a.id and r.n = a.current_revision
           join campaigns c on c.id = t.campaign_id join businesses b on b.id = c.business_id
           where t.code = %s and a.status = 'live'""",
        (code.upper(),),
    )
    if not row:
        raise services.NotFound("This offer is not available.")
    row["image_url"] = get_storage().url(row.pop("image_key")) if row.get("image_key") else None
    row["whatsapp"] = row["whatsapp"] or bool(row["whatsapp_bot"])
    return row


class VisitBody(BaseModel):
    device: str | None = Field(None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    m: str | None = Field(None, max_length=16, pattern=r"^[A-Za-z0-9_-]+$", description="The WhatsApp message it came from.")


@public.post("/r/{code}/visit")
async def visit(code: str, body: VisitBody | None = None) -> dict[str, Any]:
    """An open of the post's link. Counted once per phone, so reloads and second looks are not new people."""
    device, m = (body.device, body.m) if body else (None, None)
    async with connection() as conn:
        data = await _landing(conn, code)
        seen = device and await fetch_one(
            conn, """select 1 from outcome_events where touchpoint_code = %s and type = 'scan'
                     and meta->>'device' = %s limit 1""", (code.upper(), device))
        if not seen:
            await services.record_outcome(conn, code, "scan", source="live",
                                          meta={k: v for k, v in {"device": device, "m": m}.items() if v})
    return data


class ClaimBody(BaseModel):
    device: str | None = Field(None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    via: Literal["web", "whatsapp"] = "web"


def _claim_out(row: dict[str, Any], data: dict[str, Any], whatsapp: str | None) -> dict[str, Any]:
    base = get_settings().public_base_url.rstrip("/")
    out = {"ok": True, "code": row["code"], "status": row["status"], "redeemed_at": row["redeemed_at"],
           "staff_url": f"{base}/k/{row['code']}"}
    if whatsapp:  # the message lands in the business's own WhatsApp, so the owner gets the customer's number
        text = f"Hi {data['name']}! I'd like this offer. My code is {row['code']}"
        out["whatsapp_url"] = f"https://wa.me/{whatsapp}?text={quote(text)}"
    return out


@public.post("/r/{code}/claim")
async def claim(code: str, body: ClaimBody | None = None) -> dict[str, Any]:
    """A personal code for this customer, made once per phone. Staff redeem it at the counter."""
    body = body or ClaimBody()
    async with connection() as conn:
        data = await _landing(conn, code)
        row, _ = await services.claim(conn, code, device=body.device, via=body.via)
        b = await fetch_one(conn, """select b.profile->>'whatsapp' as whatsapp from touchpoints t
                                     join campaigns c on c.id = t.campaign_id join businesses b on b.id = c.business_id
                                     where t.code = %s""", (code.upper(),))
    return _claim_out(row, data, (b or {}).get("whatsapp"))


@public.get("/claims/{code}")
async def claim_status(code: str) -> dict[str, Any]:
    """A personal code's page (linked from the WhatsApp reply): the offer, the QR for staff, used or not."""
    async with connection() as conn:
        row = await fetch_one(
            conn, """select cl.code, cl.status, cl.redeemed_at, cl.campaign_id, a.language, b.name, b.locality,
                            b.profile->>'google_review_url' as google_review_url
                     from claims cl join campaigns c on c.id = cl.campaign_id join businesses b on b.id = c.business_id
                     left join assets a on a.id = cl.asset_id where cl.code = %s""", (code.upper(),))
        if not row:
            raise services.NotFound("This code does not exist.")
        sheet = await services.locked_sheet(conn, row["campaign_id"])
        review = await fetch_one(conn, "select rating, body from customer_interactions where claim_code = %s",
                                 (row["code"],))
    lang = row["language"] or "en"
    return {"code": row["code"], "status": row["status"], "redeemed_at": row["redeemed_at"], "language": lang,
            "name": row["name"], "locality": row["locality"], "review": review,
            "google_review_url": row["google_review_url"],
            "offer": [f.display.get(lang) or f.display.get("en") for f in sheet.facts] if sheet else []}


class ReviewBody(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str = Field("", max_length=1000)
    language: Literal["en", "kn", "hi"] = "en"


@public.post("/claims/{code}/review")
async def review(code: str, body: ReviewBody, request: Request, bg: BackgroundTasks) -> dict[str, Any]:
    """The customer's own review of the visit they just made (their code was redeemed). One per code; editable."""
    saved = await reviews.submit_visit(code, body.rating, body.comment, body.language)
    bg.add_task(reviews.analyze, get_router(request), saved["id"])
    return {"ok": True, "google_review_url": saved["google_review_url"]}


@public.get("/claims/{code}/qr.png")
async def claim_qr(code: str) -> Response:
    """The QR on the customer's screen. Staff scan it with their phone camera to open the redeem page."""
    async with connection() as conn:
        if not await fetch_one(conn, "select 1 from claims where code = %s", (code.upper(),)):
            raise services.NotFound("unknown code")
    return _png(f"{get_settings().public_base_url.rstrip('/')}/k/{code.upper()}")


# ------------------------------------------------------------------ staff phones (counter PIN, no account)


class PinBody(BaseModel):
    pin: str = Field(pattern=r"^\d{4,6}$")
    code: str | None = Field(None, max_length=12)
    business: str | None = Field(None, max_length=80)


@public.post("/counter/session")
async def counter_session(body: PinBody) -> dict[str, Any]:
    """A staff phone enters the owner's counter PIN once and is remembered for 30 days."""
    async with connection() as conn:
        if body.code:
            business_id = (await services.find_code(conn, body.code))["business_id"]
        elif body.business:
            business_id = (await services.get_business(conn, body.business))["id"]
        else:
            raise services.Conflict("Open the staff link or scan a customer's code first.")
        token, error = await services.open_counter_session(conn, business_id, body.pin)
    if error:
        raise services.Conflict(error)
    return {"token": token}


class StaffCode(BaseModel):
    token: str | None = Field(None, max_length=64)
    code: str = Field(min_length=4, max_length=12)


class StaffRedeem(StaffCode):
    bill_amount: float | None = Field(None, ge=0, le=1_000_000)
    outside_rules: str | None = Field(None, max_length=200)


async def _staff(conn: Any, token: str | None, code: str) -> Any:
    business_id = await services.counter_session_business(conn, token)
    if business_id is None:
        raise HTTPException(401, "Enter the counter PIN to use this phone at the counter.")
    if (await services.find_code(conn, code))["business_id"] != business_id:
        raise services.NotFound("No offer has this code. Check the letters.")
    return business_id


@public.post("/counter/check")
async def staff_check(body: StaffCode) -> dict[str, Any]:
    async with connection() as conn:
        await _staff(conn, body.token, body.code)
        return await services.counter_check(conn, body.code)


@public.post("/counter/redeem")
async def staff_redeem(body: StaffRedeem, bg: BackgroundTasks) -> dict[str, Any]:
    async with connection() as conn:
        await _staff(conn, body.token, body.code)
        out = await services.counter_redeem(conn, body.code, by="staff_phone", bill_amount=body.bill_amount,
                                            outside_rules=body.outside_rules)
    if out.get("via") == "whatsapp":
        bg.add_task(whatsapp.ask_review, out["code"])
    return out


@public.get("/showcase")
async def showcase() -> list[dict[str, Any]]:
    """A few live posts from the demo business, for the sign-in page. Demo content only."""
    async with connection() as conn:
        rows = await fetch_all(
            conn,
            """select r.rendered->>'headline' as headline, r.rendered->'offer'->>0 as offer, r.image_key, b.name,
                      a.language
               from assets a join asset_revisions r on r.asset_id = a.id and r.n = a.current_revision
               join campaigns c on c.id = a.campaign_id join businesses b on b.id = c.business_id
               where b.is_demo and a.status = 'live' and a.channel = 'instagram_post' and r.image_key is not null
               order by a.created_at desc limit 3""")
    storage = get_storage()
    return [{**{k: v for k, v in r.items() if k != "image_key"}, "image_url": storage.url(r["image_key"])} for r in rows]


@public.get("/qr/{code}.png")
async def qr(code: str) -> Response:
    async with connection() as conn:
        if not await fetch_one(conn, "select 1 from touchpoints where code = %s", (code.upper(),)):
            raise services.NotFound("unknown code")
    return _png(f"{get_settings().public_base_url.rstrip('/')}/r/{code.upper()}")


def _png(url: str) -> Response:
    buf = io.BytesIO()
    qrcode.make(url, border=2).save(buf, format="PNG")
    return Response(buf.getvalue(), media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})
