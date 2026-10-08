"""Apply supabase/migrations/*.sql in order. Works against Supabase or any Postgres.

    uv run python -m scripts.migrate            # uses DATABASE_URL
    uv run python -m scripts.migrate --reset    # drop everything first (local/dev only)

The same files also work with `supabase db push` if you prefer the Supabase CLI.
"""

import argparse
import asyncio
from pathlib import Path

import psycopg

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"

RESET_SQL = """
drop table if exists business_photos, memberships, ledger_events, inbox_items, memories, outcome_events, touchpoints, asset_revisions,
  assets, experiments, customer_insights, customer_interactions, offer_facts, campaigns, brand_dna,
  businesses, _counterpart_migrations cascade;
drop function if exists offer_facts_guard() cascade;
"""


async def migrate(dsn: str, *, reset: bool = False) -> list[str]:
    applied: list[str] = []
    async with await psycopg.AsyncConnection.connect(dsn, prepare_threshold=None) as conn:
        if reset:
            await conn.execute(RESET_SQL)
        await conn.execute("""create table if not exists _counterpart_migrations (
                                name text primary key, applied_at timestamptz not null default now())""")
        await conn.execute("alter table _counterpart_migrations enable row level security")
        done = {r[0] for r in await (await conn.execute("select name from _counterpart_migrations")).fetchall()}
        for f in sorted(MIGRATIONS.glob("*.sql")):
            if f.name in done:
                continue
            async with conn.transaction():
                await conn.execute(f.read_text())
                await conn.execute("insert into _counterpart_migrations (name) values (%s)", (f.name,))
            applied.append(f.name)
        await conn.commit()
    return applied


if __name__ == "__main__":
    from app.config import get_settings  # reads DATABASE_URL from env or backend/.env

    p = argparse.ArgumentParser()
    p.add_argument("--reset", action="store_true", help="drop all Counterpart tables first")
    a = p.parse_args()
    names = asyncio.run(migrate(get_settings().database_url, reset=a.reset))
    print("applied:", ", ".join(names) or "nothing (up to date)")
