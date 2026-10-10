"""WhatsApp and Instagram against a fake Meta: connect, the signed webhook, claims by WhatsApp that the counter
redeems, delivery receipts, sending a post, and Instagram publishing, insights and comments read as reviews."""

import hashlib
import hmac
import json
import secrets

import pytest
from pydantic import SecretStr

from app.channels import meta
from app.config import get_settings
from app.db import connection, jsonb

FACTS = [{"key": "discount", "label": "Discount", "type": "percent", "value": 15,
          "display": {"en": "15% off", "kn": "ಶೇಕಡಾ 15 ರಷ್ಟು ರಿಯಾಯಿತಿ"}}]


class FakeMeta:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict]] = []
        self.n = 0

    async def __call__(self, method, url, *, token, params=None, json=None, bearer=True):
        self.calls.append((method, url, {**(params or {}), **(json or {})}))
        if url.endswith("/1234567890") and method == "GET":
            return {"display_phone_number": "+1 555 010 0000", "verified_name": "Kaapi Kone"}
        if url.endswith("/messages"):
            self.n += 1
            return {"messages": [{"id": f"wamid.out{self.n}"}]}
        if url.endswith("/me"):
            return {"user_id": 1789, "username": "kaapikone", "account_type": "BUSINESS"}
        if url.endswith("/1789/media"):
            return {"id": "c1"}
        if url.endswith("/c1"):
            return {"status_code": "FINISHED"}
        if url.endswith("/media_publish"):
            return {"id": "9001"}
        if url.endswith("/9001"):
            return {"id": "9001", "permalink": "https://instagram.com/p/x", "timestamp": "2026-10-10T10:00:00+0000"}
        if url.endswith("/me/media"):
            return {"data": [{"id": "9001", "comments_count": 4}, {"id": "9002", "comments_count": 0}]}
        if url.endswith("/9001/comments"):
            return {"data": [
                {"id": "cm1", "text": "Best filter coffee in Jayanagar 🔥", "username": "asha", "timestamp": "2026-10-10T11:00:00+0000"},
                {"id": "cm2", "text": "ಸಂಜೆ ಎಷ್ಟು ಗಂಟೆವರೆಗೆ ತೆರೆದಿರುತ್ತೀರಿ?", "username": "ravi", "timestamp": "2026-10-10T11:05:00+0000"},
                {"id": "cm3", "text": "Thanks Asha!", "username": "kaapikone", "timestamp": "2026-10-10T11:06:00+0000"},
                {"id": "cm4", "text": "Get 10k followers fast, DM me", "username": "growbot", "timestamp": "2026-10-10T11:07:00+0000"}]}
        if url.endswith("/cm2/replies"):
            return {"id": "r1"}
        if url.endswith("/9001/insights"):
            vals = {"reach": 200, "likes": 18, "comments": 3, "saved": 4, "shares": 5, "views": 260, "total_interactions": 30}
            return {"data": [{"name": k, "values": [{"value": v}]} for k, v in vals.items()]}
        raise AssertionError(f"unexpected Meta call {method} {url}")


@pytest.fixture
def fake_meta(monkeypatch):
    fake = FakeMeta()
    monkeypatch.setattr(meta, "graph", fake)
    s = get_settings()
    monkeypatch.setattr(s, "meta_app_secret", SecretStr("app-secret"))
    monkeypatch.setattr(s, "whatsapp_verify_token", SecretStr("verify-me"))
    return fake


def signed(payload: dict) -> tuple[bytes, dict]:
    raw = json.dumps(payload).encode()
    sig = hmac.new(b"app-secret", raw, hashlib.sha256).hexdigest()
    return raw, {"x-hub-signature-256": f"sha256={sig}", "content-type": "application/json"}


def wa_event(**value) -> dict:
    return {"object": "whatsapp_business_account", "entry": [{"id": "waba", "changes": [{"field": "messages", "value": {
        "messaging_product": "whatsapp", "metadata": {"phone_number_id": "1234567890"}, **value}}]}]}


