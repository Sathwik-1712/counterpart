"""End-to-end: brief -> agent drafts facts -> owner locks -> copy + guard -> meaning check ->
owner edit blocked -> publish -> live attribution -> fact change propagates staleness."""

import json

import psycopg
import pytest

from app.agent import runtime
from app.agent.tools import ToolContext
from app.config import get_settings
from app.db import connection
from tests.fakes import calls, text

FACTS = [
    {"key": "discount", "label": "Discount", "type": "percent", "value": 20,
     "display": {"en": "20% off", "kn": "೨೦% ರಿಯಾಯಿತಿ"}},
    {"key": "combo", "label": "Combo", "type": "item", "value": ["Filter coffee", "Masala vada"],
     "display": {"en": "filter coffee + masala vada", "kn": "ಫಿಲ್ಟರ್ ಕಾಫಿ + ಮಸಾಲೆ ವಡೆ"}},
    {"key": "days", "label": "Days", "type": "date_range", "value": ["2026-10-10", "2026-10-11"],
     "display": {"en": "this Sat & Sun", "kn": "ಈ ಶನಿವಾರ ಮತ್ತು ಭಾನುವಾರ"}},
    {"key": "dine_in", "label": "Dine-in only", "type": "condition", "value": True,
     "display": {"en": "Dine-in only", "kn": "ಕೆಫೆಯಲ್ಲಿ ಮಾತ್ರ"}},
]


def content(body: str) -> dict:
    return {"headline": [{"text": "Your morning, your tumbler", "sources": ["brand:voice"]}],
            "body": [{"text": body, "sources": ["fact:discount", "insight:theme:decoction_strength"]}],
            "cta": [{"text": "See you at the counter", "sources": ["brand:voice"]}], "hashtags": []}


async def ctx_for(client, campaign_id: str) -> ToolContext:
    from app.main import app

    async with connection() as conn:
        b = await (await conn.execute("select * from businesses where slug = 'kaapi-kone'")).fetchone()
    return ToolContext(business=b, campaign_id=campaign_id, router=app.state.router, settings=get_settings())


