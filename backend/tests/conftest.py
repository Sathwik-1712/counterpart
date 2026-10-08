"""Test harness: a real embedded Postgres 16 (pgserver), the real migrations and seed,
and a scripted LLM in place of Agnes. No network, no API keys."""

import os
import tempfile

import pytest

_PG = None


def _start_pg() -> str:
    global _PG
    import pgserver

    _PG = pgserver.get_server(tempfile.mkdtemp(prefix="counterpart-pg-"), cleanup_mode="stop")
    return _PG.get_uri()


os.environ.setdefault("DATABASE_URL", _start_pg())
os.environ["REPLAY_DIR"] = tempfile.mkdtemp(prefix="counterpart-replay-")
os.environ["STORAGE_DIR"] = tempfile.mkdtemp(prefix="counterpart-storage-")
os.environ.pop("AGNES_API_KEY", None)
os.environ.pop("OWNER_API_TOKEN", None)


@pytest.fixture(scope="session")
async def db():
    from app import db as dbmod
    from app.config import get_settings
    from scripts.migrate import migrate
    from scripts.seed import seed

    dsn = get_settings().database_url
    await migrate(dsn, reset=True)
    info = await seed(dsn)
    await dbmod.open_pool(dsn)
    yield info
    await dbmod.close_pool()


@pytest.fixture
def scripted():
    from tests.fakes import ScriptedLLM

    return ScriptedLLM()


@pytest.fixture
async def client(db, scripted):
    import httpx

    from app.main import app
    from app.providers.replay import ReplayCache
    from app.providers.router import ModelRouter

    app.state.router = ModelRouter(
        llms={"scripted": scripted}, images={},
        roles={"reasoning": ["scripted"], "generation": ["scripted"], "verification": ["scripted"], "image": []},
        replay=ReplayCache(__import__("pathlib").Path(os.environ["REPLAY_DIR"])),
    )
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c
