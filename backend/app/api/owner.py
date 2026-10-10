"""Owner-facing API. Every route needs a signed-in user (current_user) who is a member of the business it touches."""

import asyncio
import json
import random
from datetime import UTC, date, datetime, timedelta
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app import ledger, reviews, services
from app.agent import runtime, situation
from app.agent.tools import DraftFactsArgs
from app.api.deps import get_router, require_owner, tool_context
from app.auth import CurrentUser, User, business_for, require_member
from app.channels import instagram, meta, whatsapp
from app.config import get_settings
from app.db import connection, fetch_all, fetch_one, jsonb
from app.domain import analytics, culture, redeem
from app.domain.facts import AssetContent
from app.storage import get_storage

api = APIRouter(prefix="/api", dependencies=[Depends(require_owner)])


# ------------------------------------------------------------------ business


@api.get("/businesses/{slug}")
async def get_business(user: CurrentUser, slug: str) -> dict[str, Any]:
    async with connection() as conn:
        b = await business_for(conn, user, slug)
        brand = await services.active_brand(conn, b["id"])
        campaigns = await fetch_all(
            conn,
            """select c.id, c.name, c.status, c.starts_on, c.ends_on, c.is_historical, c.created_at,
                      (select count(*) from assets a where a.campaign_id = c.id)::int as assets,
                      (select coalesce(sum(qty), 0) from outcome_events o
                        where o.campaign_id = c.id and o.type = 'redeem')::int as redemptions,
                      (select count(*) from assets a where a.campaign_id = c.id and a.status = 'live')::int as live,
                      (select r.image_key from assets a join asset_revisions r
                         on r.asset_id = a.id and r.n = a.current_revision
                        where a.campaign_id = c.id and r.image_key is not null and a.status <> 'rejected'
                        order by (a.channel = 'instagram_post') desc, a.created_at limit 1) as cover_key
               from campaigns c where c.business_id = %s order by c.created_at desc""",
            (b["id"],))
        storage = get_storage()
        for c in campaigns:
            key = c.pop("cover_key")
            c["cover_url"] = storage.url(key) if key else None
        inbox = await fetch_all(
            conn, """select * from inbox_items where business_id = %s and status = 'pending'
                     order by priority, created_at desc""", (b["id"],))
        learnings = await fetch_all(
            conn, """select id, kind, status, content, scope, confidence, created_by, created_at from memories
                     where business_id = %s and kind in ('learning', 'brand_rule') and status <> 'rejected'
                     order by created_at desc limit 12""", (b["id"],))
        findings = await situation.detect(conn, b, None)
    return {"business": b, "brand": brand, "campaigns": campaigns, "inbox": inbox, "learnings": learnings,
            "findings": findings}


async def _read_instagram_comments(router: Any, business: dict[str, Any]) -> None:
    try:
        await instagram.sync_comments(router, business)
    except meta.MetaError:  # an expired token or a Meta outage: the Channels page shows the connection state
        pass


@api.get("/businesses/{slug}/customers")
async def customers(user: CurrentUser, slug: str, request: Request, bg: BackgroundTasks, days: int = 14) -> dict[str, Any]:
    async with connection() as conn:
        b = await business_for(conn, user, slug)
        if await instagram.account(conn, b["id"]):
            bg.add_task(_read_instagram_comments, get_router(request), b)  # reads at most once an hour
        themes = await situation.theme_trends(conn, b["id"], days=days)
        recent = await fetch_all(
            conn, """select ci.id, ci.source, ci.language, ci.segment, ci.rating, ci.body, ci.occurred_at, ci.sentiment,
                            ci.themes, ci.translation, ci.reply, ci.replied_at, ci.claim_code, c.name as campaign,
                            cl.via, ci.category, ci.author
                     from customer_interactions ci left join campaigns c on c.id = ci.campaign_id
                     left join claims cl on cl.code = ci.claim_code
                     where ci.business_id = %s and ci.category is distinct from 'spam'
                     order by ci.occurred_at desc limit 60""",
            (b["id"],))
        comments = await fetch_all(
            conn, """select coalesce(category, 'unread') as category, count(*)::int as n from customer_interactions
                     where business_id = %s and source = 'instagram_comment' group by 1""", (b["id"],))
        visits = await fetch_one(
            conn, """select count(*)::int as n, round(avg(rating)::numeric, 1)::float as average,
                            array[count(*) filter (where rating = 1), count(*) filter (where rating = 2),
                                  count(*) filter (where rating = 3), count(*) filter (where rating = 4),
                                  count(*) filter (where rating = 5)]::int[] as stars,
                            count(*) filter (where reply is null and rating <= 3)::int as waiting
                     from customer_interactions where business_id = %s and source = 'visit_review'
                       and occurred_at > now() - interval '90 days'""", (b["id"],))
        insights = await fetch_all(
            conn, "select kind, key, period_start, period_end, data from customer_insights where business_id = %s "
                  "order by kind, period_start nulls last", (b["id"],))
        mix = await fetch_all(
            conn, """select language, count(*)::int as n, round(avg(sentiment)::numeric, 2)::float as sentiment
                     from customer_interactions where business_id = %s and category is distinct from 'spam'
                     group by language order by n desc""",
            (b["id"],))
    return {"themes": themes, "recent": recent, "insights": insights, "language_mix": mix, "visits": visits,
            "instagram_comments": {r["category"]: r["n"] for r in comments},
            "google_review_url": (b["profile"] or {}).get("google_review_url")}


