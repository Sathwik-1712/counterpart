"""Agent runtime: policy gate + tool-calling loop + owner decisions.

  trigger -> snapshot (detectors) -> LLM picks tools -> policy gate -> execute -> ledger -> repeat
The loop ends when the model stops calling tools or a budget is reached.
"""

import json
from typing import Any

from pydantic import ValidationError

from app import ledger, services
from app.agent import situation
from app.agent.prompts import AGENT_SYSTEM
from app.agent.tools import REGISTRY, ToolContext, schemas
from app.db import connection, fetch_one, jsonb
from app.providers.router import NoProviderAvailable

GATED = {"customer_facing", "fact"}
_running: set[str] = set()


async def execute(ctx: ToolContext, name: str, raw_args: str | dict[str, Any]) -> dict[str, Any]:
    tool = REGISTRY.get(name)
    if tool is None:
        return {"ok": False, "error": f"Unknown tool '{name}'."}
    try:
        args = (tool.args.model_validate_json(raw_args) if isinstance(raw_args, str)
                else tool.args.model_validate(raw_args))
    except ValidationError as e:
        return {"ok": False, "error": f"Invalid arguments: {e.errors(include_url=False)[:3]}"}

    for pre in tool.preconditions:
        if reason := await pre(ctx, args):
            return {"ok": False, "precondition_failed": reason}

    if tool.effect in GATED and not ctx.approved:
        async with connection() as conn:
            title = getattr(args, "summary", None) or f"Approve: {name.replace('_', ' ')}"
            item = await fetch_one(
                conn,
                """insert into inbox_items (business_id, campaign_id, kind, title, payload, priority)
                   values (%s, %s, 'approval', %s, %s, 1) returning id""",
                (ctx.business["id"], ctx.campaign_id, title,
                 jsonb({"tool": name, "args": args.model_dump(mode="json"), "effect": tool.effect})),
            )
            await ledger.record(conn, ctx.business["id"], "approval.requested", title, actor="agent",
                                campaign_id=ctx.campaign_id, payload={"tool": name, "inbox_item_id": str(item["id"])})  # type: ignore[index]
        return {"ok": False, "queued_for_owner_approval": str(item["id"]),  # type: ignore[index]
                "message": "The owner has been asked. Continue with other work or stop."}

    try:
        result = await tool.handler(ctx, args)
    except (services.Conflict, services.NotFound) as e:
        return {"ok": False, "error": str(e)}
    except NoProviderAvailable as e:
        return {"ok": False, "error": f"Model unavailable: {e}"}
    return {"ok": "error" not in result, **result}


