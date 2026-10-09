"""Business operations shared by the HTTP API (owner actions) and agent tools.

Rules that make the system trustworthy live here, not in prompts:
  * offer facts change only by locking a new version (the DB trigger makes
    locked versions immutable);
  * locking a new version marks exactly the dependent assets stale;
  * an asset can be approved only if its current revision passed the Fact Guard
    against the currently locked fact version.
"""

import json
import secrets
from dataclasses import asdict
from datetime import date
from typing import Any
from uuid import UUID

from app import ledger
from app.db import Conn, fetch_all, fetch_one, jsonb
from app.domain import audit as audit_mod
from app.domain.facts import (
    LANG_NAMES,
    AssetContent,
    Check,
    FactSheet,
    assumed_facts,
    depends_on,
    deterministic_checks,
    render,
    report,
    wording_issues,
)
from app.domain.impact import affected_assets, changed_fact_keys, forbidden_changed
from app.domain.stats import Arm, decide, prior_from_history
from app.providers.base import ProviderError
from app.providers.router import ModelRouter

MIN_TRIALS = 15  # link opens each version needs before an A/B test is judged
LOSS_THRESHOLD = 0.01  # decide once picking the leader risks under 1 redemption per 100 visitors


class NotFound(Exception):
    pass


class Conflict(Exception):
    pass


# ------------------------------------------------------------------ business


async def get_business(conn: Conn, slug: str) -> dict[str, Any]:
    row = await fetch_one(conn, "select * from businesses where slug = %s", (slug,))
    if not row:
        raise NotFound(f"business '{slug}' not found")
    return row


async def get_business_by_id(conn: Conn, business_id: UUID | str) -> dict[str, Any]:
    row = await fetch_one(conn, "select * from businesses where id = %s", (business_id,))
    if not row:
        raise NotFound("business not found")
    return row


async def active_brand(conn: Conn, business_id: UUID | str) -> dict[str, Any] | None:
    return await fetch_one(
        conn, "select * from brand_dna where business_id = %s and status = 'active'", (business_id,)
    )


async def get_campaign(conn: Conn, campaign_id: UUID | str) -> dict[str, Any]:
    row = await fetch_one(conn, "select * from campaigns where id = %s", (campaign_id,))
    if not row:
        raise NotFound("campaign not found")
    return row


async def create_campaign(conn: Conn, business_id: UUID | str, *, name: str, brief: str | None) -> dict[str, Any]:
    row = await fetch_one(
        conn,
        "insert into campaigns (business_id, name, brief) values (%s, %s, %s) returning *",
        (business_id, name, brief),
    )
    assert row
    await ledger.record(conn, business_id, "campaign.created", f"New campaign: {name}", actor="owner",
                        campaign_id=row["id"], payload={"brief": brief})
    return row


async def update_campaign_plan(conn: Conn, campaign_id: UUID | str, *, goal: dict | None, plan: dict | None,
                               intent: dict | None, name: str | None = None) -> dict[str, Any]:
    row = await fetch_one(
        conn,
        """update campaigns set goal = coalesce(%s, goal), plan = coalesce(%s, plan),
           intent = coalesce(%s, intent), name = coalesce(%s, name),
           status = case when status = 'draft' then 'planned' else status end,
           updated_at = now() where id = %s returning *""",
        (jsonb(goal) if goal else None, jsonb(plan) if plan else None, jsonb(intent) if intent else None,
         (name or "").strip()[:60] or None, campaign_id),
    )
    if not row:
        raise NotFound("campaign not found")
    return row


# ------------------------------------------------------------------ facts


def _sheet(row: dict[str, Any]) -> FactSheet:
    return FactSheet(version=row["version"], facts=row["facts"], forbidden_claims=row["forbidden_claims"])


async def facts_row(conn: Conn, campaign_id: UUID | str, status: str) -> dict[str, Any] | None:
    return await fetch_one(
        conn, "select * from offer_facts where campaign_id = %s and status = %s", (campaign_id, status)
    )


async def locked_sheet(conn: Conn, campaign_id: UUID | str) -> FactSheet | None:
    row = await facts_row(conn, campaign_id, "locked")
    return _sheet(row) if row else None