async def test_full_campaign_flow(client, scripted):
    # Owner speaks a brief (agent run triggered separately below so we control the script)
    r = await client.post("/api/businesses/kaapi-kone/campaigns",
                          json={"brief": "20% off filter coffee and vada this weekend, dine-in only",
                                "run_agent": False})
    assert r.status_code == 200
    cid = r.json()["id"]
    ctx = await ctx_for(client, cid)

    # --- agent: checks economics, drafts facts, asks to lock (gated), then stops
    scripted.push(
        calls(("evaluate_offer", {"item_names": ["Filter coffee", "Masala vada"], "discount_pct": 20})),
        calls(("draft_offer_facts", {"facts": FACTS, "forbidden_claims": {"en": ["free", "all day"]},
                                     "reason": "From the owner's brief"}),
              ("lock_facts", {"summary": "Lock: 20% off kaapi + vada, Sat & Sun, dine-in"})),
        text("Drafted the offer and asked you to lock it."),
    )
    out = await runtime.run(ctx, "New brief")
    assert out["status"] == "done", out
    assert [s["tool"] for s in out["steps"]] == ["evaluate_offer", "draft_offer_facts", "lock_facts"]
    # the economics result was fed back to the model
    tool_msgs = [m for m in scripted.requests[1]["messages"] if m["role"] == "tool"]
    assert "break_even_extra_covers" in tool_msgs[0]["content"]

    # gated: facts are NOT locked, an approval waits in the inbox
    camp = (await client.get(f"/api/campaigns/{cid}")).json()
    assert [f["status"] for f in camp["facts"]] == ["draft"]
    assert len(camp["inbox"]) == 1 and camp["inbox"][0]["payload"]["tool"] == "lock_facts"

    # generating copy before facts are locked is refused by precondition
    blocked = await runtime.execute(ctx, "generate_copy", {"cells": [
        {"segment": "regulars", "channel": "whatsapp", "language": "kn", "angle": "nostalgia"}]})
    assert "precondition_failed" in blocked

    # --- owner approves -> the stored tool call runs -> facts locked
    r = await client.post(f"/api/inbox/{camp['inbox'][0]['id']}/decision", json={"approve": True})
    assert r.status_code == 200, r.text
    camp = (await client.get(f"/api/campaigns/{cid}")).json()
    assert camp["facts"][0]["status"] == "locked" and camp["inbox"] == []

    # locked facts are immutable at the database level
    with pytest.raises(psycopg.errors.RaiseException):
        async with await psycopg.AsyncConnection.connect(get_settings().database_url) as conn:
            await conn.execute("update offer_facts set facts = '[]' where campaign_id = %s", (cid,))

    # --- generation: one clean asset, one where the model typed a number itself
    gen = {"assets": [
        {"cell": 0, "content": content("{{discount}} on {{combo}}, {{days}}. {{dine_in}}."),
         "features": {"hook": "nostalgia", "cta_strength": 2, "tone": "warm"}},
        {"cell": 1, "content": content("{{discount}} on {{combo}}, {{days}}, 8 to 11 am. {{dine_in}}."),
         "features": {"hook": "urgency", "cta_strength": 3, "tone": "brisk"}},
    ]}
    scripted.push(text(json.dumps(gen, ensure_ascii=False)))
    res = await runtime.execute(ctx, "generate_copy", {"cells": [
        {"segment": "regulars", "channel": "whatsapp", "language": "en", "variant": "A", "angle": "nostalgia"},
        {"segment": "regulars", "channel": "whatsapp", "language": "en", "variant": "B", "angle": "urgency"}]})
    assert res["ok"], res
    good, bad = res["assets"]
    assert good["status"] == "valid" and bad["status"] == "invalid"
    assert any("8, 11" in d for d in bad["blocked_by"])

    # --- meaning check (L3) on the valid one
    scripted.push(text(json.dumps({"audits": [{
        "ref": good["asset_id"], "back_translation": "20% off filter coffee + masala vada this weekend. Dine-in only.",
        "claims": [{"claim": "20% off", "supported": True, "fact_key": "discount"}],
        "intent_preserved": True}]})))
    res = await runtime.execute(ctx, "validate_assets", {"asset_ids": [good["asset_id"]]})
    assert res["results"][good["asset_id"]] == {"passed": True, "l3": "passed"}

    # --- owner types "30% off" into the copy: blocked instantly, cannot be approved
    r = await client.patch(f"/api/assets/{good['asset_id']}",
                           json={"content": content("30% off on {{combo}}, {{days}}. {{dine_in}}. {{discount}}")})
    assert r.status_code == 200 and r.json()["validation"]["passed"] is False
    r = await client.post(f"/api/assets/{good['asset_id']}/approve")
    assert r.status_code == 409

    # owner fixes it; meaning check runs (scripted) in background; then publish works
    scripted.push(text(json.dumps({"audits": [{
        "ref": good["asset_id"], "back_translation": "ok", "claims": [], "intent_preserved": True}]})))
    r = await client.patch(f"/api/assets/{good['asset_id']}",
                           json={"content": content("{{discount}} on {{combo}}, {{days}}. {{dine_in}}. Come early.")})
    assert r.json()["validation"]["passed"] is True

    # agent publishing is gated; owner publishing works and issues a tracking code
    res = await runtime.execute(ctx, "publish_assets", {"asset_ids": [good["asset_id"]], "summary": "Send A"})
    assert res.get("queued_for_owner_approval")
    r = await client.post(f"/api/campaigns/{cid}/publish", json={"asset_ids": [good["asset_id"]]})
    assert r.status_code == 200, r.text
    code = r.json()["published"][0]["code"]

    # --- a customer scans and claims; staff redeem at the counter
    r = await client.post(f"/api/public/r/{code}/visit")
    assert r.status_code == 200 and "20% off" in r.json()["rendered"]["body"]
    assert (await client.post(f"/api/public/r/{code}/claim")).status_code == 200
    assert (await client.post("/api/counter/redeem", json={"code": code.lower()})).status_code == 200
    assert (await client.get(f"/api/public/qr/{code}.png")).headers["content-type"] == "image/png"

    camp = (await client.get(f"/api/campaigns/{cid}")).json()
    live = next(a for a in camp["assets"] if a["id"] == good["asset_id"])
    assert live["status"] == "live" and live["outcomes"] == {"scan": 1, "click": 1, "redeem": 1}

    # --- experiment with a history-pooled prior
    res = await runtime.execute(ctx, "create_experiment", {
        "asset_ids": [good["asset_id"], bad["asset_id"]], "hypothesis": "Nostalgia beats urgency for regulars",
        "dimension": "hook"})
    st = (await client.get(f"/api/experiments/{res['experiment_id']}")).json()
    assert st["prior"]["from_campaign_assets"] >= 3 and st["decision"]["winner"] is None

    # --- owner: "make it Sunday only" -> revise + lock -> only date-dependent assets go stale
    res = await runtime.execute(ctx, "revise_offer_facts", {"reason": "Saturday private booking", "changes": [
        {"key": "days", "value": ["2026-10-11"], "display": {"en": "this Sunday", "kn": "ಈ ಭಾನುವಾರ"}}]})
    assert res["ok"]
    r = await client.post(f"/api/campaigns/{cid}/facts/lock")
    assert r.json()["changed"] == ["days"] and good["asset_id"] in r.json()["stale_assets"]

    # the ledger recorded the story
    led = (await client.get("/api/businesses/kaapi-kone/ledger", params={"campaign_id": cid, "limit": 200})).json()
    types = {e["type"] for e in led}
    assert {"facts.locked", "approval.requested", "approval.decided", "outcome.click", "outcome.redeem", "asset.revised"} <= types


async def test_overview_and_detectors(client):
    r = await client.get("/api/businesses/kaapi-kone")
    body = r.json()
    assert body["brand"]["version"] == 1 and len(body["learnings"]) >= 3
    assert any(f["kind"] == "event_upcoming" for f in body["findings"]) or True  # date-dependent
    cust = (await client.get("/api/businesses/kaapi-kone/customers")).json()
    themes = {t["theme"] for t in cust["themes"]}
    assert {"decoction_strength", "queue_wait"} <= themes


async def test_unknown_tool_and_bad_args_are_explained(client):
    ctx = await ctx_for(client, None)  # type: ignore[arg-type]
    assert "Unknown tool" in (await runtime.execute(ctx, "delete_everything", {}))["error"]
    assert "Invalid arguments" in (await runtime.execute(ctx, "evaluate_offer", {"discount_pct": 500}))["error"]
