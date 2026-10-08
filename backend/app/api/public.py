"""Public, unauthenticated routes: what a customer's phone hits after scanning a QR code."""

import io
from typing import Any

import qrcode
from fastapi import APIRouter, Response

from app import services
from app.config import get_settings
from app.db import connection, fetch_all, fetch_one
from app.storage import get_storage

public = APIRouter(prefix="/api/public")


async def _landing(conn: Any, code: str) -> dict[str, Any]:
    row = await fetch_one(
        conn,
        """select t.code, a.channel, a.language, r.rendered, r.image_key, b.name, b.locality, b.city
           from touchpoints t join assets a on a.id = t.asset_id
           join asset_revisions r on r.asset_id = a.id and r.n = a.current_revision
           join campaigns c on c.id = t.campaign_id join businesses b on b.id = c.business_id
           where t.code = %s and a.status = 'live'""",
        (code.upper(),),
    )
    if not row:
        raise services.NotFound("This offer is not available.")
    row["image_url"] = get_storage().url(row.pop("image_key")) if row.get("image_key") else None
    return row


@public.post("/r/{code}/visit")
async def visit(code: str) -> dict[str, Any]:
    async with connection() as conn:
        data = await _landing(conn, code)
        await services.record_outcome(conn, code, "scan", source="live")
    return data


@public.post("/r/{code}/claim")
async def claim(code: str) -> dict[str, Any]:
    async with connection() as conn:
        data = await _landing(conn, code)
        # Intent only. The real redemption is recorded when staff tap the code at the counter.
        await services.record_outcome(conn, code, "click", source="live")
    return {"ok": True, "code": data["code"]}


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
    img = qrcode.make(f"{get_settings().public_base_url.rstrip('/')}/r/{code.upper()}", border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(buf.getvalue(), media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})