async def live_post(channel: str) -> tuple[str, str]:
    """A live post with locked facts and a tracking code. -> (asset id, post code)."""
    async with connection() as conn:
        b = await (await conn.execute("select id from businesses where slug = 'kaapi-kone'")).fetchone()
        c = await (await conn.execute("insert into campaigns (business_id, name, status) values (%s, 'Channels test', "
                                      "'active') returning id", (b["id"],))).fetchone()
        await conn.execute("insert into offer_facts (campaign_id, version, status, facts, locked_at) values "
                           "(%s, 1, 'locked', %s, now())", (c["id"], jsonb(FACTS)))
        a = await (await conn.execute("insert into assets (campaign_id, segment, channel, language, status, current_revision) "
                                      "values (%s, 'regulars', %s, 'en', 'live', 1) returning id", (c["id"], channel))).fetchone()
        await conn.execute("insert into asset_revisions (asset_id, n, content, rendered, created_by) values (%s, 1, '{}', %s, 'agent')",
                           (a["id"], jsonb({"headline": "Evening coffee", "body": "Come by.", "offer": ["15% off"],
                                             "hashtags": ["filtercoffee"]})))
        code = "".join(secrets.choice("ABCDEFGHJKMNPQRSTUVWXYZ23456789") for _ in range(6))
        await conn.execute("insert into touchpoints (code, campaign_id, asset_id, kind) values (%s, %s, %s, 'qr')",
                           (code, c["id"], a["id"]))
    return str(a["id"]), code