async def _review_for(conn: Any, user: User, review_id: str) -> dict[str, Any]:
    r = await fetch_one(conn, "select * from customer_interactions where id = %s", (review_id,))
    if not r:
        raise services.NotFound("not found")
    await require_member(conn, user, r["business_id"])
    return r


@api.post("/reviews/{review_id}/reply/draft")
async def draft_review_reply(user: CurrentUser, review_id: str, request: Request) -> dict[str, Any]:
    """A reply in the customer's language and the owner's voice, for the owner to edit. Nothing is sent."""
    async with connection() as conn:
        r = await _review_for(conn, user, review_id)
        b = await services.get_business_by_id(conn, r["business_id"])
        brand = await services.active_brand(conn, b["id"])
    return {"reply": await reviews.draft_reply(get_router(request), b, r, brand)}


class ReviewReply(BaseModel):
    reply: str = Field(min_length=1, max_length=1500)
    send_whatsapp: bool = False
    send_instagram: bool = False


@api.put("/reviews/{review_id}/reply")
async def save_review_reply(user: CurrentUser, review_id: str, body: ReviewReply) -> dict[str, Any]:
    """Keep the owner's reply. A review that came from WhatsApp can get the reply there, free inside 24 hours; an
    Instagram comment gets it as a public reply under the comment (posted first, kept only once Instagram took it)."""
    async with connection() as conn:
        r = await _review_for(conn, user, review_id)
    if body.send_instagram:
        if r["source"] != "instagram_comment" or not r["external_id"]:
            raise services.Conflict("Only an Instagram comment can be answered on Instagram.")
        try:
            await instagram.reply(r, body.reply.strip())
        except meta.MetaError as e:
            raise services.Conflict(f"Meta said: {e}") from e
    async with connection() as conn:
        await conn.execute("update customer_interactions set reply = %s, replied_at = now() where id = %s",
                           (body.reply.strip(), review_id))
    sent = await whatsapp.send_review_reply(r, body.reply.strip()) if body.send_whatsapp else False
    return {"ok": True, "sent_on_whatsapp": sent, "sent_on_instagram": body.send_instagram}


class ReviewLink(BaseModel):
    url: str = Field("", max_length=300)


@api.put("/businesses/{slug}/review-link")
async def set_review_link(user: CurrentUser, slug: str, body: ReviewLink) -> dict[str, Any]:
    """The business's own Google "Ask for reviews" link, offered to every reviewer after they review."""
    url = body.url.strip()
    host = (urlparse(url).hostname or "") if url else ""
    if url and (not url.startswith("https://") or not any(host == h or host.endswith("." + h) for h in
                                                            ("g.page", "google.com", "goo.gl", "maps.app.goo.gl"))):
        raise services.Conflict("Paste the link from Google Business Profile: 'Ask for reviews' gives one like "
                                "https://g.page/r/... ")
    async with connection() as conn:
        b = await business_for(conn, user, slug)
        await conn.execute("update businesses set profile = profile || %s where id = %s",
                           (jsonb({"google_review_url": url or None}), b["id"]))
    return {"ok": True}


@api.get("/businesses/{slug}/ledger")
async def get_ledger(user: CurrentUser, slug: str, campaign_id: str | None = None, before_id: int | None = None,
                     limit: int = 50) -> list[dict[str, Any]]:
    async with connection() as conn:
        b = await business_for(conn, user, slug)
        return await fetch_all(
            conn,
            """select * from ledger_events where business_id = %s
               and (%s::uuid is null or campaign_id = %s::uuid) and (%s::bigint is null or id < %s)
               order by id desc limit %s""",
            (b["id"], campaign_id, campaign_id, before_id, before_id, min(limit, 200)))


