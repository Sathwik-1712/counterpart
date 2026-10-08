"""A hand-written sample campaign for UI development (no LLM needed).

    uv run python -m scripts.sample_campaign

Goes through the real services: draft facts -> lock -> revisions (guarded) ->
publish -> outcomes -> experiment. Named "(sample)" so it is never mistaken for AI output.
"""

import asyncio
import random

from app import db, services
from app.config import get_settings
from app.db import connection, fetch_one
from app.domain.facts import AssetContent

FACTS = [
    {"key": "discount", "label": "Discount", "type": "percent", "value": 20,
     "display": {"en": "20% off", "kn": "೨೦% ರಿಯಾಯಿತಿ", "hi": "20% की छूट"}},
    {"key": "combo", "label": "What's included", "type": "item", "value": ["Filter coffee", "Masala vada"],
     "display": {"en": "filter coffee with masala vada", "kn": "ಫಿಲ್ಟರ್ ಕಾಫಿ ಜೊತೆ ಮಸಾಲೆ ವಡೆ",
                 "hi": "फ़िल्टर कॉफ़ी के साथ मसाला वड़ा"}},
    {"key": "days", "label": "When", "type": "date_range", "value": ["2026-10-10", "2026-10-11"],
     "display": {"en": "this Saturday and Sunday, 8 to 11 am", "kn": "ಈ ಶನಿವಾರ ಮತ್ತು ಭಾನುವಾರ, ಬೆಳಿಗ್ಗೆ 8 ರಿಂದ 11",
                 "hi": "इस शनिवार और रविवार, सुबह 8 से 11 बजे"}},
    {"key": "dine_in", "label": "Condition", "type": "condition", "value": "dine-in only",
     "display": {"en": "Dine-in only.", "kn": "ಕೆಫೆಯಲ್ಲಿ ಕುಳಿತು ಸವಿಯುವವರಿಗೆ ಮಾತ್ರ.", "hi": "सिर्फ़ कैफ़े में बैठकर।"}},
]
FORBIDDEN = {"en": ["free", "all day", "delivery"], "kn": ["ಉಚಿತ"], "hi": ["मुफ़्त"]}


def c(headline: str, body: str, cta: str, hashtags: list[str] | None = None, src: str = "brand:voice") -> AssetContent:
    return AssetContent.model_validate({
        "headline": [{"text": headline, "sources": [src]}],
        "body": [{"text": body, "sources": ["fact:discount", "fact:combo", "fact:days", "insight:theme:decoction_strength"]}],
        "cta": [{"text": cta, "sources": ["brand:voice"]}],
        "hashtags": hashtags or [],
    })


PIECES = [
    ("regulars", "whatsapp", "kn", "A", "nostalgia", c(
        "ಬೆಳಗಿನ ಕಾಫಿ, ಹಳೆಯ ರುಚಿ",
        "ಸ್ಟೀಲ್ ಲೋಟದಲ್ಲಿ ಗಟ್ಟಿ ಡಿಕಾಕ್ಷನ್ ಕಾಫಿ ನಿಮಗಾಗಿ ಕಾಯ್ತಿದೆ. {{days}}, {{combo}} ಮೇಲೆ {{discount}}. {{dine_in}}",
        "ಬನ್ನಿ, ಒಂದು ಕಾಫಿ ಕುಡಿಯೋಣ")),
    ("regulars", "whatsapp", "kn", "B", "urgency", c(
        "ಈ ವಾರಾಂತ್ಯ ಮಾತ್ರ",
        "{{days}} ಮಾತ್ರ: {{combo}} ಮೇಲೆ {{discount}}. ಬೇಗ ಬಂದರೆ ಕುಳಿತುಕೊಳ್ಳಲು ಜಾಗ ಸಿಗುತ್ತದೆ. {{dine_in}}",
        "ಬೆಳಿಗ್ಗೆ ಬೇಗ ಬನ್ನಿ")),
    ("students", "instagram_story", "en", None, "urgency", c(
        "Class soon? Kaapi first.",
        "{{discount}} on {{combo}}, {{days}}. {{dine_in}}",
        "Show this at the counter", ["#JayanagarMornings", "#FilterKaapi"])),
    ("families", "instagram_post", "en", None, "community", c(
        "Sunday mornings, the way they used to be",
        "Bring your people for a slow breakfast. {{discount}} on {{combo}}, {{days}}. {{dine_in}}",
        "Your morning, your tumbler.", ["#KaapiKone", "#Jayanagar4thBlock", "#BengaluruBreakfast"])),
    ("students", "poster", "hi", None, "value", c(
        "सुबह की शुरुआत, फ़िल्टर कॉफ़ी के साथ",
        "{{combo}} पर {{discount}}। {{days}}। {{dine_in}}",
        "QR स्कैन करें")),
    ("office_goers", "whatsapp", "en", None, "convenience", c(
        "Before your morning standup",
        "Beat the rush: {{discount}} on {{combo}}, {{days}}. {{dine_in}}",
        "See you at the counter")),
]