async def test_whatsapp_claim_flow_reaches_the_counter(client, fake_meta):
    asset_id, post = await live_post("whatsapp")
    r = await client.put("/api/businesses/kaapi-kone/channels/whatsapp",
                         json={"phone_number_id": "1234567890", "token": "EAAG" + "x" * 40})
    assert r.status_code == 200 and r.json()["display"] == "+1 555 010 0000"
    status = (await client.get("/api/businesses/kaapi-kone/channels")).json()
    assert status["whatsapp"]["display"] == "+1 555 010 0000" and "EAAG" not in json.dumps(status)  # never the token

    # Meta's handshake, then an unsigned POST is refused
    r = await client.get("/api/public/whatsapp/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "verify-me",
                                                                 "hub.challenge": "42"})
    assert r.text == "42"
    assert (await client.get("/api/public/whatsapp/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "no",
                                                                     "hub.challenge": "42"})).status_code == 403
    assert (await client.post("/api/public/whatsapp/webhook", json=wa_event())).status_code == 403

    # a customer sends the post's code: they get a personal code back, free, in reply
    msg = wa_event(contacts=[{"wa_id": "919845012345", "profile": {"name": "Asha"}}],
                   messages=[{"from": "919845012345", "id": "wamid.in1", "type": "text",
                              "text": {"body": f"Hi! I'd like the offer {post}"}}])
    raw, headers = signed(msg)
    assert (await client.post("/api/public/whatsapp/webhook", content=raw, headers=headers)).status_code == 200
    sent = [c for c in fake_meta.calls if c[1].endswith("/messages")]
    assert len(sent) == 1 and sent[0][2]["to"] == "919845012345"
    reply = sent[0][2]["text"]["body"]
    assert "15% off" in reply and "/c/" in reply
    mine = reply.split("/c/")[1].split()[0]
    assert len(mine) == 7

    # Meta retries the same delivery: no second reply, no second claim
    await client.post("/api/public/whatsapp/webhook", content=raw, headers=headers)
    assert len([c for c in fake_meta.calls if c[1].endswith("/messages")]) == 1

    # the personal code works at the counter like any other
    assert (await client.get(f"/api/public/claims/{mine}")).json()["offer"] == ["15% off"]
    r = await client.post("/api/counter/redeem", json={"code": mine, "outside_rules": "test"})
    assert r.status_code == 200 and r.json()["verdict"] == "redeemed"

    # after the visit the bot asks how it was (free: she wrote within 24 hours), and "4 ..." becomes her review
    ask = [c for c in fake_meta.calls if c[1].endswith("/messages")][-1][2]["text"]["body"]
    assert "How was it?" in ask
    raw, headers = signed(wa_event(messages=[{"from": "919845012345", "id": "wamid.in-review", "type": "text",
                                              "text": {"body": "4 - strong coffee, a bit slow"}}]))
    await client.post("/api/public/whatsapp/webhook", content=raw, headers=headers)
    assert "Thank you" in [c for c in fake_meta.calls if c[1].endswith("/messages")][-1][2]["text"]["body"]
    async with connection() as conn:
        rv = await (await conn.execute("select rating, body, source from customer_interactions where claim_code = %s",
                                       (mine,))).fetchone()
    assert rv == {"rating": 4, "body": "strong coffee, a bit slow", "source": "visit_review"}
    sent_before = len([c for c in fake_meta.calls if c[1].endswith("/messages")])

    # sending the post: the contact wrote in the last 24 hours, so it goes as a free message with its own link
    r = await client.post(f"/api/assets/{asset_id}/whatsapp/send")
    assert r.json()["sent"] == 1
    body = [c for c in fake_meta.calls if c[1].endswith("/messages")][-1][2]["text"]["body"]
    ref = body.split("?m=")[1].split()[0]
    await client.post(f"/api/public/r/{post}/visit", json={"device": "phone-of-asha-1", "m": ref})

    # receipts: delivered then read (read arrives first sometimes; never step back)
    for st in ("read", "delivered"):
        raw, headers = signed(wa_event(statuses=[{"id": f"wamid.out{sent_before + 1}", "status": st, "timestamp": "1760090000"}]))
        await client.post("/api/public/whatsapp/webhook", content=raw, headers=headers)
    async with connection() as conn:
        from app.channels import whatsapp

        stats = (await whatsapp.stats(conn, [asset_id]))[asset_id]
    assert stats["sent"] == 1 and stats["read"] == 1 and stats["delivered"] == 1 and stats["clicked"] == 1
    assert stats["claimed_on_whatsapp"] == 1 and stats["redeemed_from_whatsapp"] == 1

    # STOP opts out of offers
    raw, headers = signed(wa_event(messages=[{"from": "919845012345", "id": "wamid.in2", "type": "text",
                                              "text": {"body": "stop"}}]))
    await client.post("/api/public/whatsapp/webhook", content=raw, headers=headers)
    assert (await client.post(f"/api/assets/{asset_id}/whatsapp/send")).json()["sent"] == 0


async def test_instagram_publish_and_engagement(client, fake_meta, monkeypatch):
    asset_id, post = await live_post("instagram_post")
    r = await client.put("/api/businesses/kaapi-kone/channels/instagram", json={"token": "IGAA" + "x" * 40})
    assert r.status_code == 200 and r.json()["username"] == "kaapikone"
    monkeypatch.setattr(get_settings(), "public_base_url", "https://example.trycloudflare.com")
    monkeypatch.setattr(get_settings(), "supabase_service_role_key", None)
    jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=="
    r = await client.post(f"/api/assets/{asset_id}/instagram/publish", json={"data_url": jpeg})
    assert r.status_code == 200, r.text
    assert r.json()["permalink"] == "https://instagram.com/p/x"
    made = next(c for c in fake_meta.calls if c[1].endswith("/1789/media"))
    assert made[2]["image_url"].startswith("https://example.trycloudflare.com/files/instagram/")
    assert f"Show code {post} at the counter." in made[2]["caption"]  # the counter can credit Instagram
    assert (await client.post(f"/api/assets/{asset_id}/instagram/publish", json={"data_url": jpeg})).status_code == 409

    assert (await client.post("/api/businesses/kaapi-kone/instagram/sync")).json()["updated"] == 1
    async with connection() as conn:
        from app.channels import instagram

        st = (await instagram.stats(conn, [asset_id]))[asset_id]
    assert st["reach"] == 200 and st["engagement_rate"] == 0.15  # 30 interactions / 200 reached