@api.get("/businesses/{slug}/events")
async def stream(user: CurrentUser, slug: str, request: Request) -> EventSourceResponse:
    """Live ledger feed (Server-Sent Events) for the activity panel."""
    async with connection() as conn:
        b = await business_for(conn, user, slug)
    q = ledger.subscribe()

    async def gen():
        try:
            while not await request.is_disconnected():
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                except TimeoutError:
                    yield {"event": "ping", "data": "{}"}
                    continue
                if str(ev["business_id"]) == str(b["id"]):
                    yield {"event": "ledger", "data": json.dumps(ev, default=str, ensure_ascii=False)}
        finally:
            ledger.unsubscribe(q)

    return EventSourceResponse(gen())


@api.get("/system/status")
async def system_status(user: CurrentUser, request: Request) -> dict[str, Any]:
    s = get_settings()
    return {**get_router(request).status(), "storage": s.storage_backend}


# ------------------------------------------------------------------ campaigns


class NewCampaign(BaseModel):
    brief: str = Field(min_length=3, description="The owner's own words, typed or spoken.")
    name: str | None = None
    run_agent: bool = True


@api.post("/businesses/{slug}/campaigns")
async def create_campaign(user: CurrentUser, slug: str, body: NewCampaign, request: Request, bg: BackgroundTasks) -> dict[str, Any]:
    async with connection() as conn:
        b = await business_for(conn, user, slug)
        c = await services.create_campaign(conn, b["id"], name=body.name or _name_from(body.brief), brief=body.brief)
    if body.run_agent:
        bg.add_task(runtime.run, tool_context(request, b, str(c["id"])), f"New brief from the owner: {body.brief}")
    return c


@api.get("/campaigns/{campaign_id}")
async def get_campaign(user: CurrentUser, campaign_id: str) -> dict[str, Any]:
    async with connection() as conn:
        c = await services.get_campaign(conn, campaign_id)
        await require_member(conn, user, c["business_id"])
        facts = await fetch_all(conn, "select * from offer_facts where campaign_id = %s order by version desc",
                                (campaign_id,))
        assets = await fetch_all(
            conn,
            """select a.*, to_jsonb(r) - 'asset_id' as revision,
                      (select json_agg(json_build_object('code', t.code, 'kind', t.kind))
                       from touchpoints t where t.asset_id = a.id) as touchpoints,
                      (select json_object_agg(type, n) from (
                         select type, sum(qty)::int as n from outcome_events o where o.asset_id = a.id group by type) x
                      ) as outcomes,
                      (select json_build_object('media_id', m.media_id, 'permalink', m.permalink)
                       from instagram_media m where m.asset_id = a.id limit 1) as instagram
               from assets a left join asset_revisions r on r.asset_id = a.id and r.n = a.current_revision
               where a.campaign_id = %s order by a.created_at""",
            (campaign_id,))
        exps = [await services.experiment_status(conn, e["id"]) for e in await fetch_all(
            conn, "select id from experiments where campaign_id = %s order by created_at", (campaign_id,))]
        inbox = await fetch_all(conn, """select * from inbox_items where campaign_id = %s and status = 'pending'
                                         order by priority, created_at desc""", (campaign_id,))
    storage = get_storage()
    keys = [(a.get("revision") or {}).get("image_key") for a in assets]
    async with connection() as conn:
        lib = {p["image_key"]: p for p in await fetch_all(
            conn, "select image_key, source, attribution, caption from business_photos where image_key = any(%s)",
            ([k for k in keys if k],))}
        b = await fetch_one(conn, "select languages from businesses where id = %s", (c["business_id"],))
    for a in assets:
        rev = a.get("revision") or {}
        a["image_url"] = storage.url(rev["image_key"]) if rev.get("image_key") else None
        # where the picture came from: a real photo of the business (with credit) or an AI picture
        p = lib.get(rev.get("image_key"))
        a["image_source"] = ({"source": p["source"], "attribution": p["attribution"], "caption": p["caption"]} if p
                             else {"source": "generated"} if rev.get("image_key") else None)
    festivals = culture.relevant(f"{c['name']} {c.get('brief') or ''} {json.dumps(c.get('intent') or {})}",
                                 c.get("starts_on"), c.get("ends_on"))
    return {"campaign": c, "facts": facts, "assets": assets, "experiments": exps, "inbox": inbox,
            "culture": [culture.card(f, b["languages"], today=_today()) for f in festivals]}


IST = ZoneInfo("Asia/Kolkata")
CHANNEL_NAMES = {"instagram_post": "Instagram posts", "instagram_story": "Instagram stories", "poster": "Counter posters",
                 "whatsapp": "WhatsApp"}