async def save_draft_facts(
    conn: Conn, campaign: dict[str, Any], *, facts: list[dict], forbidden_claims: dict[str, list[str]],
    reason: str | None, actor: ledger.Actor,
) -> dict[str, Any]:
    # validate and normalise (fills defaults such as required=True)
    facts = [f.model_dump() for f in FactSheet(version=0, facts=facts, forbidden_claims=forbidden_claims).facts]
    draft = await facts_row(conn, campaign["id"], "draft")
    if draft:
        row = await fetch_one(
            conn,
            """update offer_facts set facts = %s, forbidden_claims = %s, change_reason = %s, wording_check = null
               where id = %s returning *""",
            (jsonb(facts), jsonb(forbidden_claims), reason, draft["id"]),
        )
    else:
        nxt = await fetch_one(conn, "select coalesce(max(version), 0) + 1 as v from offer_facts where campaign_id = %s",
                              (campaign["id"],))
        row = await fetch_one(
            conn,
            """insert into offer_facts (campaign_id, version, status, facts, forbidden_claims, change_reason)
               values (%s, %s, 'draft', %s, %s, %s) returning *""",
            (campaign["id"], nxt["v"], jsonb(facts), jsonb(forbidden_claims), reason),  # type: ignore[index]
        )
    assert row
    await ledger.record(conn, campaign["business_id"], "facts.drafted",
                        f"Drafted offer facts v{row['version']}" + (f" ({reason})" if reason else ""),
                        actor=actor, campaign_id=campaign["id"], payload={"version": row["version"]})
    return row


def wording_issue_text(issues: list[dict[str, Any]]) -> str:
    return "; ".join(f"{LANG_NAMES.get(i['lang'], i['lang'])} {i.get('label', i['key']).lower()}: “{i['wording']}”"
                     + (f" reads as “{i['back_translation']}”" if i.get("back_translation") else "")
                     + f". {i['issue']}" for i in issues)


def wording_result(sheet: FactSheet, llm_issues: list[dict[str, Any]] | None,
                   translations: dict[str, Any] | None = None, note: str | None = None) -> dict[str, Any]:
    """Deterministic number comparison always; the LLM back-translation when it ran (llm_issues is not None)."""
    issues = wording_issues(sheet)
    seen = {(i["key"], i["lang"]) for i in issues}
    issues += [i for i in llm_issues or [] if (i["key"], i["lang"]) not in seen]
    status = "failed" if issues else ("passed" if llm_issues is not None else "unchecked")
    return {"status": status, "issues": issues, "back_translations": translations or {}, "note": note}


async def store_wording_check(conn: Conn, campaign: dict[str, Any], draft: dict[str, Any],
                              check: dict[str, Any]) -> bool:
    """Saves the result only if the draft still has the wording that was checked."""
    row = await fetch_one(
        conn,
        "update offer_facts set wording_check = %s where id = %s and status = 'draft' and facts = %s returning id",
        (jsonb(check), draft["id"], jsonb(draft["facts"])),
    )
    if not row:
        return False
    summary = {"passed": "Checked the translated offer wording: it means the same as the English",
               "unchecked": "Translated offer wording not checked by a model; numbers match",
               "failed": "Translated offer wording does not match: " + wording_issue_text(check["issues"])}
    text = summary[check["status"]]
    if check.get("assumed"):
        text += ". Counterpart assumed, owner to confirm: " + ", ".join(
            f"{a['label'].lower()} ({', '.join(a['numbers'])})" for a in check["assumed"])
    await ledger.record(conn, campaign["business_id"], "facts.wording_checked", text,
                        actor="system", campaign_id=campaign["id"], payload=check)
    return True


