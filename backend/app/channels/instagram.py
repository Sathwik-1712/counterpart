"""Instagram API with Instagram Login: publish a post, link posts the owner made themselves, read their insights,
and read the comments people leave as reviews (sorted into praise, complaint, question, suggestion, mention, spam).

Engagement rate = (likes + comments + saves + shares) / reach, per post, from Meta's own numbers. Instagram captions
cannot carry a clickable link, so each caption prints the post's code: a customer who shows it at the counter is
counted for that exact post, the same as a link open.
"""

import asyncio
import re
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app import ledger, reviews, services
from app.channels import meta
from app.config import get_settings
from app.db import Conn, connection, fetch_all, fetch_one, jsonb
from app.storage import SupabaseStorage, get_storage

METRICS = ["reach", "likes", "comments", "saved", "shares", "views", "total_interactions"]
CORE = ["reach", "likes", "comments", "saved", "shares", "total_interactions"]  # every image post has these
FRESH = timedelta(hours=1)  # insights are re-read at most this often; Meta's own data lags up to 48 hours


async def account(conn: Conn, business_id: Any) -> dict[str, Any] | None:
    return await fetch_one(conn, "select * from channel_accounts where business_id = %s and channel = 'instagram'",
                           (business_id,))


def _get(acct: dict[str, Any], path: str, **params: Any) -> Any:
    return meta.graph("GET", meta.url(meta.IG, path), token=acct["token"], params=params, bearer=False)


async def check(token: str) -> dict[str, Any]:
    """Who the token belongs to. Only professional (Business or Creator) accounts have insights and publishing."""
    d = await meta.graph("GET", meta.url(meta.IG, "me"), token=token, bearer=False,
                         params={"fields": "user_id,username,account_type"})
    if d.get("account_type") not in ("BUSINESS", "MEDIA_CREATOR", "CREATOR"):
        raise meta.MetaError("This is a personal Instagram account. Switch it to a Business or Creator account in the "
                             "Instagram app (Settings, Account type), then connect again.")
    return {"user_id": str(d.get("user_id") or d.get("id")), "username": d.get("username")}


async def refresh_if_due(acct: dict[str, Any]) -> dict[str, Any]:
    """Long-lived tokens last 60 days. Renew one that is older than 50 days, so the connection never lapses."""
    if datetime.now(UTC) - acct["connected_at"] < timedelta(days=50):
        return acct
    d = await meta.graph("GET", f"{meta.IG}/refresh_access_token", token=acct["token"], bearer=False,
                         params={"grant_type": "ig_refresh_token"})
    async with connection() as conn:
        row = await fetch_one(conn, """update channel_accounts set token = %s, connected_at = now(),
                                       token_expires_at = now() + make_interval(secs => %s)
                                       where business_id = %s and channel = 'instagram' returning *""",
                              (d["access_token"], int(d.get("expires_in") or 5_184_000), acct["business_id"]))
    return row or acct


async def recent(acct: dict[str, Any], limit: int = 12) -> list[dict[str, Any]]:
    d = await _get(acct, "me/media", limit=limit,
                   fields="id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url")
    return d.get("data") or []


def caption(rendered: dict[str, Any], code: str | None) -> str:
    parts = [rendered.get("headline", ""), rendered.get("body", ""), "\n".join(rendered.get("offer") or [])]
    if code:
        parts.append(f"Show code {code} at the counter.")
    if tags := rendered.get("hashtags"):
        parts.append(" ".join(t if t.startswith("#") else f"#{t}" for t in tags))
    return "\n\n".join(p for p in parts if p).strip()[:2200]