LANGUAGE_NAMES = {"en": "English", "kn": "Kannada", "hi": "Hindi"}


def _today() -> date:
    return datetime.now(IST).date()


@api.get("/campaigns/{campaign_id}/analytics")
async def campaign_analytics(user: CurrentUser, campaign_id: str, bg: BackgroundTasks) -> dict[str, Any]:
    """Funnel, trend, best hours, breakdowns and optimisation tips for one campaign."""
    async with connection() as conn:
        c = await services.get_campaign(conn, campaign_id)
        await require_member(conn, user, c["business_id"])
        b = await services.get_business_by_id(conn, c["business_id"])
        posts = await fetch_all(
            conn, """select a.id::text as asset_id, t.code, a.channel, a.language, a.segment, a.variant,
                            r.rendered->>'headline' as headline
                     from touchpoints t join assets a on a.id = t.asset_id
                     left join asset_revisions r on r.asset_id = a.id and r.n = a.current_revision
                     where t.campaign_id = %s order by a.created_at""", (campaign_id,))
        events = await fetch_all(
            conn, """select asset_id::text, type, qty, source, occurred_at at time zone 'Asia/Kolkata' as at,
                            (meta->>'bill_amount')::float as bill
                     from outcome_events where campaign_id = %s""", (campaign_id,))
        exps = [await services.experiment_status(conn, e["id"]) for e in await fetch_all(
            conn, "select id from experiments where campaign_id = %s and status <> 'decided'", (campaign_id,))]
        ids = [p["asset_id"] for p in posts]
        ratings = {r["asset_id"]: {"n": r["n"], "average": r["average"]} for r in await fetch_all(
            conn, """select asset_id::text as asset_id, count(*)::int as n, round(avg(rating)::numeric, 1)::float as average
                     from customer_interactions where campaign_id = %s and source = 'visit_review' and rating is not null
                     group by asset_id""", (campaign_id,))}
        channels = {"whatsapp": await whatsapp.stats(conn, ids), "instagram": await instagram.stats(conn, ids),
                    "instagram_connected": await instagram.account(conn, b["id"]) is not None,
                    "whatsapp_connected": await whatsapp.account(conn, b["id"]) is not None}
    if channels["instagram_connected"]:
        bg.add_task(instagram.sync, b["id"])  # re-reads only insights older than an hour
    today = _today()
    created = c["created_at"].astimezone(IST).date()
    first = min((e["at"].date() for e in events), default=created)
    langs = b.get("languages") or ["en"]
    text = f"{c['name']} {c.get('brief') or ''}"
    festivals = {f.key: f for f in culture.relevant(text, c.get("starts_on"), c.get("ends_on"))}
    festivals.update({f.key: f for f, *_ in culture.upcoming(today, days=14)})
    out = analytics.summarize(
        posts, events, today=today, since=min(first, created),
        labels={"channel": CHANNEL_NAMES, "language": LANGUAGE_NAMES},
        festivals=[culture.card(f, langs, today=today) for f in festivals.values()],
        experiments=[{"winner": next((a["variant"] for a in e["arms"] if a["asset_id"] == e["decision"]["winner"]),
                                     e["decision"]["winner"]), "arms": e["arms"]} for e in exps])
    out["channels"] = channels
    out["ratings"] = ratings  # stars from verified visits, per post that brought them
    return out


@api.get("/businesses/{slug}/culture")
async def business_culture(user: CurrentUser, slug: str) -> dict[str, Any]:
    """Festivals in the next two months, with hand-checked greetings in the business's languages."""
    async with connection() as conn:
        b = await business_for(conn, user, slug)
    today = _today()
    return {"festivals": [culture.card(f, b["languages"], today=today) for f, *_ in culture.upcoming(today, days=60)]}


def _redeem_time(rng: random.Random, claimed: datetime, rules: Any, now: datetime) -> datetime | None:
    """When a simulated customer who claimed comes in: the first moment the offer allows, a few hours to two days
    later, inside opening hours (8 am to 9:30 pm when the offer names no hours). None if they never make it."""
    t = claimed + timedelta(hours=rng.randint(1, 30), minutes=rng.randint(0, 59))
    for _ in range(4 * 72):  # look up to three days ahead, a quarter-hour at a time
        if t > now:
            return None
        open_now = rules.hours is not None or (8 <= t.hour < 21 or (t.hour == 21 and t.minute < 30))
        if open_now and redeem.evaluate(rules, t)[0]:
            return t
        t += timedelta(minutes=15)
    return None


