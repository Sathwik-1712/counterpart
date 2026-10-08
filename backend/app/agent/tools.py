"""Agent tool catalog.

Each tool declares an effect class. The policy layer (runtime.execute) uses it:
  read / internal     -> runs immediately
  customer_facing     -> queued as an owner approval unless already approved
  fact                -> queued as an owner approval unless already approved
Preconditions run before anything else and explain themselves to the agent.
"""

import asyncio
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app import ledger, services
from app.agent import situation
from app.agent.prompts import GENERATION_SYSTEM
from app.config import Settings
from app.db import connection, fetch_all, fetch_one, jsonb
from app.domain.audit import intent_for_copy
from app.domain.economics import offer_economics
from app.domain.facts import CHANNEL_LIMITS, AssetContent
from app.providers.base import ProviderError
from app.providers.router import ModelRouter

Effect = Literal["read", "internal", "customer_facing", "fact"]
Channel = Literal["instagram_post", "instagram_story", "whatsapp", "poster"]
Language = Literal["en", "kn", "hi"]


@dataclass
class ToolContext:
    business: dict[str, Any]
    campaign_id: str | None
    router: ModelRouter
    settings: Settings
    actor: ledger.Actor = "agent"
    approved: bool = False  # set when the owner approved this exact call


Precondition = Callable[[ToolContext, Any], Awaitable[str | None]]


@dataclass
class Tool:
    name: str
    description: str
    args: type[BaseModel]
    effect: Effect
    handler: Callable[[ToolContext, Any], Awaitable[dict[str, Any]]]
    preconditions: list[Precondition] = field(default_factory=list)

    def schema(self) -> dict[str, Any]:
        return {"type": "function",
                "function": {"name": self.name, "description": self.description,
                             "parameters": self.args.model_json_schema()}}


REGISTRY: dict[str, Tool] = {}


def tool(name: str, description: str, args: type[BaseModel], effect: Effect,
         preconditions: list[Precondition] | None = None):
    def wrap(fn: Callable[[ToolContext, Any], Awaitable[dict[str, Any]]]):
        REGISTRY[name] = Tool(name, description, args, effect, fn, preconditions or [])
        return fn
    return wrap


def schemas() -> list[dict[str, Any]]:
    return [t.schema() for t in REGISTRY.values()]


# ------------------------------------------------------------------ preconditions


async def needs_campaign(ctx: ToolContext, _: Any) -> str | None:
    return None if ctx.campaign_id else "No campaign is selected."


async def needs_locked_facts(ctx: ToolContext, _: Any) -> str | None:
    if not ctx.campaign_id:
        return "No campaign is selected."
    async with connection() as conn:
        sheet = await services.locked_sheet(conn, ctx.campaign_id)
    return None if sheet else "Offer facts are not locked yet. Draft them and call lock_facts."


async def needs_draft_facts(ctx: ToolContext, _: Any) -> str | None:
    async with connection() as conn:
        draft = await services.facts_row(conn, ctx.campaign_id, "draft") if ctx.campaign_id else None
    if not draft:
        return "There is no facts draft to lock. Call draft_offer_facts or revise_offer_facts first."
    if (draft.get("wording_check") or {}).get("status") == "failed":
        return ("The translated wording does not match the English; correct it with draft_offer_facts first: "
                + services.wording_issue_text(draft["wording_check"]["issues"]))
    return None


class NoArgs(BaseModel):
    pass


# ------------------------------------------------------------------ read tools


@tool("get_situation", "Current campaign state, pending owner items and prioritised findings.", NoArgs, "read")
async def get_situation(ctx: ToolContext, _: NoArgs) -> dict[str, Any]:
    async with connection() as conn:
        return await situation.snapshot(conn, ctx.business, ctx.campaign_id)


class ThemesArgs(BaseModel):
    days: int = Field(14, ge=7, le=90, description="Window size; compared with the window before it.")


@tool("get_customer_themes", "What customers talk about: theme counts now vs before, sentiment, quotes with ids.",
      ThemesArgs, "read")
