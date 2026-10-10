"""Connecting WhatsApp and Instagram, the WhatsApp webhook, and sending or posting through them."""

import base64
import binascii
import hmac
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app import ledger, services
from app.api.deps import get_router, require_owner
from app.auth import CurrentUser, business_for, require_member
from app.channels import instagram, meta, whatsapp
from app.config import get_settings
from app.db import connection, fetch_all, fetch_one, jsonb

channels_api = APIRouter(prefix="/api", dependencies=[Depends(require_owner)])
webhook = APIRouter(prefix="/api/public")


def _meta_error(e: meta.MetaError) -> services.Conflict:
    return services.Conflict(f"Meta said: {e}")


@channels_api.get("/businesses/{slug}/channels")
async def channels_status(user: CurrentUser, slug: str) -> dict[str, Any]:
    s = get_settings()
    base = s.public_base_url.rstrip("/")
    async with connection() as conn:
        b = await business_for(conn, user, slug)
        rows = {r["channel"]: r for r in await fetch_all(
            conn, "select channel, display, external_id, meta, connected_at, token_expires_at from channel_accounts "
                  "where business_id = %s", (b["id"],))}
        contacts = await fetch_one(
            conn, """select count(*)::int as all, count(*) filter (where opted_out_at is null)::int as reachable,
                            count(*) filter (where opted_out_at is null and last_inbound_at > now() - interval '24 hours')::int
                              as free_now from wa_contacts where business_id = %s""", (b["id"],))
        last_in = await fetch_one(conn, """select max(created_at) as at from channel_messages
                                           where business_id = %s and direction = 'in'""", (b["id"],))
        media = await fetch_one(conn, "select count(*)::int as n from instagram_media where business_id = %s", (b["id"],))
    wa, ig = rows.get("whatsapp"), rows.get("instagram")
    return {
        "public_url": base, "public_ok": base.startswith("https://"),
        "webhook": {"url": f"{base}/api/public/whatsapp/webhook", "verify_token_set": s.whatsapp_verify_token is not None,
                    "app_secret_set": s.meta_app_secret is not None, "last_message_at": last_in and last_in["at"]},
        "whatsapp": wa and {"display": wa["display"], "phone_number_id": wa["external_id"],
                            "template": (wa["meta"] or {}).get("template"), "connected_at": wa["connected_at"],
                            "contacts": contacts},
        "instagram": ig and {"username": ig["display"], "connected_at": ig["connected_at"], "posts_linked": media["n"]},
    }


class WhatsAppConnect(BaseModel):
    phone_number_id: str = Field(min_length=5, max_length=40, pattern=r"^\d+$")
    token: str = Field(min_length=20, max_length=1000)
    template: str | None = Field(None, max_length=120, pattern=r"^[a-z0-9_]+$",
                                 description="Approved marketing template with 3 body variables: business, headline, link.")
    template_language: str = Field("en", max_length=10)


@channels_api.put("/businesses/{slug}/channels/whatsapp")
async def connect_whatsapp(user: CurrentUser, slug: str, body: WhatsAppConnect) -> dict[str, Any]:
    async with connection() as conn:
        b = await business_for(conn, user, slug)
    try:
        info = await whatsapp.check(body.phone_number_id, body.token.strip())
    except meta.MetaError as e:
        raise _meta_error(e) from e
    template = {"name": body.template, "language": body.template_language} if body.template else None
    async with connection() as conn:
        await conn.execute(
            """insert into channel_accounts (business_id, channel, external_id, display, token, meta)
               values (%s, 'whatsapp', %s, %s, %s, %s)
               on conflict (business_id, channel) do update set external_id = excluded.external_id,
                 display = excluded.display, token = excluded.token, meta = excluded.meta, connected_at = now()""",
            (b["id"], body.phone_number_id, info["display"], body.token.strip(), jsonb({"template": template, "name": info["name"]})))
        await ledger.record(conn, b["id"], "channel.connected", f"WhatsApp connected: {info['display']}", actor="owner")
    return {"ok": True, **info}


class InstagramConnect(BaseModel):
    token: str = Field(min_length=20, max_length=1000)


@channels_api.put("/businesses/{slug}/channels/instagram")
async def connect_instagram(user: CurrentUser, slug: str, body: InstagramConnect) -> dict[str, Any]:
    async with connection() as conn:
        b = await business_for(conn, user, slug)
    try:
        info = await instagram.check(body.token.strip())
    except meta.MetaError as e:
        raise _meta_error(e) from e
    async with connection() as conn:
        await conn.execute(
            """insert into channel_accounts (business_id, channel, external_id, display, token, token_expires_at)
               values (%s, 'instagram', %s, %s, %s, now() + interval '60 days')
               on conflict (business_id, channel) do update set external_id = excluded.external_id,
                 display = excluded.display, token = excluded.token, connected_at = now(),
                 token_expires_at = excluded.token_expires_at""",
            (b["id"], info["user_id"], f"@{info['username']}", body.token.strip()))
        await ledger.record(conn, b["id"], "channel.connected", f"Instagram connected: @{info['username']}", actor="owner")
    return {"ok": True, **info}