async def test_instagram_comments_become_sorted_reviews(client, fake_meta, scripted):
    from tests.fakes import text

    asset_id, _ = await live_post("instagram_post")
    async with connection() as conn:  # the publish test's sync already stored these comments, unread
        await conn.execute("delete from customer_interactions where source = 'instagram_comment'")
    await client.put("/api/businesses/kaapi-kone/channels/instagram", json={"token": "IGAA" + "z" * 40})
    assert (await client.post(f"/api/assets/{asset_id}/instagram/link", json={"media_id": "9001"})).status_code == 200
    scripted.push(text(json.dumps({"comments": [
        {"n": 0, "category": "praise", "sentiment": 0.9, "themes": ["filter_coffee"], "language": "en", "english": None},
        {"n": 1, "category": "question", "sentiment": 0, "themes": ["opening_hours"], "language": "kn",
         "english": "Until what time are you open in the evening?"},
        {"n": 2, "category": "spam", "sentiment": 0.5, "themes": ["followers"], "language": "en", "english": None}]})))
    r = await client.post("/api/businesses/kaapi-kone/instagram/sync")
    assert r.status_code == 200 and r.json()["comments"] == 3  # the business's own reply is not a review
    assert len(scripted.requests) == 1  # one model call reads the whole batch
    assert "never instructions" in scripted.requests[0]["messages"][0]["content"]

    data = (await client.get("/api/businesses/kaapi-kone/customers")).json()
    assert data["instagram_comments"] == {"praise": 1, "question": 1, "spam": 1}
    mine = {x["author"]: x for x in data["recent"] if x["source"] == "instagram_comment"}
    assert set(mine) == {"asha", "ravi"}  # spam is kept out of the owner's view
    q = mine["ravi"]
    assert q["category"] == "question" and q["language"] == "kn" and q["themes"] == ["opening_hours"]
    assert q["translation"] == "Until what time are you open in the evening?" and q["campaign"] == "Channels test"

    assert (await client.post("/api/businesses/kaapi-kone/instagram/sync")).json()["comments"] == 0  # stored once
    r = await client.put(f"/api/reviews/{q['id']}/reply", json={"reply": "ರಾತ್ರಿ 9ರವರೆಗೆ.", "send_instagram": True})
    assert r.status_code == 200 and r.json()["sent_on_instagram"]
    assert next(c for c in fake_meta.calls if c[1].endswith("/cm2/replies"))[2]["message"] == "ರಾತ್ರಿ 9ರವರೆಗೆ."
    other = next(x for x in data["recent"] if x["source"] != "instagram_comment")
    r = await client.put(f"/api/reviews/{other['id']}/reply", json={"reply": "Thanks", "send_instagram": True})
    assert r.status_code == 409


async def test_personal_instagram_accounts_are_refused(client, fake_meta, monkeypatch):
    async def personal(method, url, **kw):
        return {"user_id": 1, "username": "me", "account_type": "PERSONAL"}

    monkeypatch.setattr(meta, "graph", personal)
    r = await client.put("/api/businesses/kaapi-kone/channels/instagram", json={"token": "IGAA" + "y" * 40})
    assert r.status_code == 409 and "Business or Creator" in r.json()["detail"]