async def owner_known_text(conn: Conn, campaign: dict[str, Any]) -> str:
    """Everything the owner said or the system computed for this campaign: brief, owner messages, menu, margin checks.
    Numbers outside this text in a facts draft are Counterpart's assumptions."""
    business = await get_business_by_id(conn, campaign["business_id"])
    rows = await fetch_all(
        conn, """select summary, payload from ledger_events where campaign_id = %s
                 and (type = 'owner.said' or type = 'tool.evaluate_offer')""", (campaign["id"],))
    profile = business.get("profile") or {}
    parts = [campaign.get("brief") or "", " ".join(profile.get("allowed_phrases") or []),
             " ".join(f"{m['name']} {m['price']}" for m in profile.get("menu") or [])]  # prices, not costs
    parts += [r["summary"] + " " + json.dumps(r["payload"].get("result") or {}, default=str) for r in rows]
    parts.append(f"{date.today().year} {date.today().year + 1}")  # the year itself is never an assumption
    return " ".join(parts)


async def check_fact_wording(router: ModelRouter, conn_factory: Any, campaign_id: str) -> dict[str, Any] | None:
    """Translation check on the facts draft, once per draft wording. The LLM call runs outside any transaction."""
    async with conn_factory() as conn:
        campaign = await get_campaign(conn, campaign_id)
        draft = await facts_row(conn, campaign_id, "draft")
        known = await owner_known_text(conn, campaign)
    if not draft:
        return None
    if draft.get("wording_check"):
        return draft["wording_check"]
    sheet = _sheet(draft)
    try:
        issues, translations = await audit_mod.audit_fact_wording(router, sheet)
        check = wording_result(sheet, issues, translations)
    except (ProviderError, ValueError) as e:
        check = wording_result(sheet, None, note=f"The meaning check could not run ({str(e)[:120]}).")
    check["assumed"] = assumed_facts(sheet, known)
    async with conn_factory() as conn:
        await store_wording_check(conn, campaign, draft, check)
    return check


async def lock_facts(conn: Conn, campaign: dict[str, Any], *, actor: ledger.Actor) -> dict[str, Any]:
    """Lock the draft. If it replaces a locked version, mark dependent assets stale."""
    draft = await facts_row(conn, campaign["id"], "draft")
    if not draft:
        raise Conflict("There is no draft of the offer facts to lock.")
    check = draft.get("wording_check")
    if not check:
        raise Conflict("The translated wording has not been checked yet.")
    if check["status"] == "failed":
        raise Conflict("Fix the translated wording first: " + wording_issue_text(check["issues"]))
    previous = await facts_row(conn, campaign["id"], "locked")
    if previous:
        await conn.execute("update offer_facts set status = 'superseded' where id = %s", (previous["id"],))
    row = await fetch_one(
        conn,
        "update offer_facts set status = 'locked', locked_at = now(), locked_by = %s where id = %s returning *",
        (actor, draft["id"]),
    )
    assert row
    stale: list[str] = []
    changed: set[str] = set()
    if previous:
        old, new = _sheet(previous), _sheet(row)
        changed = changed_fact_keys(old, new)
        revs = await fetch_all(
            conn,
            """select a.id as asset_id, r.fact_keys from assets a
               join asset_revisions r on r.asset_id = a.id and r.n = a.current_revision
               where a.campaign_id = %s and a.status not in ('retired', 'rejected')""",
            (campaign["id"],),
        )
        stale = affected_assets(revs, changed, all_if=forbidden_changed(old, new))
        if stale:
            await conn.execute(
                "update assets set status = 'stale', updated_at = now() where id = any(%s::uuid[])", (stale,)
            )
    summary = f"Locked offer facts v{row['version']}"
    if previous:
        summary += f": {', '.join(sorted(changed)) or 'no fact'} changed, {len(stale)} asset(s) need an update"
    await ledger.record(conn, campaign["business_id"], "facts.locked", summary, actor=actor,
                        campaign_id=campaign["id"],
                        payload={"version": row["version"], "changed": sorted(changed), "stale_assets": stale})
    return {"facts": row, "changed": sorted(changed), "stale_assets": stale}


# ------------------------------------------------------------------ assets

_CHANNEL = {"whatsapp": "WhatsApp message", "instagram_post": "Instagram post",
            "instagram_story": "Instagram story", "poster": "counter poster"}
_LANG = {"en": "English", "kn": "Kannada", "hi": "Hindi"}


def asset_label(asset: dict[str, Any]) -> str:
    """Owner-facing name, e.g. 'Kannada WhatsApp message for regulars'."""
    return (f"{_LANG.get(asset['language'], asset['language'])} {_CHANNEL.get(asset['channel'], asset['channel'])} "
            f"for {asset['segment'].replace('_', '-')}")


