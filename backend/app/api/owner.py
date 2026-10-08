"""Owner-facing API. Everything here is behind require_owner."""

import asyncio
import json
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app import ledger, services
from app.agent import runtime, situation
from app.agent.tools import DraftFactsArgs
from app.api.deps import get_router, require_owner, tool_context
from app.db import connection, fetch_all, fetch_one, jsonb
from app.domain.facts import AssetContent
from app.storage import get_storage

api = APIRouter(prefix="/api", dependencies=[Depends(require_owner)])


# ------------------------------------------------------------------ business


@api.get("/businesses/{slug}")
async def get_business(slug: str) -> dict[str, Any]:
    async with connection() as conn:
        b = await services.get_business(conn, slug)
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


@api.get("/businesses/{slug}/customers")
async def customers(slug: str, days: int = 14) -> dict[str, Any]:
    async with connection() as conn:
        b = await services.get_business(conn, slug)
        themes = await situation.theme_trends(conn, b["id"], days=days)
        recent = await fetch_all(
            conn, """select id, source, language, segment, rating, body, occurred_at, sentiment, themes
                     from customer_interactions where business_id = %s order by occurred_at desc limit 40""",
            (b["id"],))
        insights = await fetch_all(
            conn, "select kind, key, period_start, period_end, data from customer_insights where business_id = %s "
                  "order by kind, period_start nulls last", (b["id"],))
        mix = await fetch_all(
            conn, """select language, count(*)::int as n, round(avg(sentiment)::numeric, 2)::float as sentiment
                     from customer_interactions where business_id = %s group by language order by n desc""",
            (b["id"],))
    return {"themes": themes, "recent": recent, "insights": insights, "language_mix": mix}


@api.get("/businesses/{slug}/ledger")
async def get_ledger(slug: str, campaign_id: str | None = None, before_id: int | None = None,
                     limit: int = 50) -> list[dict[str, Any]]:
    async with connection() as conn:
        b = await services.get_business(conn, slug)
        return await fetch_all(
            conn,
            """select * from ledger_events where business_id = %s
               and (%s::uuid is null or campaign_id = %s::uuid) and (%s::bigint is null or id < %s)
               order by id desc limit %s""",
            (b["id"], campaign_id, campaign_id, before_id, before_id, min(limit, 200)))


@api.get("/businesses/{slug}/events")
async def stream(slug: str, request: Request) -> EventSourceResponse:
    """Live ledger feed (Server-Sent Events) for the activity panel."""
    async with connection() as conn:
        b = await services.get_business(conn, slug)
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
async def system_status(request: Request) -> dict[str, Any]:
    from app.config import get_settings

    s = get_settings()
    return {**get_router(request).status(), "storage": s.storage_backend}


# ------------------------------------------------------------------ campaigns


class NewCampaign(BaseModel):
    brief: str = Field(min_length=3, description="The owner's own words, typed or spoken.")
    name: str | None = None
    run_agent: bool = True


@api.post("/businesses/{slug}/campaigns")
async def create_campaign(slug: str, body: NewCampaign, request: Request, bg: BackgroundTasks) -> dict[str, Any]:
    async with connection() as conn:
        b = await services.get_business(conn, slug)
        c = await services.create_campaign(conn, b["id"], name=body.name or _name_from(body.brief), brief=body.brief)
    if body.run_agent:
        bg.add_task(runtime.run, tool_context(request, b, str(c["id"])), f"New brief from the owner: {body.brief}")
    return c