async def run(ctx: ToolContext, trigger: str) -> dict[str, Any]:
    """One agent run. Returns the final message and a step log."""
    key = str(ctx.campaign_id or ctx.business["id"])
    if key in _running:
        return {"status": "busy", "message": "Already working on this."}
    _running.add(key)
    s = ctx.settings
    steps: list[dict[str, Any]] = []
    try:
        async with connection() as conn:
            snap = await situation.snapshot(conn, ctx.business, ctx.campaign_id)
            await ledger.record(conn, ctx.business["id"], "agent.started", f"Started: {trigger}", actor="agent",
                                campaign_id=ctx.campaign_id, payload={"findings": snap["findings"]})
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": AGENT_SYSTEM.format(
                business_name=ctx.business["name"], business_kind=ctx.business["profile"].get("kind", "business"),
                locality=ctx.business["locality"], city=ctx.business["city"], max_llm_calls=s.agent_max_llm_calls)},
            {"role": "user", "content": json.dumps({"trigger": trigger, "situation": snap},
                                                   ensure_ascii=False, default=str)},
        ]
        final = None
        llm_calls = 0
        while llm_calls < s.agent_max_llm_calls and len(steps) < s.agent_max_steps:
            res = await ctx.router.chat("reasoning", messages, tools=schemas(), tool_choice="auto", temperature=0.2)
            llm_calls += 1
            if not res.tool_calls:
                final = (res.content or "").strip()
                break
            messages.append({
                "role": "assistant", "content": res.content or "",
                "tool_calls": [{"id": c.id, "type": "function", "function": {"name": c.name, "arguments": c.arguments}}
                               for c in res.tool_calls]})
            for call in res.tool_calls:
                out = await execute(ctx, call.name, call.arguments)
                steps.append({"tool": call.name, "ok": out.get("ok"), "saved_output": res.replayed})
                async with connection() as conn:
                    await ledger.record(
                        conn, ctx.business["id"], f"tool.{call.name}", _describe(call.name, out), actor="agent",
                        campaign_id=ctx.campaign_id,
                        payload={"args": _safe_json(call.arguments), "result": out, "saved_output": res.replayed})
                messages.append({"role": "tool", "tool_call_id": call.id,
                                 "content": json.dumps(out, ensure_ascii=False, default=str)[:12000]})
        status = "done" if final is not None else "budget_reached"
        final = final or "I paused here because I reached this run's budget."
        async with connection() as conn:
            await ledger.record(conn, ctx.business["id"], "agent.finished", final, actor="agent",
                                campaign_id=ctx.campaign_id, payload={"steps": steps, "llm_calls": llm_calls})
        return {"status": status, "message": final, "steps": steps, "llm_calls": llm_calls}
    except NoProviderAvailable as e:
        async with connection() as conn:
            await ledger.record(conn, ctx.business["id"], "agent.failed", f"Model unavailable: {e}", actor="system",
                                campaign_id=ctx.campaign_id)
        return {"status": "unavailable", "message": str(e), "steps": steps}
    finally:
        _running.discard(key)


async def decide_inbox(ctx: ToolContext, item_id: str, *, approve: bool, note: str | None) -> dict[str, Any]:
    """Owner decision. Approving a gated item executes exactly the stored tool call."""
    async with connection() as conn:
        item = await fetch_one(conn, "select * from inbox_items where id = %s and business_id = %s",
                               (item_id, ctx.business["id"]))
    if not item:
        raise services.NotFound("inbox item not found")
    if item["status"] != "pending":
        raise services.Conflict(f"Already {item['status']}.")

    result: dict[str, Any] | None = None
    tool_name = item["payload"].get("tool")
    if approve and tool_name:
        run_ctx = ToolContext(business=ctx.business, campaign_id=str(item["campaign_id"]) if item["campaign_id"] else None,
                              router=ctx.router, settings=ctx.settings, actor="owner", approved=True)
        result = await execute(run_ctx, tool_name, item["payload"].get("args", {}))
        if not result.get("ok"):
            raise services.Conflict(result.get("error") or result.get("precondition_failed") or "Could not apply.")

    async with connection() as conn:
        await conn.execute(
            "update inbox_items set status = %s, decided_at = now(), decision = %s where id = %s",
            ("approved" if approve else "rejected", jsonb({"note": note, "result": result}), item_id))
        await ledger.record(conn, ctx.business["id"], "approval.decided",
                            f"{'Approved' if approve else 'Declined'}: {item['title']}", actor="owner",
                            campaign_id=item["campaign_id"], payload={"inbox_item_id": item_id, "note": note})
    return {"status": "approved" if approve else "rejected", "result": result}


def _safe_json(s: str) -> Any:
    try:
        return json.loads(s)
    except (TypeError, ValueError):
        return s


def _describe(name: str, out: dict[str, Any]) -> str:
    label = name.replace("_", " ")
    if out.get("queued_for_owner_approval"):
        return f"Asked the owner to approve: {label}"
    if out.get("precondition_failed"):
        return f"Could not {label}: {out['precondition_failed']}"
    if out.get("error"):
        return f"{label.capitalize()} failed: {out['error']}"
    return label.capitalize()