async def create_asset(conn: Conn, campaign_id: UUID | str, *, segment: str, channel: str, language: str,
                       variant: str | None = None, experiment_id: UUID | str | None = None) -> dict[str, Any]:
    row = await fetch_one(
        conn,
        """insert into assets (campaign_id, segment, channel, language, variant, experiment_id)
           values (%s, %s, %s, %s, %s, %s) returning *""",
        (campaign_id, segment, channel, language, variant, experiment_id),
    )
    assert row
    return row


async def get_asset(conn: Conn, asset_id: UUID | str) -> dict[str, Any]:
    row = await fetch_one(conn, "select * from assets where id = %s", (asset_id,))
    if not row:
        raise NotFound("asset not found")
    return row


async def add_revision(
    conn: Conn, asset: dict[str, Any], content: AssetContent, *, created_by: str, reason: str | None,
    verifier_available: bool, features: dict | None = None, image_key: str | None = None,
) -> dict[str, Any]:
    """Store a revision, render it against the locked facts and run the deterministic guard."""
    campaign = await get_campaign(conn, asset["campaign_id"])
    sheet = await locked_sheet(conn, campaign["id"])
    if sheet is None:
        raise Conflict("Lock the offer facts before writing copy.")
    business = await get_business_by_id(conn, campaign["business_id"])
    brand = await active_brand(conn, business["id"])
    allowed = tuple(business["profile"].get("allowed_phrases") or [])
    if banned := (brand or {}).get("dna", {}).get("banned_words"):  # brand voice rules, enforced like claims
        sheet = sheet.model_copy(update={"forbidden_claims": {**sheet.forbidden_claims, "brand": list(banned)}})

    if image_key is None:  # a rewrite keeps the piece's picture
        prev = await fetch_one(conn, "select image_key from asset_revisions where asset_id = %s and n = %s",
                               (asset["id"], asset.get("current_revision")))
        image_key = (prev or {}).get("image_key")
    checks = deterministic_checks(content, sheet, lang=asset["language"], channel=asset["channel"],
                                  allowed_phrases=allowed, strict_voice=created_by != "owner")
    validation = report(checks, facts_version=sheet.version,
                        l3_status="pending" if verifier_available else "skipped:no verifier configured")
    nxt = await fetch_one(conn, "select coalesce(max(n), 0) + 1 as n from asset_revisions where asset_id = %s",
                          (asset["id"],))
    rev = await fetch_one(
        conn,
        """insert into asset_revisions (asset_id, n, content, rendered, fact_keys, facts_version, brand_version,
               image_key, features, validation, created_by, reason)
           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning *""",
        (asset["id"], nxt["n"], jsonb(content.model_dump()), jsonb(render(content, sheet, asset["language"])),  # type: ignore[index]
         depends_on(content, sheet), sheet.version, brand["version"] if brand else None, image_key,
         jsonb(features) if features else None, jsonb(validation), created_by, reason),
    )
    assert rev
    status = "valid" if validation["passed"] else "invalid"
    await conn.execute("update assets set current_revision = %s, status = %s, updated_at = now() where id = %s",
                       (rev["n"], status, asset["id"]))
    failed = [c.detail for c in checks if not c.passed and c.severity == "block"]
    await ledger.record(
        conn, business["id"], "asset.revised",
        (f"Checked the {asset_label(asset)}: it matches the locked offer" if not failed
         else f"Blocked the {asset_label(asset)}. {failed[0]}"),
        actor="owner" if created_by == "owner" else "agent", campaign_id=campaign["id"],
        payload={"asset_id": str(asset["id"]), "revision": rev["n"], "passed": validation["passed"]},
    )
    return {**rev, "asset_status": status}


async def current_revision(conn: Conn, asset_id: UUID | str) -> dict[str, Any] | None:
    return await fetch_one(
        conn,
        """select r.* from asset_revisions r join assets a on a.id = r.asset_id and r.n = a.current_revision
           where a.id = %s""",
        (asset_id,),
    )