@api.get("/campaigns/{campaign_id}")
async def get_campaign(campaign_id: str) -> dict[str, Any]:
    async with connection() as conn:
        c = await services.get_campaign(conn, campaign_id)
        facts = await fetch_all(conn, "select * from offer_facts where campaign_id = %s order by version desc",
                                (campaign_id,))
        assets = await fetch_all(
            conn,
            """select a.*, to_jsonb(r) - 'asset_id' as revision,
                      (select json_agg(json_build_object('code', t.code, 'kind', t.kind))
                       from touchpoints t where t.asset_id = a.id) as touchpoints,
                      (select json_object_agg(type, n) from (
                         select type, sum(qty)::int as n from outcome_events o where o.asset_id = a.id group by type) x
                      ) as outcomes
               from assets a left join asset_revisions r on r.asset_id = a.id and r.n = a.current_revision
               where a.campaign_id = %s order by a.created_at""",
            (campaign_id,))
        exps = [await services.experiment_status(conn, e["id"]) for e in await fetch_all(
            conn, "select id from experiments where campaign_id = %s order by created_at", (campaign_id,))]
        inbox = await fetch_all(conn, """select * from inbox_items where campaign_id = %s and status = 'pending'
                                         order by priority, created_at desc""", (campaign_id,))
    storage = get_storage()
    for a in assets:
        rev = a.get("revision") or {}
        a["image_url"] = storage.url(rev["image_key"]) if rev.get("image_key") else None
    return {"campaign": c, "facts": facts, "assets": assets, "experiments": exps, "inbox": inbox}


class AgentMessage(BaseModel):
    message: str = Field(min_length=1)


@api.post("/campaigns/{campaign_id}/agent")
async def talk_to_agent(campaign_id: str, body: AgentMessage, request: Request,
                        bg: BackgroundTasks) -> dict[str, str]:
    """Voice or typed instruction ("make it Sunday only"). The agent decides what to do with it."""
    async with connection() as conn:
        c = await services.get_campaign(conn, campaign_id)
        b = await services.get_business_by_id(conn, c["business_id"])
        await ledger.record(conn, b["id"], "owner.said", body.message, actor="owner", campaign_id=campaign_id)
    bg.add_task(runtime.run, tool_context(request, b, campaign_id), f"The owner says: {body.message}")
    return {"status": "accepted"}


@api.put("/campaigns/{campaign_id}/facts/draft")
async def edit_draft_facts(campaign_id: str, body: DraftFactsArgs, request: Request) -> dict[str, Any]:
    async with connection() as conn:
        c = await services.get_campaign(conn, campaign_id)
        row = await services.save_draft_facts(conn, c, facts=[f.model_dump() for f in body.facts],
                                              forbidden_claims=body.forbidden_claims, reason=body.reason,
                                              actor="owner")
    row["wording_check"] = await services.check_fact_wording(get_router(request), connection, campaign_id)
    return row


@api.post("/campaigns/{campaign_id}/facts/lock")
async def lock_facts(campaign_id: str, request: Request, bg: BackgroundTasks, resume: bool = True) -> dict[str, Any]:
    await services.check_fact_wording(get_router(request), connection, campaign_id)  # no-op if already checked
    async with connection() as conn:
        c = await services.get_campaign(conn, campaign_id)
        b = await services.get_business_by_id(conn, c["business_id"])
        res = await services.lock_facts(conn, c, actor="owner")
        # a direct owner lock settles any pending agent request to lock
        await conn.execute(
            """update inbox_items set status = 'approved', decided_at = now(), decision = '{"via": "direct"}'
               where campaign_id = %s and status = 'pending' and payload->>'tool' = 'lock_facts'""", (campaign_id,))
    if resume:
        bg.add_task(runtime.run, tool_context(request, b, campaign_id),
                    f"The owner locked offer facts v{res['facts']['version']}. Carry on with the campaign.")
    return res


class PublishBody(BaseModel):
    asset_ids: list[str] = Field(min_length=1)


@api.post("/campaigns/{campaign_id}/publish")
async def publish(campaign_id: str, body: PublishBody, request: Request) -> dict[str, Any]:
    async with connection() as conn:
        c = await services.get_campaign(conn, campaign_id)
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
async def edit_asset(asset_id: str, body: AssetEdit, request: Request, bg: BackgroundTasks) -> dict[str, Any]:
    """Owner edit: the deterministic guard runs immediately, the meaning check runs in the background."""
    router = get_router(request)
    async with connection() as conn:
        asset = await services.get_asset(conn, asset_id)
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
async def approve_asset(asset_id: str) -> dict[str, Any]:
    async with connection() as conn:
        return await services.approve_asset(conn, asset_id, actor="owner")