async def get_customer_themes(ctx: ToolContext, a: ThemesArgs) -> dict[str, Any]:
    async with connection() as conn:
        themes = await situation.theme_trends(conn, ctx.business["id"], days=a.days)
        segments = await fetch_all(
            conn, "select key, data from customer_insights where business_id = %s and kind in ('segment', 'event')",
            (ctx.business["id"],))
    return {"themes": themes[:12], "segments_and_events": segments}


@tool("get_brand_and_learnings", "Active brand voice and the learnings from past campaigns.", NoArgs, "read")
async def get_brand_and_learnings(ctx: ToolContext, _: NoArgs) -> dict[str, Any]:
    async with connection() as conn:
        brand = await services.active_brand(conn, ctx.business["id"])
        learnings = await fetch_all(
            conn,
            """select id, content, scope, confidence from memories
               where business_id = %s and kind in ('learning', 'brand_rule') and status = 'active'
               order by created_at desc limit 20""",
            (ctx.business["id"],))
    return {"brand": brand and {"version": brand["version"], "dna": brand["dna"]}, "learnings": learnings}


class OfferArgs(BaseModel):
    item_names: list[str] = Field(min_length=1, description="Menu items in one redemption, e.g. a combo.")
    discount_pct: float = Field(0, ge=0, le=100)
    flat_off: float = Field(0, ge=0)


@tool("evaluate_offer", "Margin and break-even check of a discount using the real menu costs.", OfferArgs, "read")
async def evaluate_offer(ctx: ToolContext, a: OfferArgs) -> dict[str, Any]:
    menu = {m["name"].lower(): m for m in ctx.business["profile"].get("menu", [])}
    missing = [n for n in a.item_names if n.lower() not in menu]
    if missing:
        return {"error": f"Not on the menu: {', '.join(missing)}", "menu": sorted(m["name"] for m in menu.values())}
    return offer_economics([menu[n.lower()] for n in a.item_names], discount_pct=a.discount_pct,
                           flat_off=a.flat_off,
                           baseline_covers=int(ctx.business["profile"].get("baseline_covers_per_window", 40)))


class ExperimentRef(BaseModel):
    experiment_id: str


@tool("experiment_status", "Posterior results of an experiment and whether it can be decided.", ExperimentRef, "read")
async def get_experiment_status(ctx: ToolContext, a: ExperimentRef) -> dict[str, Any]:
    async with connection() as conn:
        return await services.experiment_status(conn, a.experiment_id)


# ------------------------------------------------------------------ facts


