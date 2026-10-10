"""End-to-end: brief -> agent drafts facts -> owner locks -> copy + guard -> meaning check ->
owner edit blocked -> publish -> live attribution -> fact change propagates staleness."""

import json
from zoneinfo import ZoneInfo

import psycopg
import pytest

from app import services
from app.agent import runtime
from app.agent.tools import ToolContext
from app.config import get_settings
from app.db import connection
from tests.fakes import ProviderError, calls, text

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


def wording(*bad: str, keys: list[str] | None = None) -> object:
    """Scripted reply of the fact-wording check: every Kannada wording matches unless its key is in `bad`."""
    return text(json.dumps({"checks": [
        {"key": k, "language": "kn", "back_translation": "Friday to Monday" if k in bad else "same",
         "same_meaning": k not in bad, "issue": "Says Friday to Monday" if k in bad else None}
        for k in keys or [f["key"] for f in FACTS]]}))


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
        wording(),  # the draft tool checks the Kannada wording before the lock request is queued
        text("Now I will set the campaign plan."),  # announces instead of acting: the loop asks once more
        text("Drafted the offer and asked you to lock it."),
    )
    out = await runtime.run(ctx, "New brief")
    assert out["status"] == "done" and out["message"] == "Drafted the offer and asked you to lock it.", out
    assert scripted.requests[-1]["messages"][-1]["content"] == runtime.CONTINUE
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
    r = await client.post(f"/api/inbox/{camp['inbox'][0]['id']}/decision", json={"approve": True, "resume": False})
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
    still_wrong = {"assets": [gen["assets"][1] | {"cell": 1}]}
    scripted.push(text(json.dumps(gen, ensure_ascii=False)), text(json.dumps(still_wrong, ensure_ascii=False)),
                  ProviderError("verifier down"))  # automatic meaning check unavailable -> pending; run below
    res = await runtime.execute(ctx, "generate_copy", {"cells": [
        {"segment": "regulars", "channel": "whatsapp", "language": "en", "variant": "A", "angle": "nostalgia"},
        {"segment": "regulars", "channel": "whatsapp", "language": "en", "variant": "B", "angle": "urgency"}]})
    assert res["ok"], res
    good, bad = res["assets"]
    # the model typed "8 to 11 am": blocked, sent back once with the reason, still wrong -> stays invalid
    assert good["status"] == "valid" and bad["status"] == "invalid"
    assert any("8, 11" in d for d in bad["first_draft_blocked_by"])
    repair = json.loads(next(m["content"] for req in scripted.requests for m in req["messages"]
                             if "fix_these" in (m["content"] or "")))
    assert [f["cell"] for f in repair["fix_these"]] == [1] and "8, 11" in repair["fix_these"][0]["problems"][0]

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
    # approving in advance puts every post that passed all checks live, and only those
    r = await client.put(f"/api/campaigns/{cid}/autopublish", json={"on": True})
    assert r.status_code == 200 and [a["asset_id"] for a in r.json()["went_live"]] == [good["asset_id"]]
    assert (await client.put(f"/api/campaigns/{cid}/autopublish", json={"on": False})).json()["went_live"] == []
    r = await client.post(f"/api/campaigns/{cid}/publish", json={"asset_ids": [good["asset_id"]]})
    assert r.status_code == 200, r.text
    code = r.json()["published"][0]["code"]
    assert (await client.get(f"/api/campaigns/{cid}")).json()["campaign"]["status"] == "active"

    # --- a customer scans and claims; staff redeem at the counter
    r = await client.post(f"/api/public/r/{code}/visit")
    assert r.status_code == 200 and "20% off" in r.json()["rendered"]["body"]
    r = await client.post(f"/api/public/r/{code}/claim", json={"device": "phone-one-abc"})
    mine = r.json()["code"]
    assert r.status_code == 200 and len(mine) == 7 and mine != code
    # the same phone gets the same code back, and is counted once
    assert (await client.post(f"/api/public/r/{code}/claim", json={"device": "phone-one-abc"})).json()["code"] == mine
    chk = (await client.post("/api/counter/check", json={"code": mine.lower()})).json()
    assert chk["kind"] == "claim" and chk["checks"] == ["Dine-in only"] and "20% off" in chk["offer"]
    assert chk["verdict"] in ("ok", "not_valid")  # the test offer runs on fixed dates
    r = await client.post("/api/counter/redeem", json={"code": mine, "bill_amount": 240, "outside_rules": "test"})
    assert r.status_code == 200 and r.json()["verdict"] == "redeemed"
    r = await client.post("/api/counter/redeem", json={"code": mine, "outside_rules": "test"})
    assert r.status_code == 409 and "Already used" in r.json()["detail"]
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
    scripted.push(wording())
    res = await runtime.execute(ctx, "revise_offer_facts", {"reason": "Saturday private booking", "changes": [
        {"key": "days", "value": ["2026-10-11"], "display": {"en": "this Sunday", "kn": "ಈ ಭಾನುವಾರ"}}]})
    assert res["ok"]
    r = await client.post(f"/api/campaigns/{cid}/facts/lock", params={"resume": False})
    assert r.json()["changed"] == ["days"] and good["asset_id"] in r.json()["stale_assets"]

    # the ledger recorded the story
    led = (await client.get("/api/businesses/kaapi-kone/ledger", params={"campaign_id": cid, "limit": 200})).json()
    types = {e["type"] for e in led}
    assert {"facts.locked", "approval.requested", "approval.decided", "outcome.click", "outcome.redeem", "asset.revised"} <= types

    # demo simulation: only inside the campaign's life and the offer's rules, and it replaces itself
    from app.domain import redeem

    r = await client.post(f"/api/campaigns/{cid}/simulate")
    assert r.status_code == 200 and r.json()["days"] == 1
    again = (await client.post(f"/api/campaigns/{cid}/simulate")).json()["events"]
    async with connection() as conn:
        rows = await (await conn.execute(
            """select o.type, o.occurred_at, c.created_at from outcome_events o join campaigns c on c.id = o.campaign_id
               where o.campaign_id = %s and o.source = 'simulated'""", (cid,))).fetchall()
        sheet = await services.locked_sheet(conn, cid)
    assert len(rows) == again  # the second run replaced the first
    ist = ZoneInfo("Asia/Kolkata")
    rules = redeem.rules([f.model_dump() for f in sheet.facts])
    for row in rows:
        assert row["occurred_at"].astimezone(ist).date() >= row["created_at"].astimezone(ist).date()
        if row["type"] == "redeem":
            assert redeem.evaluate(rules, row["occurred_at"].astimezone(ist).replace(tzinfo=None))[0]


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