@api.post("/assets/{asset_id}/reject")
async def reject_asset(asset_id: str) -> dict[str, Any]:
    async with connection() as conn:
        a = await services.get_asset(conn, asset_id)
        row = await fetch_one(conn, "update assets set status = 'rejected', updated_at = now() where id = %s "
                                    "returning *", (asset_id,))
        c = await services.get_campaign(conn, a["campaign_id"])
        await ledger.record(conn, c["business_id"], "asset.rejected",
                            f"Rejected the {services.asset_label(a)}", actor="owner", campaign_id=c["id"])
    return row  # type: ignore[return-value]


@api.get("/experiments/{experiment_id}")
async def experiment(experiment_id: str) -> dict[str, Any]:
    async with connection() as conn:
        return await services.experiment_status(conn, experiment_id)


# ------------------------------------------------------------------ inbox & counter


class Decision(BaseModel):
    approve: bool
    note: str | None = None
    resume: bool = Field(True, description="Let the agent carry on with the campaign after the decision.")


@api.post("/inbox/{item_id}/decision")
async def decide(item_id: str, body: Decision, request: Request, bg: BackgroundTasks) -> dict[str, Any]:
    async with connection() as conn:
        item = await fetch_one(conn, "select business_id, campaign_id, title from inbox_items where id = %s",
                               (item_id,))
        if not item:
            raise services.NotFound("inbox item not found")
        b = await services.get_business_by_id(conn, item["business_id"])
    res = await runtime.decide_inbox(tool_context(request, b, None, actor="owner"), item_id,
                                     approve=body.approve, note=body.note)
    if body.resume and item["campaign_id"]:  # an employee carries on once the owner has decided
        verdict = "approved" if body.approve else "declined"
        bg.add_task(runtime.run, tool_context(request, b, str(item["campaign_id"])),
                    f"The owner {verdict}: {item['title']}" + (f" Note: {body.note}" if body.note else "")
                    + ". Carry on with the campaign.")
    return res


class CounterRedeem(BaseModel):
    code: str = Field(min_length=4, max_length=12)


@api.post("/counter/redeem")
async def counter_redeem(body: CounterRedeem) -> dict[str, Any]:
    """Staff tap at the counter when a customer shows a code."""
    async with connection() as conn:
        tp = await services.record_outcome(conn, body.code.strip(), "redeem", source="counter")
    return {"ok": True, "code": tp["code"], "asset_id": tp["asset_id"]}


def _name_from(brief: str) -> str:
    words = brief.strip().split()
    return " ".join(words[:6]) + ("…" if len(words) > 6 else "")


# ------------------------------------------------------------------ business-level agent & demo controls


@api.post("/businesses/{slug}/agent")
async def business_agent(slug: str, body: AgentMessage, request: Request, bg: BackgroundTasks) -> dict[str, str]:
    """Run the agent without a campaign in focus (e.g. a daily check-in or a new idea)."""
    async with connection() as conn:
        b = await services.get_business(conn, slug)
    bg.add_task(runtime.run, tool_context(request, b, None), body.message)
    return {"status": "accepted"}


@api.post("/businesses/{slug}/demo/new-reviews")
async def demo_new_reviews(slug: str, request: Request, bg: BackgroundTasks) -> dict[str, Any]:
    """Demo control: ingest the labelled synthetic review batch, then let the agent react on its own."""
    from scripts.seed import SEED, insert_interactions

    async with connection() as conn:
        b = await services.get_business(conn, slug)
        n = await insert_interactions(conn, b["id"], json.loads(SEED.read_text())["demo_new_reviews"])
        await ledger.record(conn, b["id"], "customers.ingested", f"{n} new reviews arrived (synthetic demo batch)",
                            actor="system", payload={"synthetic": True})
    bg.add_task(runtime.run, tool_context(request, b, None), "New customer reviews arrived. Check the findings.")
    return {"ingested": n}
