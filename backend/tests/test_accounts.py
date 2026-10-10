"""Accounts, onboarding and the photo library: any business can join, owners only see their own data,
and posts use real photos of the business."""

import base64
import io
import json

import pytest
from PIL import Image

from app.domain.economics import offer_economics
from app.photos import UnsafeURL, _check_url, score
from tests.fakes import text

STRANGER = "00000000-0000-4000-8000-0000000000ff"
NEW_BUSINESS = {
    "name": "Shear Joy Salon", "kind": "hair salon", "city": "Mysuru", "locality": "Kuvempunagar",
    "languages": ["en", "kn"], "owner_name": "Asha", "description": "Quick, friendly cuts near the college.",
    "find_on_google": False,
    "offerings": [{"name": "Haircut", "price": 250, "unit_cost": 60}, {"name": "Beard trim", "price": 120}],
}


def png_data_url(w: int = 640, h: int = 640, colour: str = "#8a5a3c") -> str:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), colour).save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


async def test_other_owners_cannot_see_a_business(client):
    client.user["id"] = STRANGER
    assert (await client.get("/api/businesses/kaapi-kone")).status_code == 404
    assert (await client.get("/api/businesses/kaapi-kone/ledger")).status_code == 404
    assert (await client.post("/api/businesses/kaapi-kone/campaigns", json={"brief": "hi there"})).status_code == 404
    assert (await client.get("/api/me")).json()["businesses"] == []


async def test_onboarding_creates_a_private_business_with_a_starting_voice(client, scripted):
    client.user["id"] = STRANGER
    draft = {"voice": ["cheerful", "quick"], "do": ["Say it plainly"], "avoid": ["ALL CAPS"],
             "signature_phrases": [{"lang": "en", "phrase": "See you at the chair."}, {"lang": "hi", "phrase": "x"}],
             "imagery": "Bright salon photos.", "palette": ["teal"], "banned_words": ["Epic", "epic "],
             "emoji_policy": "none"}
    scripted.push(text(json.dumps(draft)))
    r = await client.post("/api/businesses", json=NEW_BUSINESS)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["slug"].startswith("shear-joy-salon-") and not b["is_demo"]
    assert b["profile"]["menu"][1]["unit_cost"] is None

    me = (await client.get("/api/me")).json()
    assert [x["slug"] for x in me["businesses"]] == [b["slug"]]
    brand = (await client.get(f"/api/businesses/{b['slug']}")).json()["brand"]["dna"]
    assert brand["signature_phrases"] == {"en": ["See you at the chair."]}  # hi is not one of their languages
    assert brand["banned_words"] == ["epic"]

    client.user["id"] = "00000000-0000-4000-8000-000000000001"  # the demo owner cannot open it
    assert (await client.get(f"/api/businesses/{b['slug']}")).status_code == 404


async def test_onboarding_survives_the_model_being_down(client):
    client.user["id"] = STRANGER
    r = await client.post("/api/businesses", json={**NEW_BUSINESS, "name": "Second Shop"})
    assert r.status_code == 200
    brand = (await client.get(f"/api/businesses/{r.json()['slug']}")).json()["brand"]
    assert "warm" in brand["dna"]["voice"]


async def test_uploaded_photos_are_used_for_posts_and_can_be_swapped(client):
    r = await client.post("/api/businesses/kaapi-kone/photos", json={"data_url": png_data_url()})
    assert r.status_code == 200, r.text
    photo = r.json()
    assert photo["source"] == "upload" and photo["width"] == 640 and photo["url"].endswith(".jpg")

    tiny = await client.post("/api/businesses/kaapi-kone/photos", json={"data_url": png_data_url(100, 100)})
    assert tiny.status_code == 409
    junk = await client.post("/api/businesses/kaapi-kone/photos", json={"data_url": "data:image/png;base64,!!!"})
    assert junk.status_code == 409

    lib = (await client.get("/api/businesses/kaapi-kone/photos")).json()["photos"]
    assert any(p["id"] == photo["id"] for p in lib)

    client.user["id"] = STRANGER
    assert (await client.get("/api/businesses/kaapi-kone/photos")).status_code == 404
    assert (await client.patch(f"/api/photos/{photo['id']}", json={"status": "hidden"})).status_code == 404


def test_photo_matching_prefers_relevant_unused_photos():
    dosa = {"tags": ["dosa", "banana leaf"], "caption": "A crisp masala dosa", "kind": "food", "source": "upload"}
    room = {"tags": ["tables"], "caption": "The dining room", "kind": "interior", "source": "upload"}
    assert score(dosa, "masala dosa for students", 0) > score(room, "masala dosa for students", 0)
    assert score(dosa, "masala dosa for students", 2) < score(room, "masala dosa for students", 0)


@pytest.mark.parametrize("url", ["http://127.0.0.1/admin", "http://169.254.169.254/latest", "file:///etc/passwd",
                                 "http://localhost:8000/api", "https://10.0.0.5/", "http://example.com:2375/"])