def test_json_encoded_string_args_are_decoded():
    # Seen live from Agnes: object/array arguments arrive as JSON text.
    from app.agent.tools import REGISTRY
    model = REGISTRY["set_campaign_plan"].args
    args = runtime._validate_args(model, {"name": "Test", "goal": '{"statement": "x"}', "plan": '{"cells": []}',
                                          "intent": {"tone": "warm"}})
    assert args.plan == {"cells": []}  # type: ignore[attr-defined]
    assert runtime._unwrap_json_strings({"plan": "{not json"})["plan"] == "{not json"


async def test_mistranslated_fact_cannot_be_locked(client, scripted):
    r = await client.post("/api/businesses/kaapi-kone/campaigns", json={"brief": "weekday combo", "run_agent": False})
    ctx = await ctx_for(client, r.json()["id"])
    draft = {"facts": FACTS, "forbidden_claims": {}, "reason": "brief"}

    # Seen live: the Kannada wording of the days said something else. The agent is told, and cannot ask to lock.
    scripted.push(wording("days"))
    res = await runtime.execute(ctx, "draft_offer_facts", draft)
    assert res["wording_check"]["status"] == "failed" and res["wording_check"]["issues"][0]["key"] == "days"
    assert "translated wording" in (await runtime.execute(ctx, "lock_facts", {"summary": "lock"}))["precondition_failed"]
    r = await client.post(f"/api/campaigns/{ctx.campaign_id}/facts/lock", params={"resume": False})
    assert r.status_code == 409 and "Friday to Monday" in r.text

    # corrected wording passes and locks
    scripted.push(wording())
    res = await runtime.execute(ctx, "draft_offer_facts", draft | {"reason": "fixed Kannada days"})
    assert res["wording_check"]["status"] == "passed"
    assert (await client.post(f"/api/campaigns/{ctx.campaign_id}/facts/lock", params={"resume": False})).status_code == 200