@api.post("/campaigns/{campaign_id}/simulate")
async def simulate_week(user: CurrentUser, campaign_id: str) -> dict[str, Any]:
    """Demo control: plausible opens, claims and redemptions on the live posts, stored as 'simulated' and labelled
    in the UI, so the analytics can be shown before real customers arrive. They stay inside the campaign's own dates
    (up to its last 7 days), follow the offer's days and hours, and replace any earlier simulated results."""
    async with connection() as conn:
        c = await services.get_campaign(conn, campaign_id)
        await require_member(conn, user, c["business_id"])
        b = await services.get_business_by_id(conn, c["business_id"])
        if not b.get("is_demo"):
            raise services.Conflict("Simulated results can only be added to the demo business.")
        tps = await fetch_all(conn, """select t.code, a.id as asset_id, a.channel, a.language from touchpoints t
                                       join assets a on a.id = t.asset_id where t.campaign_id = %s""", (campaign_id,))
        if not tps:
            raise services.Conflict("Approve some posts first; simulated results attach to live posts.")
        sheet = await services.locked_sheet(conn, campaign_id)
        rules = redeem.rules([f.model_dump() for f in sheet.facts] if sheet else [],
                             starts_on=c.get("starts_on"), ends_on=c.get("ends_on"))
        prices = [float(m["price"]) for m in (b["profile"] or {}).get("menu", []) if m.get("price")] or [60, 90, 120]
        rng = random.Random(campaign_id)
        now = datetime.now(IST).replace(tzinfo=None)
        first = max(c["created_at"].astimezone(IST).date(), now.date() - timedelta(days=6))
        days = (now.date() - first).days + 1
        # Evening-heavy opens; WhatsApp and Kannada a little stronger, so the tips have something to find.
        hours = [7, 8, 9, 12, 13, 16, 17, 17, 18, 18, 18, 19, 19, 20, 21]
        rows = []
        for tp in tps:
            base = {"whatsapp": 0.3, "instagram_post": 0.16, "instagram_story": 0.12, "poster": 0.2}.get(tp["channel"], 0.15)
            base *= 1.35 if tp["language"] == "kn" else 1.0
            for d in range(days):
                day = first + timedelta(days=d)
                for _ in range(rng.randint(4, 10) + d):
                    at = datetime.combine(day, datetime.min.time()).replace(hour=rng.choice(hours), minute=rng.randint(0, 59))
                    if at > now:
                        continue
                    rows.append((tp, "scan", at, {"synthetic": True}))
                    if rng.random() < base * 2.2:
                        rows.append((tp, "click", at + timedelta(minutes=1), {"synthetic": True}))
                        if rng.random() < 0.6 and (when := _redeem_time(rng, at, rules, now)):
                            meta: dict[str, Any] = {"synthetic": True}
                            if rng.random() < 0.7:  # staff do not always type the bill
                                meta["bill_amount"] = round(sum(rng.choice(prices) for _ in range(rng.randint(1, 3))))
                            rows.append((tp, "redeem", when, meta))
        await conn.execute("delete from outcome_events where campaign_id = %s and source = 'simulated'", (campaign_id,))
        async with conn.cursor() as cur:
            await cur.executemany(
                """insert into outcome_events (campaign_id, asset_id, touchpoint_code, type, source, occurred_at, meta)
                   values (%s, %s, %s, %s, 'simulated', %s, %s)""",
                [(campaign_id, tp["asset_id"], tp["code"], kind, at.replace(tzinfo=IST).astimezone(UTC), jsonb(meta))
                 for tp, kind, at, meta in rows])
        await ledger.record(conn, c["business_id"], "outcome.simulated",
                            f"Simulated {days} day{'s' if days != 1 else ''} of customers for the demo "
                            f"({len(rows)} results, labelled as simulated; earlier simulated results replaced)",
                            actor="system", campaign_id=c["id"], payload={"synthetic": True, "events": len(rows)})
    return {"events": len(rows), "days": days}


class AgentMessage(BaseModel):
    message: str = Field(min_length=1)


@api.post("/campaigns/{campaign_id}/agent")
async def talk_to_agent(user: CurrentUser, campaign_id: str, body: AgentMessage, request: Request,
                        bg: BackgroundTasks) -> dict[str, str]:
    """Voice or typed instruction ("make it Sunday only"). The agent decides what to do with it."""
    async with connection() as conn:
        c = await services.get_campaign(conn, campaign_id)
        await require_member(conn, user, c["business_id"])
        b = await services.get_business_by_id(conn, c["business_id"])
        await ledger.record(conn, b["id"], "owner.said", body.message, actor="owner", campaign_id=campaign_id)
    bg.add_task(runtime.run, tool_context(request, b, campaign_id), f"The owner says: {body.message}")
    return {"status": "accepted"}


