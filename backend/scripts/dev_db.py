"""Local Postgres 16 for development without Docker (uses the pgserver dev dependency).

    uv run python -m scripts.dev_db     # starts it (stays running) and prints DATABASE_URL

Production and the demo use Supabase; this is only for working offline.
"""

from pathlib import Path

import pgserver

DATA = Path(__file__).resolve().parents[2] / "data" / "pg"

if __name__ == "__main__":
    DATA.mkdir(parents=True, exist_ok=True)
    srv = pgserver.get_server(DATA, cleanup_mode=None)
    print(srv.get_uri())