async def publish(business: dict[str, Any], asset_id: str, jpeg: bytes) -> dict[str, Any]:
    """Post a live picture post to the connected account. The picture is the post as drawn in Counterpart."""
    async with connection() as conn:
        acct = await account(conn, business["id"])
        if not acct:
            raise services.Conflict("Connect Instagram first, on the Channels page.")
        asset = await services.get_asset(conn, asset_id)
        if asset["status"] != "live":
            raise services.Conflict("Approve the post first.")
        if await fetch_one(conn, "select 1 from instagram_media where asset_id = %s", (asset["id"],)):
            raise services.Conflict("This post is already on Instagram.")
        tp = await fetch_one(conn, "select code from touchpoints where asset_id = %s", (asset["id"],))
        rev = await services.current_revision(conn, asset["id"])
    acct = await refresh_if_due(acct)
    key = f"instagram/{asset['id']}-{rev['n'] if rev else 0}.jpg"
    store = get_storage()
    s = get_settings()
    if not isinstance(store, SupabaseStorage) and s.supabase_url and s.supabase_service_role_key:
        # Meta must download the picture: Supabase Storage is public over https even while the app runs on a laptop
        store = SupabaseStorage(s.supabase_url, s.supabase_service_role_key.get_secret_value(), s.supabase_bucket)
    try:
        if isinstance(store, SupabaseStorage):
            await store.ensure_bucket()  # the app may run on local storage, so the bucket may not exist yet
        where = store.url(await store.put(key, jpeg, "image/jpeg"))
    except httpx.HTTPError as e:
        raise services.Conflict("Could not upload the picture for Instagram to download (Supabase Storage "
                                f"answered {getattr(getattr(e, 'response', None), 'status_code', 'nothing')}). "
                                "Try again in a minute.") from e
    image_url = where if where.startswith("http") else s.public_base_url.rstrip("/") + where
    if not image_url.startswith("https://"):
        raise services.Conflict("Instagram downloads the picture from a public https address. Start the tunnel "
                                "(see docs/CHANNELS.md) and set PUBLIC_BASE_URL to it, then try again.")
    text = caption((rev or {}).get("rendered") or {}, tp and tp["code"])
    made = await meta.graph("POST", meta.url(meta.IG, f"{acct['external_id']}/media"), token=acct["token"],
                            bearer=False, params={"image_url": image_url, "caption": text})
    for _ in range(20):  # Meta fetches and checks the picture before it can be published
        st = await _get(acct, made["id"], fields="status_code")
        if st.get("status_code") == "FINISHED":
            break
        if st.get("status_code") in ("ERROR", "EXPIRED"):
            raise meta.MetaError("Instagram could not use the picture. It must be a JPEG under 8 MB, 4:5 to 1.91:1.")
        await asyncio.sleep(1.5)
    else:
        raise meta.MetaError("Instagram is still processing the picture. Try again in a minute.")
    done = await meta.graph("POST", meta.url(meta.IG, f"{acct['external_id']}/media_publish"), token=acct["token"],
                            bearer=False, params={"creation_id": made["id"]})
    info = await _get(acct, done["id"], fields="permalink,timestamp,media_type")
    async with connection() as conn:
        await conn.execute(
            """insert into instagram_media (media_id, business_id, asset_id, permalink, caption, media_type, posted_at,
                                            published_by) values (%s, %s, %s, %s, %s, %s, %s, 'counterpart')""",
            (done["id"], business["id"], asset["id"], info.get("permalink"), text, info.get("media_type"),
             info.get("timestamp")))
        await ledger.record(conn, business["id"], "instagram.published", "Posted to Instagram", actor="owner",
                            campaign_id=asset["campaign_id"], payload={"media_id": done["id"], "permalink": info.get("permalink")})
    return {"media_id": done["id"], "permalink": info.get("permalink")}


async def link(business: dict[str, Any], asset_id: str, media_id: str) -> dict[str, Any]:
    """Tie a post the owner made in the Instagram app to a Counterpart post, so its insights are counted."""
    async with connection() as conn:
        acct = await account(conn, business["id"])
        if not acct:
            raise services.Conflict("Connect Instagram first, on the Channels page.")
        asset = await services.get_asset(conn, asset_id)
        campaign = await services.get_campaign(conn, asset["campaign_id"])
        if campaign["business_id"] != business["id"]:
            raise services.NotFound("not found")
    info = await _get(acct, media_id, fields="id,caption,permalink,timestamp,media_type")  # proves it is theirs
    async with connection() as conn:
        await conn.execute(
            """insert into instagram_media (media_id, business_id, asset_id, permalink, caption, media_type, posted_at,
                                            published_by) values (%s, %s, %s, %s, %s, %s, %s, 'owner')
               on conflict (media_id) do update set asset_id = excluded.asset_id""",
            (info["id"], business["id"], asset["id"], info.get("permalink"), info.get("caption"), info.get("media_type"),
             info.get("timestamp")))
    return {"media_id": info["id"], "permalink": info.get("permalink")}


def _values(data: list[dict[str, Any]]) -> dict[str, int]:
    out = {}
    for m in data:
        v = (m.get("values") or [{}])[0].get("value") if m.get("values") else (m.get("total_value") or {}).get("value")
        if isinstance(v, int | float):
            out[m["name"]] = int(v)
    return out


def engagement(m: dict[str, int]) -> float | None:
    """(likes + comments + saves + shares) / reach. None until Meta reports a reach."""
    if not m.get("reach"):
        return None
    acts = m.get("total_interactions")
    if acts is None:
        acts = sum(m.get(k, 0) for k in ("likes", "comments", "saved", "shares"))
    return round(acts / m["reach"], 4)


