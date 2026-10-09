"""Situation snapshot + deterministic detectors.

Noticing what needs attention is system logic, not LLM judgement: the agent is
handed findings and decides what to do about them.
"""

from datetime import date
from typing import Any

from app.db import Conn, fetch_all, fetch_one
from app.domain import culture
from app.services import experiment_status


async def theme_trends(conn: Conn, business_id: Any, *, days: int = 14, today: date | None = None) -> list[dict]:
    today = today or date.today()
    rows = await fetch_all(
        conn,
        """with t as (
             select unnest(themes) as theme, occurred_at::date as d, sentiment, id, body, language
             from customer_interactions where business_id = %s and occurred_at::date > %s::date - %s * 2)
           select theme,
                  count(*) filter (where d > %s::date - %s) as recent,
                  count(*) filter (where d <= %s::date - %s) as previous,
                  round(avg(sentiment)::numeric, 2) as sentiment,
                  (array_agg(json_build_object('id', id, 'text', body, 'language', language)
                             order by d desc))[1:2] as quotes
           from t group by theme order by recent desc, previous desc""",
        (business_id, today, days, today, days, today, days),
    )
    return [{**r, "sentiment": float(r["sentiment"]) if r["sentiment"] is not None else None} for r in rows]


async def detect(conn: Conn, business: dict[str, Any], campaign_id: Any | None,
                 today: date | None = None) -> list[dict[str, Any]]:
    today = today or date.today()
    findings: list[dict[str, Any]] = []

    def add(priority: int, kind: str, message: str, **data: Any) -> None:
        findings.append({"priority": priority, "kind": kind, "message": message, **data})

    pending = await fetch_all(
        conn, "select payload->>'tool' as tool from inbox_items where business_id = %s and status = 'pending'",
        (business["id"],),
    )
    pending_tools = {p["tool"] for p in pending}

    if campaign_id:
        draft = await fetch_one(conn, "select version from offer_facts where campaign_id = %s and status = 'draft'",
                                (campaign_id,))
        locked = await fetch_one(conn, "select version from offer_facts where campaign_id = %s and status = 'locked'",
                                 (campaign_id,))
        campaign = await fetch_one(conn, "select plan, intent from campaigns where id = %s", (campaign_id,))
        if not draft and not locked:
            add(1, "no_offer_facts", "The offer has not been written down as facts yet.")
        if draft and "lock_facts" not in pending_tools:
            add(1, "facts_unlocked", f"Offer facts v{draft['version']} are drafted but not sent for locking.")
        if campaign and not campaign["plan"]:
            add(2, "no_plan", "No campaign plan (audiences × channels × languages) yet.")

        counts = {r["status"]: r["n"] for r in await fetch_all(
            conn, "select status, count(*)::int as n from assets where campaign_id = %s group by status",
            (campaign_id,))}
        if counts.get("stale"):
            add(1, "stale_assets", f"{counts['stale']} asset(s) were written against old offer facts.")
        if counts.get("invalid"):
            add(2, "invalid_assets", f"{counts['invalid']} asset(s) failed the fact guard.")
        unaudited = await fetch_one(
            conn,
            """select count(*)::int as n from assets a join asset_revisions r
               on r.asset_id = a.id and r.n = a.current_revision
               where a.campaign_id = %s and a.status = 'valid' and r.validation->>'l3' = 'pending'""",
            (campaign_id,),
        )
        if unaudited and unaudited["n"]:
            add(2, "unaudited_assets", f"{unaudited['n']} asset(s) await the meaning check (validate_assets).")
        ready = await fetch_one(
            conn,
            """select count(*)::int as n from assets a join asset_revisions r
               on r.asset_id = a.id and r.n = a.current_revision
               where a.campaign_id = %s and a.status = 'valid' and r.validation->>'l3' <> 'pending'""",
            (campaign_id,),
        )
        if ready and ready["n"] and "publish_assets" not in pending_tools:
            add(2, "ready_to_publish", f"{ready['n']} checked asset(s) are ready to send to the owner for approval.")

        for exp in await fetch_all(conn, "select id from experiments where campaign_id = %s and status = 'running'",
                                   (campaign_id,)):
            st = await experiment_status(conn, exp["id"])
            if st["decision"]["winner"]:
                add(1, "experiment_decidable", f"Experiment has a winner: {st['decision']['reason']}",
                    experiment_id=str(exp["id"]))

    for t in await theme_trends(conn, business["id"], today=today):
        if t["recent"] >= 3 and t["recent"] >= 2 * max(t["previous"], 1) and (t["sentiment"] or 0) < 0:
            add(2, "complaint_spike", f"Complaints about '{t['theme']}' rose to {t['recent']} in 14 days "
                f"(from {t['previous']}).", theme=t["theme"])

    covered: set[str] = set()
    for ev in await fetch_all(
        conn,
        """select key, period_start, data from customer_insights
           where business_id = %s and kind = 'event' and period_start between %s and %s::date + 21
           order by period_start""",
        (business["id"], today, today),
    ):
        name = ev["data"].get("name", ev["key"])
        fest = next(iter(culture.mentioned(name)), None)
        if fest:
            covered.add(fest.key)
        add(3, "event_upcoming", f"{name} starts {ev['period_start']:%a %d %b}.", event=ev["key"],
            festival=fest.key if fest else None)
    # Festivals from the built-in calendar that the business's own events don't already cover.
    for fest, start, _end, _label in culture.upcoming(today, days=21):
        if fest.key not in covered:
            add(3, "event_upcoming", f"{fest.name} starts {max(start, today):%a %d %b}.", event=fest.key,
                festival=fest.key)

    return sorted(findings, key=lambda f: f["priority"])


async def snapshot(conn: Conn, business: dict[str, Any], campaign_id: Any | None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "business": {"name": business["name"], "locality": business["locality"], "languages": business["languages"]},
        "today": date.today().isoformat(),
        # Festivals in the next month, so the agent can plan around them (greetings and customs are hand-checked).
        "festivals": [{"key": f.key, "name": f.name, "when": label, "angles": list(f.angles)}
                      for f, _s, _e, label in culture.upcoming(date.today(), days=30)],
    }
    if campaign_id:
        c = await fetch_one(conn, "select id, name, status, brief, goal, plan, intent from campaigns where id = %s",
                            (campaign_id,))
        facts = await fetch_one(
            conn,
            """select version, status, facts, forbidden_claims from offer_facts
               where campaign_id = %s and status in ('locked', 'draft') order by version desc limit 1""",
            (campaign_id,),
        )
        assets = await fetch_all(
            conn,
            """select a.id, a.segment, a.channel, a.language, a.variant, a.status, a.experiment_id,
                      r.validation->>'l3' as l3
               from assets a left join asset_revisions r on r.asset_id = a.id and r.n = a.current_revision
               where a.campaign_id = %s and a.status not in ('retired', 'rejected') order by a.created_at""",
            (campaign_id,),
        )
        out["campaign"] = {**c, "id": str(c["id"])} if c else None
        out["offer_facts"] = facts
        out["assets"] = [{**a, "id": str(a["id"]), "experiment_id": str(a["experiment_id"]) if a["experiment_id"]
                          else None} for a in assets]
    out["pending_owner_items"] = [
        r["title"] for r in await fetch_all(
            conn, "select title from inbox_items where business_id = %s and status = 'pending' order by created_at",
            (business["id"],))
    ]
    out["findings"] = await detect(conn, business, campaign_id)
    return out