async def main() -> None:
    s = get_settings()
    await db.open_pool(s.database_url)
    try:
        async with connection() as conn:
            b = await services.get_business(conn, "kaapi-kone")
            camp = await services.create_campaign(
                conn, b["id"], name="Weekend kaapi combo (sample)",
                brief="Twenty percent off filter coffee with masala vada this weekend, mornings, dine-in only. "
                      "I want more college kids and the regulars back.")
            await services.update_campaign_plan(
                conn, camp["id"],
                goal={"statement": "More weekend-morning visits from students and regulars",
                      "kpi": {"metric": "redemptions", "target": 60, "window_days": 2}},
                plan={"cells": [{"segment": p[0], "channel": p[1], "language": p[2]} for p in PIECES]},
                intent={"core_message": "A slow, proper filter-coffee morning at a good price",
                        "cta": "Come in this weekend morning", "tone": ["warm", "neighbourly"]})
            camp = await services.get_campaign(conn, camp["id"])
            draft = await services.save_draft_facts(conn, camp, facts=FACTS, forbidden_claims=FORBIDDEN,
                                                    reason="Checked: 20% keeps a healthy margin on this combo",
                                                    actor="agent")
            # no model here: record the deterministic (numbers-only) wording check, shown as "not checked by a model"
            await services.store_wording_check(conn, camp, draft,
                                               services.wording_result(services._sheet(draft), None))
            await services.lock_facts(conn, camp, actor="owner")
            assets = []
            for seg, ch, lang, variant, hook, content in PIECES:
                a = await services.create_asset(conn, camp["id"], segment=seg, channel=ch, language=lang, variant=variant)
                rev = await services.add_revision(conn, a, content, created_by="agent", reason=f"angle: {hook}",
                                                  verifier_available=False, features={"hook": hook, "angle": hook})
                assets.append((a, rev))
            # one piece where a number slipped in, to show the guard
            bad = await services.create_asset(conn, camp["id"], segment="students", channel="instagram_post", language="en")
            await services.add_revision(conn, bad, c("Half price kaapi!", "Now 30% off {{combo}}, {{days}}.", "Hurry"),
                                        created_by="agent", reason="angle: value", verifier_available=False)
            exp = await fetch_one(
                conn, """insert into experiments (campaign_id, hypothesis, dimension, trial_type, success_type, status)
                         values (%s, 'Nostalgia beats urgency for regulars on WhatsApp', 'hook', 'scan', 'click',
                         'running') returning id""", (camp["id"],))
            for a, _ in assets[:2]:
                await conn.execute("update assets set experiment_id = %s where id = %s", (exp["id"], a["id"]))  # type: ignore[index]
            live = [a for a, rev in assets if rev["validation"]["passed"]][:5]
            for a in live:
                await services.approve_asset(conn, a["id"], actor="owner")
                tp = await services.issue_touchpoint(conn, a)
                await conn.execute("update assets set status = 'live' where id = %s", (a["id"],))
                rng = random.Random(str(a["id"]))
                scans = rng.randint(14, 30)
                clicks = int(scans * (0.55 if a["variant"] == "A" else 0.3 if a["variant"] == "B" else 0.4))
                for typ, n in (("scan", scans), ("click", clicks), ("redeem", max(1, clicks - 3))):
                    await conn.execute(
                        """insert into outcome_events (campaign_id, asset_id, touchpoint_code, type, qty, source)
                           values (%s, %s, %s, %s, %s, 'simulated')""", (camp["id"], a["id"], tp["code"], typ, n))
            await conn.execute("update campaigns set status = 'active' where id = %s", (camp["id"],))
            await conn.execute(
                """insert into inbox_items (business_id, campaign_id, kind, title, body, payload)
                   values (%s, %s, 'recommendation', %s, %s, %s)""",
                (b["id"], camp["id"], "Move the offer to 10 to 11 am next weekend",
                 "Queue complaints doubled this fortnight and most mention 8:30 to 9:30.",
                 db.jsonb({"evidence": ["6 queue complaints in 14 days, 3 before", "Peak redemptions at 9 am"]})))
        print(f"sample campaign: {camp['id']}")
    finally:
        await db.close_pool()


if __name__ == "__main__":
    asyncio.run(main())