async def audit_assets(router: ModelRouter, conn_factory: Any, asset_ids: list[str]) -> dict[str, Any]:
    """Fact Guard L3 for the current revisions of the given assets (one batched LLM call).

    The LLM call happens outside any DB transaction.
    """
    async with conn_factory() as conn:
        rows = await fetch_all(
            conn,
            """select a.id as asset_id, a.campaign_id, a.channel, a.language, r.id as revision_id,
                      r.rendered, r.validation
               from assets a join asset_revisions r on r.asset_id = a.id and r.n = a.current_revision
               where a.id = any(%s::uuid[])""",
            (asset_ids,),
        )
        if not rows:
            return {"audited": 0}
        campaign = await get_campaign(conn, rows[0]["campaign_id"])
        sheet = await locked_sheet(conn, campaign["id"])
    if sheet is None:
        raise Conflict("Lock the offer facts before auditing copy.")
    items = [{"ref": str(r["asset_id"]), "language": r["language"], "channel": r["channel"],
              "rendered": r["rendered"]} for r in rows]
    try:
        l3, translations = await audit_mod.audit(router, items, sheet, campaign.get("intent"))
        l3_failed = False
    except (ProviderError, ValueError) as e:  # includes NoProviderAvailable; the assets stay unaudited
        l3, translations, l3_failed = {}, {}, str(e)

    results = {}
    async with conn_factory() as conn:
        for r in rows:
            ref = str(r["asset_id"])
            v = dict(r["validation"])
            v["checks"] = [c for c in v["checks"] if c["layer"] != "L3"]
            if l3_failed:
                v["l3"] = "pending"  # verifier unreachable: stays unapprovable until audited
            else:
                l3_checks: list[Check] = l3[ref]
                # a re-run replaces the previous meaning check instead of piling up on it
                v["checks"] = [c for c in v["checks"] if c["layer"] != "L3"] + [asdict(c) for c in l3_checks]
                l3_ok = all(c.passed for c in l3_checks)
                v["l3"] = "passed" if l3_ok else "failed"
                v["back_translation"] = translations.get(ref)
                v["passed"] = all(c["passed"] for c in v["checks"] if c["severity"] == "block")
            await conn.execute("update asset_revisions set validation = %s where id = %s",
                               (jsonb(v), r["revision_id"]))
            await conn.execute(
                """update assets set status = %s, updated_at = now()
                   where id = %s and status in ('valid', 'invalid')""",
                ("valid" if v["passed"] else "invalid", r["asset_id"]),
            )
            results[ref] = {"passed": v["passed"], "l3": v["l3"]}
        await ledger.record(conn, campaign["business_id"], "assets.audited",
                            f"Semantic audit: {sum(x['passed'] for x in results.values())}/{len(results)} passed"
                            if not l3_failed else "Semantic audit unavailable; assets stay pending",
                            actor="agent", campaign_id=campaign["id"], payload=results)
    return {"audited": len(results), "results": results}


def approvable(validation: dict[str, Any] | None, locked_version: int | None) -> str | None:
    """Return why a revision cannot be approved, or None if it can."""
    if not validation:
        return "This version has not been checked yet."
    if locked_version is None or validation.get("facts_version") != locked_version:
        return "Written against older offer facts; update it first."
    if not validation.get("passed"):
        return "It failed the fact guard."
    l3 = str(validation.get("l3", ""))
    if l3 == "pending":
        return "The meaning check is still running."
    if l3 == "failed":
        return "The meaning check found promises that are not in the offer facts."
    return None


async def approve_asset(conn: Conn, asset_id: UUID | str, *, actor: ledger.Actor) -> dict[str, Any]:
    asset = await get_asset(conn, asset_id)
    rev = await current_revision(conn, asset_id)
    sheet = await locked_sheet(conn, asset["campaign_id"])
    if why := approvable(rev["validation"] if rev else None, sheet.version if sheet else None):
        raise Conflict(why)
    row = await fetch_one(conn, "update assets set status = 'approved', updated_at = now() where id = %s returning *",
                          (asset_id,))
    campaign = await get_campaign(conn, asset["campaign_id"])
    await ledger.record(conn, campaign["business_id"], "asset.approved",
                        f"Approved the {asset_label(asset)}",
                        actor=actor, campaign_id=campaign["id"], payload={"asset_id": str(asset_id)})
    return row  # type: ignore[return-value]