def test_imports_refuse_internal_addresses(url):
    with pytest.raises(UnsafeURL):
        _check_url(url)


def test_margin_check_without_costs_says_so():
    out = offer_economics([{"name": "Beard trim", "price": 120, "unit_cost": None}], discount_pct=20, baseline_covers=30)
    assert out["verdict"] == "unknown_cost" and out["offer_price"] == 96


async def test_results_report_conversion_per_post(client):
    r = (await client.get("/api/businesses/kaapi-kone/results")).json()
    assert set(r["totals"]) == {"scans", "claims", "redeemed", "sales", "simulated", "conversion"}
    for p in r["posts"]:
        assert p["link"].endswith("/r/" + p["code"])


async def test_posts_use_a_matching_library_photo_and_spread_across_photos(client):
    """make_visual picks the best-matching real photo and does not reuse one while others fit."""
    from app.agent.tools import make_visual
    from app.db import connection
    from tests.test_flow import ctx_for

    r = await client.post("/api/businesses/kaapi-kone/campaigns", json={"brief": "dosa evening", "run_agent": False})
    cid = r.json()["id"]
    async with connection() as conn:
        b = await (await conn.execute("select id from businesses where slug = 'kaapi-kone'")).fetchone()
        await conn.execute("update business_photos set status = 'hidden' where business_id = %s", (b["id"],))
        rows = []
        for caption, tags in [("A crisp masala dosa on a banana leaf", ["dosa", "banana leaf"]),
                              ("The dining room at lunch", ["tables", "room"])]:
            rows.append(await (await conn.execute(
                """insert into business_photos (business_id, source, image_key, caption, kind, tags)
                   values (%s, 'upload', %s, %s, 'food', %s) returning *""",
                (b["id"], f"kaapi-kone/photos/test-{len(rows)}.jpg", caption, tags))).fetchone())
        assets = []
        for _ in range(2):
            a = await (await conn.execute(
                """insert into assets (campaign_id, segment, channel, language, status, current_revision)
                   values (%s, 'students', 'instagram_post', 'en', 'valid', 1) returning *""", (cid,))).fetchone()
            await conn.execute(
                """insert into asset_revisions (asset_id, n, content, rendered, validation, created_by)
                   values (%s, 1, '{}', '{}', '{}', 'agent')""", (a["id"],))
            assets.append(a)

    ctx = await ctx_for(client, cid)
    first = await make_visual(ctx, str(assets[0]["id"]), "masala dosa for students")
    second = await make_visual(ctx, str(assets[1]["id"]), "masala dosa for students")
    assert first["image_key"] == rows[0]["image_key"] and first["source"] == "upload"
    assert second["image_key"] == rows[1]["image_key"]  # the dosa photo is taken, so the next fit is used

    detail = (await client.get(f"/api/campaigns/{cid}")).json()
    srcs = {a["id"]: a["image_source"] for a in detail["assets"]}
    assert srcs[str(assets[0]["id"])]["source"] == "upload"


async def test_staff_phone_uses_the_counter_pin(client):
    from app.db import connection

    assert (await client.put("/api/businesses/kaapi-kone/counter", json={"pin": "12ab"})).status_code == 422
    r = await client.put("/api/businesses/kaapi-kone/counter", json={"pin": "4321", "whatsapp": "98450 12345"})
    assert r.status_code == 200
    s = (await client.get("/api/businesses/kaapi-kone/counter")).json()
    assert s["pin_set"] and s["whatsapp"] == "919845012345" and s["staff_link"].endswith("/k/desk/kaapi-kone")

    # without a session the staff routes refuse; with the PIN they work
    assert (await client.post("/api/public/counter/check", json={"code": "ABCDEFG"})).status_code == 401
    assert (await client.post("/api/public/counter/session", json={"pin": "0000", "business": "kaapi-kone"})).status_code == 409
    r = await client.post("/api/public/counter/session", json={"pin": "4321", "business": "kaapi-kone"})
    token = r.json()["token"]
    r = await client.post("/api/public/counter/check", json={"token": token, "code": "ZZZZZZZ"})
    assert r.status_code == 404

    # five wrong PINs lock it, even the right one, for a while
    for _ in range(5):
        await client.post("/api/public/counter/session", json={"pin": "1111", "business": "kaapi-kone"})
    r = await client.post("/api/public/counter/session", json={"pin": "4321", "business": "kaapi-kone"})
    assert r.status_code == 409 and "Too many" in r.json()["detail"]

    # a new PIN signs every staff phone out and clears the lock
    await client.put("/api/businesses/kaapi-kone/counter", json={"pin": "5678"})
    assert (await client.post("/api/public/counter/check", json={"token": token, "code": "ZZZZZZZ"})).status_code == 401
    async with connection() as conn:
        await conn.execute("update businesses set counter_pin_hash = null, profile = profile - 'whatsapp' "
                           "where slug = 'kaapi-kone'")