async def sync(business_id: Any, *, force: bool = False) -> int:
    """Re-read insights for the business's linked posts that are older than an hour. -> posts updated."""
    async with connection() as conn:
        acct = await account(conn, business_id)
        if not acct:
            return 0
        rows = await fetch_all(conn, """select media_id from instagram_media where business_id = %s
                                        and (%s or metrics_at is null or metrics_at < now() - %s)""",
                               (business_id, force, FRESH))
    n = 0
    for r in rows:
        try:
            d = await _get(acct, f"{r['media_id']}/insights", metric=",".join(METRICS))
        except meta.MetaError:
            try:  # some media types lack a metric (and older posts lack views): ask for the ones every post has
                d = await _get(acct, f"{r['media_id']}/insights", metric=",".join(CORE))
            except meta.MetaError:
                continue
        m = _values(d.get("data") or [])
        async with connection() as conn:
            await conn.execute("update instagram_media set metrics = %s, metrics_at = now() where media_id = %s",
                               (jsonb(m), r["media_id"]))
        n += 1
    return n


COMMENT_POSTS = 25  # comments are read on the account's latest posts, whether or not they are linked to a campaign


def _script(text: str) -> str:
    """A first guess at the language from the letters used; the model's reading replaces it."""
    if re.search(r"[ಀ-೿]", text):
        return "kn"
    return "hi" if re.search(r"[ऀ-ॿ]", text) else "en"


async def sync_comments(router: Any, business: dict[str, Any], *, force: bool = False) -> int:
    """Store new comments on the account's latest posts as reviews, then sort and read them. -> comments added.

    The business's own comments are skipped. Runs at most once an hour unless forced; claiming the slot is one
    atomic update, so page loads that arrive together do not read twice."""
    async with connection() as conn:
        acct = await fetch_one(
            conn, """update channel_accounts set meta = meta || jsonb_build_object('comments_at', now())
                     where business_id = %s and channel = 'instagram'
                       and (%s or meta->>'comments_at' is null or (meta->>'comments_at')::timestamptz < now() - %s)
                     returning *""", (business["id"], force, FRESH))
        if not acct:
            return 0
        linked = {r["media_id"]: r for r in await fetch_all(
            conn, """select m.media_id, m.asset_id, a.campaign_id from instagram_media m
                     left join assets a on a.id = m.asset_id where m.business_id = %s""", (business["id"],))}
    acct = await refresh_if_due(acct)
    own = (acct["display"] or "").lstrip("@").lower()
    found: list[tuple[str, dict[str, Any]]] = []
    for m in (await _get(acct, "me/media", limit=COMMENT_POSTS, fields="id,comments_count")).get("data") or []:
        if m.get("comments_count"):
            got = await _get(acct, f"{m['id']}/comments", limit=50, fields="id,text,timestamp,username")
            found += [(m["id"], c) for c in got.get("data") or []
                      if (c.get("text") or "").strip() and (c.get("username") or "").lower() != own]
    added = 0
    async with connection() as conn:
        for media_id, c in found:
            post = linked.get(media_id) or {}
            row = await fetch_one(
                conn, """insert into customer_interactions (business_id, source, language, body, occurred_at, external_id,
                                                            author, campaign_id, asset_id, is_synthetic)
                         values (%s, 'instagram_comment', %s, %s, coalesce(%s::timestamptz, now()), %s, %s, %s, %s, false)
                         on conflict (business_id, source, external_id) where external_id is not null do nothing
                         returning id""",
                (business["id"], _script(c["text"]), c["text"].strip(), c.get("timestamp"), c["id"], c.get("username"),
                 post.get("campaign_id"), post.get("asset_id")))
            added += row is not None
    read = await reviews.read_comments(router, business)
    if added or read:
        async with connection() as conn:
            await ledger.record(conn, business["id"], "customers.instagram",
                                f"Read {added} new Instagram comment{'s' if added != 1 else ''}", actor="agent",
                                payload={"added": added, "read": read})
    return added


async def reply(review: dict[str, Any], text: str) -> None:
    """Answer an Instagram comment publicly, under the comment, as the business."""
    async with connection() as conn:
        acct = await account(conn, review["business_id"])
    if not acct:
        raise services.Conflict("Connect Instagram first, on the Channels page.")
    await meta.graph("POST", meta.url(meta.IG, f"{review['external_id']}/replies"), token=acct["token"], bearer=False,
                     params={"message": text})


async def stats(conn: Conn, asset_ids: list[str]) -> dict[str, dict[str, Any]]:
    rows = await fetch_all(conn, """select asset_id::text as asset_id, media_id, permalink, metrics, metrics_at,
                                           published_by from instagram_media where asset_id = any(%s::uuid[])""",
                           (asset_ids,))
    return {r["asset_id"]: {**{k: v for k, v in r.items() if k not in ("asset_id", "metrics")},
                            **(r["metrics"] or {}), "engagement_rate": engagement(r["metrics"] or {})} for r in rows}