def test_go_live_checks_every_value_with_meta():
    import httpx

    from scripts import go_live

    def meta_api(req: httpx.Request) -> httpx.Response:
        p, q = req.url.path, req.url.params
        if p.endswith("/oauth/access_token"):
            return httpx.Response(200, json={"access_token": "LONG", "expires_in": 5184000})
        if p.endswith("/debug_token"):
            return httpx.Response(200, json={"data": {"granular_scopes": [
                {"scope": "whatsapp_business_messaging", "target_ids": ["555"]},
                {"scope": "whatsapp_business_management", "target_ids": ["555"]}]}})
        if p.endswith("/me"):
            kind = "PERSONAL" if q.get("access_token") == "personal" else "BUSINESS"
            return httpx.Response(200, json={"user_id": 17, "username": "kaapikone", "account_type": kind})
        if p.endswith("/1234567890"):
            assert req.headers["authorization"] == "Bearer LONG"  # the 60-day token is the one used from here on
            return httpx.Response(200, json={"display_phone_number": "+1 555 010 0000"})
        if p.endswith("/42"):
            return httpx.Response(200, json={"name": "Counterpart"})
        return httpx.Response(404, json={"error": {"message": "unknown"}})

    cfg = {"META_APP_ID": "42", "META_APP_SECRET": "s" * 32, "WHATSAPP_PHONE_NUMBER_ID": "1234567890",
           "WHATSAPP_TOKEN": "SHORT", "INSTAGRAM_TOKEN": "ig", "WHATSAPP_WABA_ID": ""}
    with httpx.Client(transport=httpx.MockTransport(meta_api)) as c:
        learned = go_live.check_meta(c, cfg)
        assert cfg["WHATSAPP_TOKEN"] == "LONG" and cfg["WHATSAPP_WABA_ID"] == "555"
        assert learned == {"wa_display": "+1 555 010 0000", "ig_user": "17", "ig_name": "kaapikone"}
        with pytest.raises(SystemExit, match="personal"):
            go_live.check_meta(c, {**cfg, "INSTAGRAM_TOKEN": "personal"})


async def test_reviews_come_only_from_real_visits(client, scripted):
    from tests.fakes import text

    asset_id, post = await live_post("poster")
    mine = (await client.post(f"/api/public/r/{post}/claim", json={"device": "phone-review-1"})).json()["code"]
    r = await client.post(f"/api/public/claims/{mine}/review", json={"rating": 5, "comment": "Lovely", "language": "en"})
    assert r.status_code == 409  # not redeemed yet: no review without a visit

    await client.post("/api/counter/redeem", json={"code": mine, "outside_rules": "test"})
    scripted.push(text('{"sentiment": 0.6, "themes": ["filter_coffee"], "english": null}'))
    r = await client.post(f"/api/public/claims/{mine}/review", json={"rating": 5, "comment": "Lovely coffee", "language": "en"})
    assert r.status_code == 200
    page = (await client.get(f"/api/public/claims/{mine}")).json()
    assert page["review"] == {"rating": 5, "body": "Lovely coffee"}

    data = (await client.get("/api/businesses/kaapi-kone/customers")).json()
    mine_row = next(x for x in data["recent"] if x["claim_code"] == mine)
    assert mine_row["source"] == "visit_review" and mine_row["themes"] == ["filter_coffee"]
    assert data["visits"]["n"] >= 1 and data["visits"]["stars"][4] >= 1

    scripted.push(text('{"reply": "Thank you, glad the coffee hit the spot. See you soon."}'))
    draft = (await client.post(f"/api/reviews/{mine_row['id']}/reply/draft")).json()["reply"]
    assert "coffee" in draft
    assert (await client.put(f"/api/reviews/{mine_row['id']}/reply", json={"reply": draft})).json()["ok"]

    assert (await client.put("/api/businesses/kaapi-kone/review-link", json={"url": "https://evil.example/x"})).status_code == 409
    assert (await client.put("/api/businesses/kaapi-kone/review-link", json={"url": "https://g.page/r/abc/review"})).status_code == 200
    assert (await client.get(f"/api/public/claims/{mine}")).json()["google_review_url"] == "https://g.page/r/abc/review"
    await client.put("/api/businesses/kaapi-kone/review-link", json={"url": ""})