@channels_api.delete("/businesses/{slug}/channels/{channel}")
async def disconnect(user: CurrentUser, slug: str, channel: str) -> dict[str, Any]:
    if channel not in ("whatsapp", "instagram"):
        raise services.NotFound("not found")
    async with connection() as conn:
        b = await business_for(conn, user, slug)
        await conn.execute("delete from channel_accounts where business_id = %s and channel = %s", (b["id"], channel))
        await ledger.record(conn, b["id"], "channel.disconnected", f"{channel.title()} disconnected", actor="owner")
    return {"ok": True}


async def _business_of_asset(user: Any, asset_id: str) -> dict[str, Any]:
    async with connection() as conn:
        asset = await services.get_asset(conn, asset_id)
        c = await services.get_campaign(conn, asset["campaign_id"])
        await require_member(conn, user, c["business_id"])
        return await services.get_business_by_id(conn, c["business_id"])


@channels_api.post("/assets/{asset_id}/whatsapp/send")
async def send_on_whatsapp(user: CurrentUser, asset_id: str) -> dict[str, Any]:
    """Send a live post to customers who messaged the business (free inside 24 hours, a template otherwise)."""
    b = await _business_of_asset(user, asset_id)
    return await whatsapp.broadcast(b, asset_id)


class Picture(BaseModel):
    data_url: str = Field(max_length=12_000_000, description="The post drawn by the browser, as a JPEG data URL.")


@channels_api.post("/assets/{asset_id}/instagram/publish")
async def publish_on_instagram(user: CurrentUser, asset_id: str, body: Picture) -> dict[str, Any]:
    b = await _business_of_asset(user, asset_id)
    head, _, data = body.data_url.partition(",")
    if head != "data:image/jpeg;base64":
        raise services.Conflict("Instagram needs a JPEG picture.")
    try:
        jpeg = base64.b64decode(data, validate=True)
    except binascii.Error as e:
        raise services.Conflict("The picture did not arrive whole. Try again.") from e
    if len(jpeg) > 8 * 1024 * 1024:
        raise services.Conflict("The picture is over Instagram's 8 MB limit.")
    try:
        return await instagram.publish(b, asset_id, jpeg)
    except meta.MetaError as e:
        raise _meta_error(e) from e


@channels_api.get("/businesses/{slug}/instagram/recent")
async def instagram_recent(user: CurrentUser, slug: str) -> dict[str, Any]:
    """The account's latest posts, to link one the owner posted in the Instagram app."""
    async with connection() as conn:
        b = await business_for(conn, user, slug)
        acct = await instagram.account(conn, b["id"])
        linked = {r["media_id"]: str(r["asset_id"]) for r in await fetch_all(
            conn, "select media_id, asset_id from instagram_media where business_id = %s", (b["id"],))}
    if not acct:
        raise services.Conflict("Connect Instagram first, on the Channels page.")
    try:
        media = await instagram.recent(acct)
    except meta.MetaError as e:
        raise _meta_error(e) from e
    return {"media": [{**m, "linked_asset": linked.get(m["id"])} for m in media]}


class LinkBody(BaseModel):
    media_id: str = Field(min_length=3, max_length=40, pattern=r"^\d+$")


@channels_api.post("/assets/{asset_id}/instagram/link")
async def instagram_link(user: CurrentUser, asset_id: str, body: LinkBody) -> dict[str, Any]:
    b = await _business_of_asset(user, asset_id)
    try:
        out = await instagram.link(b, asset_id, body.media_id)
        await instagram.sync(b["id"])
    except meta.MetaError as e:
        raise _meta_error(e) from e
    return out


@channels_api.post("/businesses/{slug}/instagram/sync")
async def instagram_sync(user: CurrentUser, slug: str, request: Request) -> dict[str, Any]:
    """Re-read insights and read new comments now."""
    async with connection() as conn:
        b = await business_for(conn, user, slug)
    try:
        return {"updated": await instagram.sync(b["id"], force=True),
                "comments": await instagram.sync_comments(get_router(request), b, force=True)}
    except meta.MetaError as e:
        raise _meta_error(e) from e


# ------------------------------------------------------------------ WhatsApp webhook (called by Meta)


@webhook.get("/whatsapp/webhook")
async def whatsapp_verify(request: Request) -> Response:
    """Meta's one-time handshake when the webhook URL is saved in the app dashboard."""
    q = request.query_params
    want = get_settings().whatsapp_verify_token
    if q.get("hub.mode") == "subscribe" and want and hmac.compare_digest(q.get("hub.verify_token", ""), want.get_secret_value()):
        return Response(q.get("hub.challenge", ""), media_type="text/plain")
    raise HTTPException(403, "verification failed")


@webhook.post("/whatsapp/webhook")
async def whatsapp_events(request: Request, bg: BackgroundTasks) -> dict[str, str]:
    """Customer messages and delivery receipts. Signed by Meta; answered at once and processed after."""
    raw = await request.body()
    if not whatsapp.signature_ok(raw, request.headers.get("x-hub-signature-256")):
        raise HTTPException(403, "bad signature")
    try:
        payload = await request.json()
    except ValueError as e:
        raise HTTPException(400, "not json") from e
    bg.add_task(whatsapp.handle, payload, get_router(request))
    return {"ok": "received"}