class FactIn(BaseModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{1,40}$")
    label: str
    type: Literal["percent", "price", "date_range", "time_range", "item", "condition", "text"]
    value: Any
    display: dict[str, str] = Field(description=(
        "Exact customer-facing wording per language code (en, kn, hi). It is inserted mid-sentence, so write a "
        "short phrase, not a sentence or label: lowercase start (except names), no full stop, no 'Label:' prefix. "
        "Good: '15% off', 'haircut + beard trim', '4 to 7 pm', 'Monday to Friday', 'with a valid college ID'."))
    required: bool = True


class DraftFactsArgs(BaseModel):
    facts: list[FactIn] = Field(min_length=1)
    forbidden_claims: dict[str, list[str]] = Field(
        default_factory=dict, description="Phrases that must never appear, per language (e.g. 'free', 'all day').")
    reason: str | None = None


async def _wording(ctx: ToolContext) -> dict[str, Any] | None:
    check = await services.check_fact_wording(ctx.router, connection, ctx.campaign_id)  # type: ignore[arg-type]
    return check and {"status": check["status"], "issues": check["issues"]}


@tool("draft_offer_facts", "Write the offer down as structured facts with per-language wording. "
      "The owner reviews and locks them.", DraftFactsArgs, "internal", [needs_campaign])
async def draft_offer_facts(ctx: ToolContext, a: DraftFactsArgs) -> dict[str, Any]:
    async with connection() as conn:
        campaign = await services.get_campaign(conn, ctx.campaign_id)  # type: ignore[arg-type]
        row = await services.save_draft_facts(conn, campaign, facts=[f.model_dump() for f in a.facts],
                                              forbidden_claims=a.forbidden_claims, reason=a.reason, actor=ctx.actor)
    return {"draft_version": row["version"], "wording_check": await _wording(ctx)}


class FactPatch(BaseModel):
    key: str
    value: Any | None = None
    display: dict[str, str] | None = None
    required: bool | None = None
    remove: bool = False


class ReviseFactsArgs(BaseModel):
    changes: list[FactPatch] = Field(min_length=1)
    reason: str


@tool("revise_offer_facts", "Start a new facts draft from the locked version with changes (e.g. the owner "
      "moved the dates). Then call lock_facts.", ReviseFactsArgs, "internal", [needs_locked_facts])
async def revise_offer_facts(ctx: ToolContext, a: ReviseFactsArgs) -> dict[str, Any]:
    async with connection() as conn:
        campaign = await services.get_campaign(conn, ctx.campaign_id)  # type: ignore[arg-type]
        sheet = await services.locked_sheet(conn, campaign["id"])
        assert sheet
        facts = {f.key: f.model_dump() for f in sheet.facts}
        for p in a.changes:
            if p.remove:
                facts.pop(p.key, None)
                continue
            if p.key not in facts:
                return {"error": f"Unknown fact '{p.key}'. Use draft_offer_facts to add new facts."}
            for attr in ("value", "display", "required"):
                if getattr(p, attr) is not None:
                    facts[p.key][attr] = getattr(p, attr)
        row = await services.save_draft_facts(conn, campaign, facts=list(facts.values()),
                                              forbidden_claims=sheet.forbidden_claims, reason=a.reason,
                                              actor=ctx.actor)
    return {"draft_version": row["version"], "changed": [p.key for p in a.changes], "wording_check": await _wording(ctx)}


class LockArgs(BaseModel):
    summary: str = Field(description="One line for the owner: what the offer is and anything they should check.")


@tool("lock_facts", "Lock the drafted offer facts so all copy uses them. Needs the owner.", LockArgs, "fact",
      [needs_draft_facts])
async def lock_facts(ctx: ToolContext, a: LockArgs) -> dict[str, Any]:
    await services.check_fact_wording(ctx.router, connection, ctx.campaign_id)  # type: ignore[arg-type]
    async with connection() as conn:
        campaign = await services.get_campaign(conn, ctx.campaign_id)  # type: ignore[arg-type]
        res = await services.lock_facts(conn, campaign, actor=ctx.actor)
    return {"locked_version": res["facts"]["version"], "changed": res["changed"], "stale_assets": res["stale_assets"]}


# ------------------------------------------------------------------ plan


class PlanArgs(BaseModel):
    name: str = Field(description="Short campaign name for the owner, 2-5 words, e.g. 'Midterm study break'.")
    goal: dict[str, Any] = Field(description="{statement, kpi: {metric, target, window_days}}")
    plan: dict[str, Any] = Field(description="{cells: [{segment, channel, language, rationale}], hypotheses: [...]}")
    intent: dict[str, Any] = Field(description="{core_message, must_say, must_not_say, tone}. No call to action: "
                                   "the system always adds 'Show this at the counter'.")


@tool("set_campaign_plan", "Save the goal, the audience × channel × language plan and the intent contract.",
      PlanArgs, "internal", [needs_campaign])
async def set_campaign_plan(ctx: ToolContext, a: PlanArgs) -> dict[str, Any]:
    async with connection() as conn:
        c = await services.update_campaign_plan(conn, ctx.campaign_id,  # type: ignore[arg-type]
                                                goal=a.goal, plan=a.plan, intent=intent_for_copy(a.intent), name=a.name)
        await ledger.record(conn, ctx.business["id"], "campaign.planned",
                            f"Plan saved: {len(a.plan.get('cells', []))} audience/channel/language cells",
                            actor=ctx.actor, campaign_id=c["id"], payload={"plan": a.plan})
    return {"status": c["status"]}


# ------------------------------------------------------------------ generation


class Cell(BaseModel):
    segment: str | None = None
    channel: Channel | None = None
    language: Language | None = None
    variant: str | None = Field(None, description="'A'/'B' when this cell is an experiment arm.")
    angle: str = Field(description="The idea or hook this piece leads with.")
    asset_id: str | None = Field(None, description="Set to rewrite an existing (stale/invalid) asset; segment, "
                                                   "channel and language then come from it.")

    @model_validator(mode="after")
    def _new_cells_are_complete(self) -> "Cell":
        if not self.asset_id and not (self.segment and self.channel and self.language):
            raise ValueError("a new cell needs segment, channel and language (or asset_id to rewrite one)")
        return self


class GenerateArgs(BaseModel):
    cells: list[Cell] = Field(min_length=1, max_length=12)


class CopyFeatures(BaseModel):
    hook: Literal["nostalgia", "urgency", "value", "community", "novelty", "quality", "convenience", "other"]
    cta_strength: int = Field(ge=1, le=3)
    tone: str


class Generated(BaseModel):
    cell: int
    content: AssetContent
    features: CopyFeatures


class GenerationOut(BaseModel):
    assets: list[Generated]


@tool("generate_copy", "Write copy for several cells in one batch. Offer details go in as fact slots; "
      "every piece is checked by the fact guard.", GenerateArgs, "internal", [needs_locked_facts])
async def generate_copy(ctx: ToolContext, a: GenerateArgs) -> dict[str, Any]:
    # 1. read context (short transaction)
    async with connection() as conn:
        campaign = await services.get_campaign(conn, ctx.campaign_id)  # type: ignore[arg-type]
        sheet = await services.locked_sheet(conn, campaign["id"])
        brand = await services.active_brand(conn, ctx.business["id"])
        themes = await situation.theme_trends(conn, ctx.business["id"], days=30)
        learnings = await fetch_all(
            conn, """select id, content from memories where business_id = %s and kind = 'learning'
                     and status = 'active' order by created_at desc limit 10""", (ctx.business["id"],))
        existing = {}
        for c in a.cells:
            if c.asset_id:
                existing[c.asset_id] = await services.get_asset(conn, c.asset_id)
    assert sheet
    langs = sorted({c.language for c in a.cells if c.language} | {e["language"] for e in existing.values()})
    facts_text = "\n".join(
        f"- {{{{{f.key}}}}} ({f.label}{', required' if f.required else ''}) is replaced by exactly: "
        + " | ".join(f"{lang}: “{f.display[lang]}”" for lang in langs if lang in f.display)
        for f in sheet.facts)
    system = GENERATION_SYSTEM.format(
        business_name=ctx.business["name"], locality=ctx.business["locality"], city=ctx.business["city"],
        brand=json.dumps(brand["dna"] if brand else {}, ensure_ascii=False),
        facts=facts_text, intent=json.dumps(intent_for_copy(campaign.get("intent")), ensure_ascii=False),
        insights=json.dumps([{"id": f"insight:theme:{t['theme']}", "theme": t["theme"], "mentions": t["recent"] + t["previous"],
                              "sentiment": t["sentiment"], "quotes": t["quotes"]} for t in themes[:8]],
                            ensure_ascii=False, default=str),
        learnings=json.dumps([{"id": f"learning:{r['id']}", "text": r["content"]} for r in learnings],
                             ensure_ascii=False, default=str),
    )
    cells = []
    for i, c in enumerate(a.cells):
        src = existing.get(c.asset_id) if c.asset_id else None
        channel = src["channel"] if src else c.channel
        cells.append({"cell": i, "segment": src["segment"] if src else c.segment, "channel": channel,
                      "language": src["language"] if src else c.language, "variant": c.variant, "angle": c.angle,
                      "max_chars": CHANNEL_LIMITS.get(channel, {})})  # type: ignore[arg-type]

    async def ask(payload: dict[str, Any]) -> tuple[GenerationOut, Any]:  # no transaction held
        return await ctx.router.chat_json(
            "generation",
            [{"role": "system", "content": system},
             {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
            GenerationOut, temperature=0.7)

    assets_by_cell: dict[int, dict[str, Any]] = {}
    written: dict[int, Generated] = {}

    async def store(generated: list[Generated], reason: str) -> dict[int, dict[str, Any]]:
        stored = {}
        async with connection() as conn:
            for g in generated:
                if g.cell >= len(cells):
                    continue
                spec = cells[g.cell]
                asset = assets_by_cell.get(g.cell) or existing.get(a.cells[g.cell].asset_id or "") or \
                    await services.create_asset(conn, campaign["id"], segment=spec["segment"],
                                                channel=spec["channel"], language=spec["language"],
                                                variant=spec["variant"])
                assets_by_cell[g.cell], written[g.cell] = asset, g
                rev = await services.add_revision(
                    conn, asset, g.content, created_by="agent", reason=f"{reason}: {spec['angle']}",
                    verifier_available=ctx.router.available("verification"),
                    features=g.features.model_dump() | {"angle": spec["angle"]})
                stored[g.cell] = {"asset_id": str(asset["id"]), "channel": spec["channel"],
                                  "language": spec["language"], "status": rev["asset_status"],
                                  "blocked_by": [c["detail"] for c in rev["validation"]["checks"]
                                                 if not c["passed"] and c["severity"] == "block"],
                                  "reads_now": rev.get("rendered")}
        return stored

    async def repair(problems: dict[int, list[str]], reason: str) -> None:
        """One rewrite of the given pieces, showing the model its text as customers would read it."""
        fix = [cells[i] | {"your_previous_version": written[i].content.model_dump(),
                           "how_it_reads_after_slots_are_filled": results[i].get("reads_now"), "problems": why}
               for i, why in problems.items()]
        try:
            fixed, _ = await ask({"fix_these": fix, "how": REPAIR_HINT})
        except (ProviderError, ValueError):
            return  # the drafts stay as they are, marked invalid
        for i, r in (await store([g for g in fixed.assets if g.cell in problems], reason)).items():
            results[i] = r | {"first_draft_blocked_by": problems[i]}

    async def meaning_check(cell_ids: list[int]) -> None:
        ids = {results[i]["asset_id"]: i for i in cell_ids if results[i]["status"] == "valid"}
        if not ids:
            return
        audited = (await services.audit_assets(ctx.router, connection, list(ids))).get("results", {})
        async with connection() as conn:
            for asset_id, i in ids.items():
                if asset_id in audited:
                    results[i]["meaning_check"] = audited[asset_id].get("l3")
                    rev = await services.current_revision(conn, asset_id)
                    results[i]["status"] = "valid" if audited[asset_id]["passed"] else "invalid"
                    results[i]["blocked_by"] = [c["detail"] for c in (rev or {}).get("validation", {}).get("checks", [])
                                                if not c["passed"] and c["severity"] == "block"]

    # 2. write, store and guard
    out, res = await ask({"write_these": cells})
    results = await store(out.assets, "angle")
    # 3. rules first: the guard's exact reasons go back once
    if blocked := {i: r["blocked_by"] for i, r in results.items() if r["blocked_by"]}:
        await repair(blocked, "fixed")
    # 4. the meaning check always runs, by the verification model (not the writer); failures get one more rewrite
    await meaning_check(list(results))
    if failed := {i: r["blocked_by"] for i, r in results.items() if r.get("meaning_check") == "failed"}:
        await repair(failed, "reworded")
        await meaning_check(list(failed))
    # 5. every passing picture-led piece gets its picture now, in parallel (the system writes the offer onto it)
    items = " and ".join(f.display.get("en", "") for f in sheet.facts if f.type == "item") or "what the business sells"
    todo = [(i, r) for i, r in results.items() if r["status"] == "valid" and r["channel"] in VISUAL_CHANNELS
            and not (existing.get(a.cells[i].asset_id or "") or {}).get("image_key")]
    pictures = await asyncio.gather(*(make_visual(ctx, r["asset_id"], f"{items}, for {cells[i]['segment']}: "
                                                  f"{cells[i]['angle']}") for i, r in todo), return_exceptions=True)
    for (_, r), pic in zip(todo, pictures, strict=True):
        r["picture"] = (pic.get("source", "made") if isinstance(pic, dict) and "error" not in pic
                        else f"failed: {str(pic.get('error') if isinstance(pic, dict) else pic)[:120]}")
    for r in results.values():
        r.pop("reads_now", None)
    return {"assets": [results[i] for i in sorted(results)], "model": res.model, "saved_output": res.replayed}


VISUAL_CHANNELS = {"instagram_post", "instagram_story", "poster"}


REPAIR_HINT = ("Each piece failed a check for the listed problems. Rewrite it so it passes, keeping the same cell "
               "number, angle and language. how_it_reads_after_slots_are_filled shows what customers would see "
               "(the offer box and call to action are added by the system). Make your headline and body read "
               "naturally; state no offer details yourself (no numbers, days, times, prices or conditions); avoid "
               "forbidden words; stay well under max_chars.")


class AssetIds(BaseModel):
    asset_ids: list[str] = Field(min_length=1)


@tool("validate_assets", "Re-run the meaning check (back-translation + every customer promise vs the facts) "
      "on assets that passed the deterministic guard. generate_copy already runs it once.", AssetIds, "internal", [needs_locked_facts])
async def validate_assets(ctx: ToolContext, a: AssetIds) -> dict[str, Any]:
    out = await services.audit_assets(ctx.router, connection, a.asset_ids)
    # A piece that passes on a later check still needs its picture (generate_copy only adds pictures to
    # pieces that pass first time).
    async with connection() as conn:
        missing = await fetch_all(
            conn, """select a.id, a.segment from assets a join asset_revisions r
                     on r.asset_id = a.id and r.n = a.current_revision
                     where a.id = any(%s::uuid[]) and a.status = 'valid' and a.channel = any(%s)
                     and r.image_key is null""", (a.asset_ids, list(VISUAL_CHANNELS)))
        facts = await services.facts_row(conn, ctx.campaign_id, "locked") if missing else None  # type: ignore[arg-type]
    if missing:
        items = " and ".join(f.get("display", {}).get("en", "") for f in (facts or {}).get("facts", [])
                             if f.get("type") == "item") or "what the business sells"
        pics = await asyncio.gather(*(make_visual(ctx, str(m["id"]), f"{items}, for {m['segment']}") for m in missing),
                                    return_exceptions=True)
        out = {**out, "pictures_added": sum(isinstance(p, dict) and "error" not in p for p in pics)}
    return out


RATIOS = {"poster": "3:4", "instagram_post": "1:1", "instagram_story": "9:16", "whatsapp": "1:1"}


class VisualArgs(BaseModel):
    asset_id: str
    concept: str = Field(description="What the picture shows. No text, letters or numbers will be drawn.")
    replace: bool = Field(False, description="Make a new picture even if the piece already has one.")


@tool("generate_visual", "Create the background picture for an asset. Offer text is overlaid exactly by the "
      "system, never drawn by the image model.", VisualArgs, "internal", [needs_locked_facts])
async def generate_visual(ctx: ToolContext, a: VisualArgs) -> dict[str, Any]:
    if not a.replace:
        async with connection() as conn:
            rev = await services.current_revision(conn, a.asset_id)
        if rev and rev.get("image_key"):  # generate_copy already made one
            return {"image_key": rev["image_key"], "note": "This piece already has a picture; pass replace=true for a new one."}
    return await make_visual(ctx, a.asset_id, a.concept)


_photo_locks: dict[str, asyncio.Lock] = {}


async def make_visual(ctx: ToolContext, asset_id: str, concept: str) -> dict[str, Any]:
    """A real photo of the business when the library has a fitting one; otherwise an AI picture (labelled)."""
    from app import photos
    from app.storage import get_storage

    async with _photo_locks.setdefault(str(ctx.campaign_id), asyncio.Lock()), connection() as conn:
        # one at a time per campaign, so parallel posts see each other's picks and spread over the library
        asset = await services.get_asset(conn, asset_id)
        photo = await photos.choose(conn, ctx.business["id"], asset["campaign_id"], concept)
        if photo:
            await conn.execute("update asset_revisions set image_key = %s where asset_id = %s and n = %s",
                               (photo["image_key"], asset_id, asset["current_revision"]))
            await ledger.record(conn, ctx.business["id"], "asset.visual",
                                f"Picked a photo for the {services.asset_label(asset)}: {photo.get('caption') or 'from your library'}",
                                actor=ctx.actor, campaign_id=ctx.campaign_id,
                                payload={"asset_id": asset_id, "photo_id": str(photo["id"]), "image_key": photo["image_key"]})
            return {"image_key": photo["image_key"], "photo": photo.get("caption"), "source": photo["source"]}
        brand = await services.active_brand(conn, ctx.business["id"])
    if not ctx.settings.ai_picture_fallback:
        return {"error": "No photos of the business yet. Ask the owner to add photos."}
    dna = (brand or {}).get("dna", {})
    prompt = (f"{concept}. {dna.get('imagery', 'Photographic, warm natural light.')} {ctx.business['locality']}, "
              f"{ctx.business['city']}. Colour accents: {', '.join(dna.get('palette', []))}. Keep the lower third "
              "calm and uncluttered for an offer box. Absolutely no text, letters, numbers, logos or watermarks.")
    try:
        img = await asyncio.wait_for(ctx.router.image(prompt, size="1K", ratio=RATIOS[asset["channel"]]),
                                     timeout=ctx.settings.picture_timeout_s)
    except TimeoutError:
        return {"error": "The AI picture took too long. Add photos of the business, or try again later."}
    ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(img.mime, "bin")
    key = await get_storage().put(f"{ctx.business['slug']}/{asset_id}/{asset['current_revision']}.{ext}",
                                  img.data, img.mime)
    async with connection() as conn:
        await conn.execute(
            "update asset_revisions set image_key = %s where asset_id = %s and n = %s",
            (key, asset_id, asset["current_revision"]))
        await ledger.record(conn, ctx.business["id"], "asset.visual", f"Made a new picture for the {services.asset_label(asset)}",
                            actor=ctx.actor, campaign_id=ctx.campaign_id,
                            payload={"asset_id": asset_id, "image_key": key, "saved_output": img.replayed})
    return {"image_key": key, "source": "generated", "saved_output": img.replayed}


# ------------------------------------------------------------------ experiments


class ExperimentArgs(BaseModel):
    asset_ids: list[str] = Field(min_length=2, max_length=4)
    hypothesis: str
    dimension: str = Field(description="The single thing that differs between arms, e.g. 'hook'.")
    trial_type: Literal["impression", "scan", "click", "reply"] = "scan"
    success_type: Literal["click", "reply", "redeem"] = "redeem"


@tool("create_experiment", "Run assets that differ in one thing as competing arms.", ExperimentArgs, "internal",
      [needs_campaign])
async def create_experiment(ctx: ToolContext, a: ExperimentArgs) -> dict[str, Any]:
    async with connection() as conn:
        exp = await fetch_one(
            conn,
            """insert into experiments (campaign_id, hypothesis, dimension, trial_type, success_type, status)
               values (%s, %s, %s, %s, %s, 'running') returning id""",
            (ctx.campaign_id, a.hypothesis, a.dimension, a.trial_type, a.success_type))
        assert exp
        for i, aid in enumerate(a.asset_ids):
            await conn.execute(
                """update assets set experiment_id = %s, variant = coalesce(variant, %s)
                   where id = %s and campaign_id = %s""",
                (exp["id"], "ABCD"[i], aid, ctx.campaign_id))
        await ledger.record(conn, ctx.business["id"], "experiment.created", f"Experiment: {a.hypothesis}",
                            actor=ctx.actor, campaign_id=ctx.campaign_id, payload={"experiment_id": str(exp["id"])})
    return {"experiment_id": str(exp["id"])}


@tool("decide_experiment", "Close an experiment if the statistics support a winner.", ExperimentRef, "internal")
async def decide_experiment(ctx: ToolContext, a: ExperimentRef) -> dict[str, Any]:
    async with connection() as conn:
        st = await services.experiment_status(conn, a.experiment_id)
        if not st["decision"]["winner"]:
            return {"decided": False, "reason": st["decision"]["reason"]}
        await conn.execute(
            "update experiments set status = 'decided', decision = %s, decided_at = now() where id = %s",
            (jsonb({**st["decision"], "arms": st["arms"]}), a.experiment_id))
        await ledger.record(conn, ctx.business["id"], "experiment.decided", st["decision"]["reason"],
                            actor=ctx.actor, campaign_id=st["experiment"]["campaign_id"],
                            payload={"experiment_id": a.experiment_id, "winner": st["decision"]["winner"]})
    return {"decided": True, **st["decision"]}


# ------------------------------------------------------------------ customer-facing


class PublishArgs(BaseModel):
    asset_ids: list[str] = Field(min_length=1)
    summary: str = Field(description="One line for the owner describing what goes out.")


@tool("publish_assets", "Approve and put assets live, issuing a tracking code for each. Needs the owner.",
      PublishArgs, "customer_facing", [needs_locked_facts])
async def publish_assets(ctx: ToolContext, a: PublishArgs) -> dict[str, Any]:
    out = []
    async with connection() as conn:
        for aid in a.asset_ids:
            asset = await services.approve_asset(conn, aid, actor=ctx.actor)
            tp = await services.issue_touchpoint(conn, asset)
            await conn.execute("update assets set status = 'live', updated_at = now() where id = %s", (aid,))
            out.append({"asset_id": aid, "code": tp["code"]})
        # The first live piece starts the campaign.
        await conn.execute(
            "update campaigns set status = 'active' where id = %s and status in ('draft', 'planned')", (ctx.campaign_id,))
        await ledger.record(conn, ctx.business["id"], "assets.published", f"{len(out)} asset(s) went live",
                            actor=ctx.actor, campaign_id=ctx.campaign_id, payload={"assets": out})
    return {"published": out}


# ------------------------------------------------------------------ memory & recommendations


class LearningArgs(BaseModel):
    content: str
    scope: dict[str, str] = Field(default_factory=dict, description="{segment, channel, language, hook}")
    evidence: dict[str, Any] = Field(default_factory=dict)
    confidence: float = Field(ge=0, le=1)


@tool("record_learning", "Remember something the results showed, with evidence, for future campaigns.",
      LearningArgs, "internal")
async def record_learning(ctx: ToolContext, a: LearningArgs) -> dict[str, Any]:
    async with connection() as conn:
        row = await fetch_one(
            conn,
            """insert into memories (business_id, campaign_id, kind, content, scope, evidence, confidence, created_by)
               values (%s, %s, 'learning', %s, %s, %s, %s, 'agent') returning id""",
            (ctx.business["id"], ctx.campaign_id, a.content, jsonb(a.scope), jsonb(a.evidence), a.confidence))
        await ledger.record(conn, ctx.business["id"], "memory.learning", a.content, actor=ctx.actor,
                            campaign_id=ctx.campaign_id)
    return {"learning_id": str(row["id"])}  # type: ignore[index]


class RecommendArgs(BaseModel):
    title: str
    body: str
    evidence: list[str] = Field(default_factory=list)
    expected_impact: str | None = None


@tool("recommend", "Put a recommendation in the owner's inbox (for ideas that are not a single tool call).",
      RecommendArgs, "internal")
async def recommend(ctx: ToolContext, a: RecommendArgs) -> dict[str, Any]:
    async with connection() as conn:
        row = await fetch_one(
            conn,
            """insert into inbox_items (business_id, campaign_id, kind, title, body, payload)
               values (%s, %s, 'recommendation', %s, %s, %s) returning id""",
            (ctx.business["id"], ctx.campaign_id, a.title, a.body,
             jsonb({"evidence": a.evidence, "expected_impact": a.expected_impact})))
    return {"inbox_item_id": str(row["id"])}  # type: ignore[index]