@api.put("/campaigns/{campaign_id}/facts/draft")
async def edit_draft_facts(user: CurrentUser, campaign_id: str, body: DraftFactsArgs, request: Request) -> dict[str, Any]:
    async with connection() as conn:
        c = await services.get_campaign(conn, campaign_id)
        await require_member(conn, user, c["business_id"])
        row = await services.save_draft_facts(conn, c, facts=[f.model_dump() for f in body.facts],
                                              forbidden_claims=body.forbidden_claims, reason=body.reason,
                                              actor="owner")
    row["wording_check"] = await services.check_fact_wording(get_router(request), connection, campaign_id)
    return row


@api.post("/campaigns/{campaign_id}/facts/lock")
async def lock_facts(user: CurrentUser, campaign_id: str, request: Request, bg: BackgroundTasks, resume: bool = True,
                     autopublish: bool = False) -> dict[str, Any]:
    async with connection() as conn:
        await require_member(conn, user, (await services.get_campaign(conn, campaign_id))["business_id"])
    await services.check_fact_wording(get_router(request), connection, campaign_id)  # no-op if already checked
    async with connection() as conn:
        c = await services.get_campaign(conn, campaign_id)
        await require_member(conn, user, c["business_id"])
        b = await services.get_business_by_id(conn, c["business_id"])
        res = await services.lock_facts(conn, c, actor="owner")
        # Approving in advance covers only this offer version: a later change asks again.
        await conn.execute("update campaigns set autopublish_version = %s where id = %s",
                           (res["facts"]["version"] if autopublish else None, campaign_id))
        # a direct owner lock settles any pending agent request to lock
        await conn.execute(
            """update inbox_items set status = 'approved', decided_at = now(), decision = '{"via": "direct"}'
               where campaign_id = %s and status = 'pending' and payload->>'tool' = 'lock_facts'""", (campaign_id,))
    if resume:
        bg.add_task(runtime.run, tool_context(request, b, campaign_id),
                    f"The owner locked offer facts v{res['facts']['version']}. Carry on with the campaign.")
    return res


class AutopublishBody(BaseModel):
    on: bool


@api.put("/campaigns/{campaign_id}/autopublish")
async def set_autopublish(user: CurrentUser, campaign_id: str, body: AutopublishBody) -> dict[str, Any]:
    """Put posts live by themselves once they pass every check (for the locked offer version), or ask each time."""
    async with connection() as conn:
        c = await services.get_campaign(conn, campaign_id)
        await require_member(conn, user, c["business_id"])
        sheet = await services.locked_sheet(conn, campaign_id)
        if body.on and not sheet:
            raise services.Conflict("Lock the offer first.")
        await conn.execute("update campaigns set autopublish_version = %s where id = %s",
                           (sheet.version if body.on and sheet else None, campaign_id))
        await ledger.record(conn, c["business_id"], "campaign.autopublish",
                            "Posts that pass every check now go live by themselves" if body.on
                            else "Each post waits for your OK again", actor="owner", campaign_id=campaign_id)
        live = await services.autopublish(conn, campaign_id) if body.on else []
    return {"on": body.on, "went_live": live}


class PublishBody(BaseModel):
    asset_ids: list[str] = Field(min_length=1)


@api.post("/campaigns/{campaign_id}/publish")
async def publish(user: CurrentUser, campaign_id: str, body: PublishBody, request: Request) -> dict[str, Any]:
    async with connection() as conn:
        c = await services.get_campaign(conn, campaign_id)
        await require_member(conn, user, c["business_id"])
        b = await services.get_business_by_id(conn, c["business_id"])
    ctx = tool_context(request, b, campaign_id, actor="owner")
    ctx.approved = True
    res = await runtime.execute(ctx, "publish_assets", {"asset_ids": body.asset_ids, "summary": "Owner published"})
    if not res.get("ok"):
        raise services.Conflict(res.get("error") or res.get("precondition_failed") or "Could not publish.")
    return res


# ------------------------------------------------------------------ assets


class AssetEdit(BaseModel):
    content: AssetContent
    reason: str | None = "Edited by the owner"


