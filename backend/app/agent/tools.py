"""Agent tool catalog.

Each tool declares an effect class. The policy layer (runtime.execute) uses it:
  read / internal     -> runs immediately
  customer_facing     -> queued as an owner approval unless already approved
  fact                -> queued as an owner approval unless already approved
Preconditions run before anything else and explain themselves to the agent.
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, Field

from app import ledger, services
from app.agent import situation
from app.agent.prompts import GENERATION_SYSTEM
from app.config import Settings
from app.db import connection, fetch_all, fetch_one, jsonb
from app.domain.economics import offer_economics
from app.domain.facts import AssetContent
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
    return None if draft else "There is no facts draft to lock. Call draft_offer_facts or revise_offer_facts first."


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
    display: dict[str, str] = Field(description="Exact customer-facing wording per language code (en, kn, hi).")
    required: bool = True


class DraftFactsArgs(BaseModel):
    facts: list[FactIn] = Field(min_length=1)
    forbidden_claims: dict[str, list[str]] = Field(
        default_factory=dict, description="Phrases that must never appear, per language (e.g. 'free', 'all day').")
    reason: str | None = None


@tool("draft_offer_facts", "Write the offer down as structured facts with per-language wording. "
      "The owner reviews and locks them.", DraftFactsArgs, "internal", [needs_campaign])
async def draft_offer_facts(ctx: ToolContext, a: DraftFactsArgs) -> dict[str, Any]:
    async with connection() as conn:
        campaign = await services.get_campaign(conn, ctx.campaign_id)  # type: ignore[arg-type]
        row = await services.save_draft_facts(conn, campaign, facts=[f.model_dump() for f in a.facts],
                                              forbidden_claims=a.forbidden_claims, reason=a.reason, actor=ctx.actor)
    return {"draft_version": row["version"]}


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
    return {"draft_version": row["version"], "changed": [p.key for p in a.changes]}


class LockArgs(BaseModel):
    summary: str = Field(description="One line for the owner: what the offer is and anything they should check.")


@tool("lock_facts", "Lock the drafted offer facts so all copy uses them. Needs the owner.", LockArgs, "fact",
      [needs_draft_facts])
async def lock_facts(ctx: ToolContext, a: LockArgs) -> dict[str, Any]:
    async with connection() as conn:
        campaign = await services.get_campaign(conn, ctx.campaign_id)  # type: ignore[arg-type]
        res = await services.lock_facts(conn, campaign, actor=ctx.actor)
    return {"locked_version": res["facts"]["version"], "changed": res["changed"], "stale_assets": res["stale_assets"]}


# ------------------------------------------------------------------ plan


class PlanArgs(BaseModel):
    goal: dict[str, Any] = Field(description="{statement, kpi: {metric, target, window_days}}")
    plan: dict[str, Any] = Field(description="{cells: [{segment, channel, language, rationale}], hypotheses: [...]}")
    intent: dict[str, Any] = Field(description="{core_message, cta, must_say, must_not_say, tone}")


@tool("set_campaign_plan", "Save the goal, the audience × channel × language plan and the intent contract.",
      PlanArgs, "internal", [needs_campaign])
async def set_campaign_plan(ctx: ToolContext, a: PlanArgs) -> dict[str, Any]:
    async with connection() as conn:
        c = await services.update_campaign_plan(conn, ctx.campaign_id,  # type: ignore[arg-type]
                                                goal=a.goal, plan=a.plan, intent=a.intent)
        await ledger.record(conn, ctx.business["id"], "campaign.planned",
                            f"Plan saved: {len(a.plan.get('cells', []))} audience/channel/language cells",
                            actor=ctx.actor, campaign_id=c["id"], payload={"plan": a.plan})
    return {"status": c["status"]}


# ------------------------------------------------------------------ generation


class Cell(BaseModel):
    segment: str
    channel: Channel
    language: Language
    variant: str | None = Field(None, description="'A'/'B' when this cell is an experiment arm.")
    angle: str = Field(description="The idea or hook this piece leads with.")
    asset_id: str | None = Field(None, description="Set to rewrite an existing (stale/invalid) asset.")


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
    facts_text = "\n".join(
        f"- {{{{{f.key}}}}}: {f.label} — means “{f.display.get('en', '')}”" + (" (required)" if f.required else "")
        for f in sheet.facts)
    system = GENERATION_SYSTEM.format(
        business_name=ctx.business["name"], locality=ctx.business["locality"], city=ctx.business["city"],
        brand=json.dumps(brand["dna"] if brand else {}, ensure_ascii=False),
        facts=facts_text, intent=json.dumps(campaign.get("intent") or {}, ensure_ascii=False),
        insights=json.dumps([{"id": f"insight:theme:{t['theme']}", "theme": t["theme"], "mentions": t["recent"] + t["previous"],
                              "sentiment": t["sentiment"], "quotes": t["quotes"]} for t in themes[:8]],
                            ensure_ascii=False, default=str),
        learnings=json.dumps([{"id": f"learning:{r['id']}", "text": r["content"]} for r in learnings],
                             ensure_ascii=False, default=str),
        required=", ".join(f"{{{{{f.key}}}}}" for f in sheet.facts if f.required),
    )
    cells = []
    for i, c in enumerate(a.cells):
        src = existing.get(c.asset_id) if c.asset_id else None
        cells.append({"cell": i, "segment": src["segment"] if src else c.segment,
                      "channel": src["channel"] if src else c.channel,
                      "language": src["language"] if src else c.language,
                      "variant": c.variant, "angle": c.angle})

    # 2. model call (no transaction held)
    out, res = await ctx.router.chat_json(
        "generation",
        [{"role": "system", "content": system},
         {"role": "user", "content": json.dumps({"write_these": cells}, ensure_ascii=False)}],
        GenerationOut, temperature=0.7,
    )

    # 3. store + guard (one transaction)
    created = []
    async with connection() as conn:
        for g in out.assets:
            if g.cell >= len(cells):
                continue
            spec = cells[g.cell]
            asset = existing.get(a.cells[g.cell].asset_id or "") or await services.create_asset(
                conn, campaign["id"], segment=spec["segment"], channel=spec["channel"],
                language=spec["language"], variant=spec["variant"])
            rev = await services.add_revision(
                conn, asset, g.content, created_by="agent", reason=f"angle: {spec['angle']}",
                verifier_available=ctx.router.available("verification"),
                features=g.features.model_dump() | {"angle": spec["angle"]})
            created.append({"asset_id": str(asset["id"]), "channel": spec["channel"], "language": spec["language"],
                            "status": rev["asset_status"],
                            "blocked_by": [c["detail"] for c in rev["validation"]["checks"]
                                           if not c["passed"] and c["severity"] == "block"]})
    return {"assets": created, "model": res.model, "saved_output": res.replayed}


class AssetIds(BaseModel):
    asset_ids: list[str] = Field(min_length=1)


@tool("validate_assets", "Run the meaning check (back-translation + every customer promise vs the facts) "
      "on assets that passed the deterministic guard.", AssetIds, "internal", [needs_locked_facts])
async def validate_assets(ctx: ToolContext, a: AssetIds) -> dict[str, Any]:
    return await services.audit_assets(ctx.router, connection, a.asset_ids)


RATIOS = {"poster": "3:4", "instagram_post": "1:1", "instagram_story": "9:16", "whatsapp": "1:1"}


class VisualArgs(BaseModel):
    asset_id: str
    concept: str = Field(description="What the picture shows. No text, letters or numbers will be drawn.")


@tool("generate_visual", "Create the background picture for an asset. Offer text is overlaid exactly by the "
      "system, never drawn by the image model.", VisualArgs, "internal", [needs_locked_facts])
async def generate_visual(ctx: ToolContext, a: VisualArgs) -> dict[str, Any]:
    from app.storage import get_storage

    async with connection() as conn:
        asset = await services.get_asset(conn, a.asset_id)
        brand = await services.active_brand(conn, ctx.business["id"])
    palette = ", ".join((brand or {}).get("dna", {}).get("palette", [])) if brand else ""
    prompt = (f"{a.concept}. Photographic, warm natural light, {ctx.business['locality']} {ctx.business['city']} "
              f"neighbourhood café feel. Colour accents: {palette}. Leave calm empty space in the upper third for a "
              "headline. Absolutely no text, letters, numbers, logos or watermarks.")
    img = await ctx.router.image(prompt, size="1K", ratio=RATIOS[asset["channel"]])
    ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(img.mime, "bin")
    key = await get_storage().put(f"{ctx.business['slug']}/{a.asset_id}/{asset['current_revision']}.{ext}",
                                  img.data, img.mime)
    async with connection() as conn:
        await conn.execute(
            "update asset_revisions set image_key = %s where asset_id = %s and n = %s",
            (key, a.asset_id, asset["current_revision"]))
        await ledger.record(conn, ctx.business["id"], "asset.visual", f"Made a new picture for the {services.asset_label(asset)}",
                            actor=ctx.actor, campaign_id=ctx.campaign_id,
                            payload={"asset_id": a.asset_id, "image_key": key, "saved_output": img.replayed})
    return {"image_key": key, "saved_output": img.replayed}


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