# ------------------------------------------------------------------ attribution

_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


async def issue_touchpoint(conn: Conn, asset: dict[str, Any], *, kind: str = "qr") -> dict[str, Any]:
    existing = await fetch_one(conn, "select * from touchpoints where asset_id = %s and kind = %s",
                               (asset["id"], kind))
    if existing:
        return existing
    for _ in range(5):
        code = "".join(secrets.choice(_ALPHABET) for _ in range(6))
        row = await fetch_one(
            conn,
            """insert into touchpoints (code, campaign_id, asset_id, kind) values (%s, %s, %s, %s)
               on conflict (code) do nothing returning *""",
            (code, asset["campaign_id"], asset["id"], kind),
        )
        if row:
            return row
    raise Conflict("could not allocate a touchpoint code")


async def record_outcome(conn: Conn, code: str, type: str, *, source: str, meta: dict | None = None) -> dict[str, Any]:
    tp = await fetch_one(conn, "select * from touchpoints where code = %s", (code.upper(),))
    if not tp:
        raise NotFound("unknown code")
    await conn.execute(
        """insert into outcome_events (campaign_id, asset_id, touchpoint_code, type, source, meta)
           values (%s, %s, %s, %s, %s, %s)""",
        (tp["campaign_id"], tp["asset_id"], tp["code"], type, source, jsonb(meta or {})),
    )
    campaign = await get_campaign(conn, tp["campaign_id"])
    await ledger.record(conn, campaign["business_id"], f"outcome.{type}", f"{type.title()} via {tp['code']}",
                        actor="customer" if source == "live" else "owner", campaign_id=campaign["id"],
                        payload={"code": tp["code"], "asset_id": str(tp["asset_id"]), "source": source})
    return tp


# ------------------------------------------------------------------ experiments


async def experiment_status(conn: Conn, experiment_id: UUID | str) -> dict[str, Any]:
    exp = await fetch_one(conn, "select * from experiments where id = %s", (experiment_id,))
    if not exp:
        raise NotFound("experiment not found")
    arms_rows = await fetch_all(
        conn,
        """select a.id, a.variant, a.channel, a.segment,
                  coalesce(sum(o.qty) filter (where o.type = %s), 0) as trials,
                  coalesce(sum(o.qty) filter (where o.type = %s), 0) as successes
           from assets a left join outcome_events o on o.asset_id = a.id
           where a.experiment_id = %s group by a.id order by a.variant nulls last""",
        (exp["trial_type"], exp["success_type"], experiment_id),
    )
    channels = list({r["channel"] for r in arms_rows})
    campaign = await get_campaign(conn, exp["campaign_id"])
    history = await fetch_all(
        conn,
        """select coalesce(sum(o.qty) filter (where o.type = %s), 0) as s,
                  coalesce(sum(o.qty) filter (where o.type = %s), 0) as t
           from campaigns c join assets a on a.campaign_id = c.id
           left join outcome_events o on o.asset_id = a.id
           where c.business_id = %s and c.is_historical and a.channel = any(%s) group by a.id""",
        (exp["success_type"], exp["trial_type"], campaign["business_id"], channels),
    )
    pa, pb = prior_from_history([(int(h["s"]), int(h["t"])) for h in history], strength=10)
    arms = [Arm(str(r["id"]), int(r["successes"]), int(r["trials"]), pa, pb) for r in arms_rows]
    d = decide(arms, min_trials=MIN_TRIALS, loss_threshold=LOSS_THRESHOLD)
    return {
        "experiment": exp,
        "prior": {"alpha": round(pa, 3), "beta": round(pb, 3), "from_campaign_assets": len(history)},
        "arms": [{"asset_id": str(r["id"]), "variant": r["variant"], **d.summary.get(str(r["id"]), {})}
                 for r in arms_rows],
        "decision": {"winner": d.winner, "reason": d.reason, "min_trials": MIN_TRIALS, "loss_threshold": LOSS_THRESHOLD},
    }