@api.patch("/assets/{asset_id}")
async def edit_asset(user: CurrentUser, asset_id: str, body: AssetEdit, request: Request, bg: BackgroundTasks) -> dict[str, Any]:
    """Owner edit: the deterministic guard runs immediately, the meaning check runs in the background."""
    router = get_router(request)
    async with connection() as conn:
        asset = await _asset_for(conn, user, asset_id)
        prev = await services.current_revision(conn, asset_id)
        rev = await services.add_revision(conn, asset, body.content, created_by="owner", reason=body.reason,
                                          verifier_available=router.available("verification"))
        if prev:  # edit signals feed brand memory later
            c = await services.get_campaign(conn, asset["campaign_id"])
            await conn.execute(
                """insert into memories (business_id, campaign_id, kind, content, evidence, created_by)
                   values (%s, %s, 'edit_signal', %s, %s, 'owner')""",
                (c["business_id"], c["id"], f"Owner edited {asset['channel']} ({asset['language']})",
                 jsonb({"asset_id": asset_id, "before": prev["rendered"], "after": rev["rendered"]})))
    if rev["validation"]["passed"] and router.available("verification"):
        bg.add_task(services.audit_assets, router, connection, [asset_id])
    return rev


@api.post("/assets/{asset_id}/approve")
async def approve_asset(user: CurrentUser, asset_id: str) -> dict[str, Any]:
    async with connection() as conn:
        await _asset_for(conn, user, asset_id)
        return await services.approve_asset(conn, asset_id, actor="owner")


@api.post("/assets/{asset_id}/reject")
async def reject_asset(user: CurrentUser, asset_id: str) -> dict[str, Any]:
    async with connection() as conn:
        a = await _asset_for(conn, user, asset_id)
        row = await fetch_one(conn, "update assets set status = 'rejected', updated_at = now() where id = %s "
                                    "returning *", (asset_id,))
        c = await services.get_campaign(conn, a["campaign_id"])
        await ledger.record(conn, c["business_id"], "asset.rejected",
                            f"Rejected the {services.asset_label(a)}", actor="owner", campaign_id=c["id"])
    return row  # type: ignore[return-value]


@api.get("/experiments/{experiment_id}")
async def experiment(user: CurrentUser, experiment_id: str) -> dict[str, Any]:
    async with connection() as conn:
        exp = await fetch_one(conn, "select c.business_id from experiments e join campaigns c on c.id = e.campaign_id "
                                    "where e.id = %s", (experiment_id,))
        if not exp:
            raise services.NotFound("experiment not found")
        await require_member(conn, user, exp["business_id"])
        return await services.experiment_status(conn, experiment_id)


# ------------------------------------------------------------------ inbox & counter


class Decision(BaseModel):
    approve: bool
    note: str | None = None
    resume: bool = Field(True, description="Let the agent carry on with the campaign after the decision.")


@api.post("/inbox/{item_id}/decision")
async def decide(user: CurrentUser, item_id: str, body: Decision, request: Request, bg: BackgroundTasks) -> dict[str, Any]:
    async with connection() as conn:
        item = await fetch_one(conn, "select business_id, campaign_id, title from inbox_items where id = %s",
                               (item_id,))
        if not item:
            raise services.NotFound("inbox item not found")
        await require_member(conn, user, item["business_id"])
        b = await services.get_business_by_id(conn, item["business_id"])
    res = await runtime.decide_inbox(tool_context(request, b, None, actor="owner"), item_id,
                                     approve=body.approve, note=body.note)
    if body.resume and item["campaign_id"]:  # an employee carries on once the owner has decided
        verdict = "approved" if body.approve else "declined"
        bg.add_task(runtime.run, tool_context(request, b, str(item["campaign_id"])),
                    f"The owner {verdict}: {item['title']}" + (f" Note: {body.note}" if body.note else "")
                    + ". Carry on with the campaign.")
    return res


class CounterCode(BaseModel):
    code: str = Field(min_length=4, max_length=12)


class CounterRedeem(CounterCode):
    bill_amount: float | None = Field(None, ge=0, le=1_000_000)
    outside_rules: str | None = Field(None, max_length=200, description="Why staff redeem although the offer rules say no.")


async def _code_owner(conn: Any, user: User, code: str) -> None:
    it = await services.find_code(conn, code)
    await require_member(conn, user, it["business_id"])


@api.post("/counter/check")
async def counter_check(user: CurrentUser, body: CounterCode) -> dict[str, Any]:
    """What staff see when a customer shows a code: can it be used now, and what to check by eye."""
    async with connection() as conn:
        await _code_owner(conn, user, body.code)
        return await services.counter_check(conn, body.code)


