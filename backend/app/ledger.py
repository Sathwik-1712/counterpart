"""Append-only business ledger plus an in-process fan-out for live UI updates."""

import asyncio
from typing import Any, Literal
from uuid import UUID

from app.db import Conn, fetch_one, jsonb

Actor = Literal["owner", "agent", "system", "customer"]

_subscribers: set[asyncio.Queue[dict[str, Any]]] = set()


async def record(
    conn: Conn,
    business_id: UUID | str,
    type: str,
    summary: str,
    *,
    actor: Actor = "system",
    campaign_id: UUID | str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    row = await fetch_one(
        conn,
        """insert into ledger_events (business_id, campaign_id, actor, type, summary, payload)
           values (%s, %s, %s, %s, %s, %s)
           returning id, business_id, campaign_id, actor, type, summary, payload, created_at""",
        (business_id, campaign_id, actor, type, summary, jsonb(payload or {})),
    )
    assert row is not None
    # Published before commit; subscribers only render it, the DB stays the source of truth.
    for q in list(_subscribers):
        if q.full():
            continue
        q.put_nowait(row)
    return row


def subscribe() -> asyncio.Queue[dict[str, Any]]:
    q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=500)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue[dict[str, Any]]) -> None:
    _subscribers.discard(q)