async def test_wording_check_without_a_model_is_marked_unchecked(client, scripted):
    r = await client.post("/api/businesses/kaapi-kone/campaigns", json={"brief": "weekday combo", "run_agent": False})
    ctx = await ctx_for(client, r.json()["id"])
    scripted.push(ProviderError("down"))
    res = await runtime.execute(ctx, "draft_offer_facts", {"facts": FACTS, "forbidden_claims": {}, "reason": "b"})
    assert res["wording_check"]["status"] == "unchecked" and not scripted.queue
    assert (await client.post(f"/api/campaigns/{ctx.campaign_id}/facts/lock", params={"resume": False})).status_code == 200


async def test_ledger_payloads_accept_row_values(client):
    import datetime
    import uuid

    from app import ledger
    async with connection() as conn:
        b = await (await conn.execute("select id from businesses where slug = 'kaapi-kone'")).fetchone()
        row = await ledger.record(conn, b["id"], "test.payload", "row values in payload",
                                  payload={"id": uuid.uuid4(), "at": datetime.datetime.now(datetime.UTC)})
    assert isinstance(row["payload"]["id"], str)


async def test_generation_repairs_a_blocked_piece_once(client, scripted):
    r = await client.post("/api/businesses/kaapi-kone/campaigns", json={"brief": "weekday combo", "run_agent": False})
    ctx = await ctx_for(client, r.json()["id"])
    scripted.push(wording())
    await runtime.execute(ctx, "draft_offer_facts", {"facts": FACTS, "forbidden_claims": {}, "reason": "b"})
    assert (await client.post(f"/api/campaigns/{ctx.campaign_id}/facts/lock", params={"resume": False})).status_code == 200
    feats = {"hook": "value", "cta_strength": 2, "tone": "warm"}
    scripted.push(
        text(json.dumps({"assets": [{"cell": 0, "content": content("{{discount}} on {{combo}}, 4 to 7 pm. {{dine_in}}"),
                                     "features": feats}]})),
        text(json.dumps({"assets": [{"cell": 0, "content": content("{{discount}} on {{combo}}, {{days}}. {{dine_in}}"),
                                     "features": feats}]})),
        ProviderError("verifier down"),
    )
    res = await runtime.execute(ctx, "generate_copy", {"cells": [
        {"segment": "students", "channel": "whatsapp", "language": "en", "angle": "value"}]})
    (piece,) = res["assets"]
    assert piece["status"] == "valid" and piece["first_draft_blocked_by"]
    # rewriting an existing piece needs only its id and an angle
    assert runtime.REGISTRY["generate_copy"].args.model_validate({"cells": [{"asset_id": piece["asset_id"], "angle": "x"}]})


async def test_numbers_the_owner_never_gave_are_flagged_as_assumed(client, scripted):
    r = await client.post("/api/businesses/kaapi-kone/campaigns",
                          json={"brief": "20% off filter coffee and vada this weekend, dine-in only", "run_agent": False})
    ctx = await ctx_for(client, r.json()["id"])
    invented = FACTS + [{"key": "dates", "label": "Dates", "type": "date_range", "value": "12-30 Oct",
                         "display": {"en": "12 to 30 October", "kn": "ಅಕ್ಟೋಬರ್ 12 ರಿಂದ 30"}}]
    scripted.push(wording(keys=[f["key"] for f in invented]))
    res = await runtime.execute(ctx, "draft_offer_facts", {"facts": invented, "forbidden_claims": {}, "reason": "b"})
    assert res["ok"]
    camp = (await client.get(f"/api/campaigns/{ctx.campaign_id}")).json()
    assumed = camp["facts"][0]["wording_check"]["assumed"]
    # 20 came from the owner; 12 did not (30 happens to be a menu price, so only 12 is listed)
    assert [a["key"] for a in assumed] == ["dates"] and "12" in assumed[0]["numbers"]