@api.post("/counter/redeem")
async def counter_redeem(user: CurrentUser, body: CounterRedeem, bg: BackgroundTasks) -> dict[str, Any]:
    """Staff tap at the counter when a customer shows a code. A personal code works once."""
    async with connection() as conn:
        await _code_owner(conn, user, body.code)
        out = await services.counter_redeem(conn, body.code, by=f"owner:{user.id}", bill_amount=body.bill_amount,
                                            outside_rules=body.outside_rules)
    if out.get("via") == "whatsapp":
        bg.add_task(whatsapp.ask_review, out["code"])  # "How was it?" inside the free 24-hour window
    return out


@api.get("/businesses/{slug}/counter")
async def counter_settings(user: CurrentUser, slug: str) -> dict[str, Any]:
    async with connection() as conn:
        b = await business_for(conn, user, slug)
        recent = await fetch_all(
            conn, """select o.occurred_at, o.touchpoint_code, o.meta, c.name as campaign
                     from outcome_events o join campaigns c on c.id = o.campaign_id
                     where c.business_id = %s and o.type = 'redeem' and o.source = 'counter'
                     order by o.occurred_at desc limit 12""", (b["id"],))
        phones = await fetch_one(conn, "select count(*)::int as n from counter_sessions where business_id = %s and "
                                       "expires_at > now()", (b["id"],))
    return {"pin_set": b.get("counter_pin_hash") is not None, "staff_phones": phones["n"] if phones else 0,
            "whatsapp": (b["profile"] or {}).get("whatsapp"),
            "staff_link": f"{get_settings().public_base_url.rstrip('/')}/k/desk/{b['slug']}",
            "recent": [{"at": r["occurred_at"], "code": (r["meta"] or {}).get("claim") or r["touchpoint_code"],
                        "campaign": r["campaign"], "bill_amount": (r["meta"] or {}).get("bill_amount"),
                        "outside_rules": (r["meta"] or {}).get("outside_rules")} for r in recent]}


class CounterSettings(BaseModel):
    pin: str | None = Field(None, pattern=r"^\d{4,6}$")
    whatsapp: str | None = Field(None, max_length=20, description="Number customers message to claim an offer.")


@api.put("/businesses/{slug}/counter")
async def update_counter(user: CurrentUser, slug: str, body: CounterSettings) -> dict[str, Any]:
    async with connection() as conn:
        b = await business_for(conn, user, slug)
        if body.pin:
            await services.set_counter_pin(conn, b, body.pin)
        if body.whatsapp is not None:
            number = services.whatsapp_number(body.whatsapp)
            if body.whatsapp.strip() and not number:
                raise services.Conflict("Type the WhatsApp number with its country code, e.g. +91 98450 12345.")
            await conn.execute("update businesses set profile = profile || %s where id = %s",
                               (jsonb({"whatsapp": number}), b["id"]))
    return {"ok": True}


async def _asset_for(conn: Any, user: User, asset_id: str) -> dict[str, Any]:
    asset = await services.get_asset(conn, asset_id)
    await require_member(conn, user, (await services.get_campaign(conn, asset["campaign_id"]))["business_id"])
    return asset


def _name_from(brief: str) -> str:
    words = brief.strip().split()
    return " ".join(words[:6]) + ("…" if len(words) > 6 else "")


# ------------------------------------------------------------------ business-level agent & demo controls


@api.post("/businesses/{slug}/agent")
async def business_agent(user: CurrentUser, slug: str, body: AgentMessage, request: Request, bg: BackgroundTasks) -> dict[str, str]:
    """Run the agent without a campaign in focus (e.g. a daily check-in or a new idea)."""
    async with connection() as conn:
        b = await business_for(conn, user, slug)
    bg.add_task(runtime.run, tool_context(request, b, None), body.message)
    return {"status": "accepted"}


@api.post("/businesses/{slug}/demo/new-reviews")
async def demo_new_reviews(user: CurrentUser, slug: str, request: Request, bg: BackgroundTasks) -> dict[str, Any]:
    """Demo control: ingest the labelled synthetic review batch, then let the agent react on its own."""
    from scripts.seed import SEED, insert_interactions

    async with connection() as conn:
        b = await business_for(conn, user, slug)
        if not b.get("is_demo"):
            raise services.Conflict("Demo reviews can only be added to the demo business.")
        n = await insert_interactions(conn, b["id"], json.loads(SEED.read_text())["demo_new_reviews"])
        await ledger.record(conn, b["id"], "customers.ingested", f"{n} new reviews arrived (synthetic demo batch)",
                            actor="system", payload={"synthetic": True})
    bg.add_task(runtime.run, tool_context(request, b, None), "New customer reviews arrived. Check the findings.")
    return {"ingested": n}
