"""Thin async Postgres access. Plain SQL, dict rows, one pool per process."""

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

_pool: AsyncConnectionPool | None = None

Conn = AsyncConnection[dict[str, Any]]


async def _configure(conn: AsyncConnection) -> None:
    # Supabase poolers share server connections between clients, so never keep
    # named prepared statements around.
    conn.prepare_threshold = None


async def open_pool(dsn: str, *, min_size: int = 1, max_size: int = 8) -> AsyncConnectionPool:
    global _pool
    _pool = AsyncConnectionPool(
        dsn,
        min_size=min_size,
        max_size=max_size,
        kwargs={"row_factory": dict_row, "autocommit": False},
        configure=_configure,
        # A laptop sleep or the Supabase pooler's idle timeout silently kills pooled connections; test each one as
        # it is handed out and replace a dead one, instead of failing that request with a 500.
        check=AsyncConnectionPool.check_connection,
        open=False,
    )
    await _pool.open(wait=True)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def connection() -> AsyncIterator[Conn]:
    """A connection inside a transaction: commits on success, rolls back on error."""
    if _pool is None:
        raise RuntimeError("database pool is not open")
    async with _pool.connection() as conn:
        yield conn  # pool.connection() commits/rolls back for us


async def fetch_one(conn: Conn, sql: str, params: Any = None) -> dict[str, Any] | None:
    cur = await conn.execute(sql, params)
    return await cur.fetchone()


async def fetch_all(conn: Conn, sql: str, params: Any = None) -> list[dict[str, Any]]:
    cur = await conn.execute(sql, params)
    return await cur.fetchall()


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)  # UUIDs, datetimes, Decimals from rows


def jsonb(value: Any) -> Jsonb:
    return Jsonb(value, dumps=_dumps)
