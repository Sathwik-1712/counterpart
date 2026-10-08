"""Load the synthetic demo business (idempotent: replaces it if present).

    uv run python -m scripts.seed
"""

import asyncio
import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from app.domain.facts import AssetContent
from app.providers.embeddings import HashingEmbedder

SEED = Path(__file__).resolve().parents[2] / "data" / "seed" / "kaapi_kone.json"


def _at(days_ago: float) -> datetime:
    """A morning (08:30 IST = 03:00 UTC) `days_ago` days before today."""
    return datetime.now(UTC).replace(hour=3, minute=0, second=0, microsecond=0) - timedelta(days=days_ago)


async def insert_interactions(conn: psycopg.AsyncConnection, business_id: Any, items: list[dict]) -> int:
    emb = await HashingEmbedder().embed([i["body"] for i in items])
    for i, vec in zip(items, emb, strict=True):
        await conn.execute(
            """insert into customer_interactions (business_id, source, language, segment, rating, body, occurred_at,
                   sentiment, themes, embedding, analyzed_at, is_synthetic)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now(), true)""",
            (business_id, i["source"], i["language"], i.get("segment"), i.get("rating"), i["body"], _at(i["d"]),
             i["sentiment"], i["themes"], vec))
    return len(items)


async def seed(dsn: str) -> dict[str, Any]:
    data = json.loads(SEED.read_text())
    b = data["business"]
    async with await psycopg.AsyncConnection.connect(dsn, prepare_threshold=None) as conn:
        async with conn.transaction():
            await conn.execute("set local counterpart.allow_purge = 'on'")
            # Re-seeding keeps who can open the demo (memberships cascade with the business).
            members = await (await conn.execute(
                """select m.user_id, m.role from memberships m join businesses b on b.id = m.business_id
                   where b.slug = %s""", (b["slug"],))).fetchall()
            await conn.execute("delete from businesses where slug = %s", (b["slug"],))
            cur = await conn.execute(
                """insert into businesses (slug, name, locality, city, languages, profile, is_demo)
                   values (%s, %s, %s, %s, %s, %s, true) returning id""",
                (b["slug"], b["name"], b["locality"], b["city"], b["languages"], Jsonb(b["profile"])))
            bid = (await cur.fetchone())[0]  # type: ignore[index]
            for user_id, role in members:
                await conn.execute("insert into memberships (user_id, business_id, role) values (%s, %s, %s)",
                                   (user_id, bid, role))
            await conn.execute(
                """insert into brand_dna (business_id, version, status, dna, rationale, created_by)
                   values (%s, 1, 'active', %s, 'Imported from past posts and the owner''s notes', 'seed')""",
                (bid, Jsonb(data["brand_dna"])))
            for s in data["segments"]:
                await conn.execute("insert into customer_insights (business_id, kind, key, data) values (%s, 'segment', %s, %s)",
                                   (bid, s["key"], Jsonb(s["data"])))
            for e in data["events"]:
                await conn.execute(
                    """insert into customer_insights (business_id, kind, key, period_start, period_end, data)
                       values (%s, 'event', %s, %s, %s, %s)""",
                    (bid, e["key"], date.fromisoformat(e["period_start"]), date.fromisoformat(e["period_end"]),
                     Jsonb(e["data"])))
            n_interactions = await insert_interactions(conn, bid, data["interactions"])

            for h in data["history"]:
                cur = await conn.execute(
                    """insert into campaigns (business_id, name, status, goal, starts_on, ends_on, is_historical,
                           created_at) values (%s, %s, 'concluded', %s, %s, %s, true, %s) returning id""",
                    (bid, h["name"], Jsonb(h["goal"]), _at(h["days_ago_start"]).date(), _at(h["days_ago_end"]).date(),
                     _at(h["days_ago_start"] + 3)))
                cid = (await cur.fetchone())[0]  # type: ignore[index]
                for a in h["assets"]:
                    cur = await conn.execute(
                        """insert into assets (campaign_id, segment, channel, language, variant, status, current_revision)
                           values (%s, %s, %s, %s, %s, 'retired', 1) returning id""",
                        (cid, a["segment"], a["channel"], a["language"], a["variant"]))
                    aid = (await cur.fetchone())[0]  # type: ignore[index]
                    content = AssetContent.model_validate({"body": [{"text": a["text"], "sources": ["history"]}]})
                    await conn.execute(
                        """insert into asset_revisions (asset_id, n, content, rendered, features, created_by, reason)
                           values (%s, 1, %s, %s, %s, 'owner', 'Imported history')""",
                        (aid, Jsonb(content.model_dump()), Jsonb({"headline": "", "body": a["text"], "cta": "",
                                                                  "hashtags": []}),
                         Jsonb({"hook": a["hook"]})))
                    for typ, qty in a["outcomes"].items():
                        await conn.execute(
                            """insert into outcome_events (campaign_id, asset_id, type, qty, source, occurred_at)
                               values (%s, %s, %s, %s, 'import', %s)""",
                            (cid, aid, typ, qty, _at(h["days_ago_end"])))

            for m in data["memories"]:
                await conn.execute(
                    """insert into memories (business_id, kind, content, scope, evidence, confidence, created_by)
                       values (%s, %s, %s, %s, %s, %s, 'seed')""",
                    (bid, m["kind"], m["content"], Jsonb(m["scope"]), Jsonb(m["evidence"]), m["confidence"]))
            await conn.execute(
                """insert into ledger_events (business_id, actor, type, summary)
                   values (%s, 'system', 'seed.loaded', 'Loaded demo data (synthetic history and reviews)')""",
                (bid,))
    return {"business_id": str(bid), "interactions": n_interactions, "historical_campaigns": len(data["history"])}


if __name__ == "__main__":
    from app.config import get_settings

    print(asyncio.run(seed(get_settings().database_url)))
