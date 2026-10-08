"""Put the Supabase database password into DATABASE_URL in backend/.env, then test the connection.

    uv run python -m scripts.set_db_password

The password is typed hidden, URL-encoded (so any characters work) and never printed.
"""

import getpass
import re
from pathlib import Path
from urllib.parse import quote, urlsplit

import psycopg

ENV = Path(__file__).resolve().parents[1] / ".env"


def main() -> None:
    lines = ENV.read_text().splitlines()
    idx = next((i for i, line in enumerate(lines) if line.startswith("DATABASE_URL=")), None)
    if idx is None or "pooler.supabase.com" not in lines[idx]:
        raise SystemExit("backend/.env has no Supabase session pooler DATABASE_URL. See docs/SETUP.md step 2b.")
    url = lines[idx].split("=", 1)[1].strip().strip("\"'")
    parts = urlsplit(url)

    password = getpass.getpass("Supabase database password (hidden): ").strip()
    if not password:
        raise SystemExit("No password entered; nothing changed.")
    netloc = f"{parts.username}:{quote(password, safe='')}@{parts.hostname}:{parts.port or 5432}"
    new_url = parts._replace(netloc=netloc).geturl()

    try:
        with psycopg.connect(new_url, connect_timeout=15, prepare_threshold=None) as conn:
            conn.execute("select 1")
    except psycopg.OperationalError as e:
        reason = "wrong password" if "password authentication failed" in str(e) else re.sub(r"\S+@\S+", "", str(e))[:200]
        raise SystemExit(f"Could not connect ({reason}). backend/.env was not changed.") from None

    lines[idx] = f"DATABASE_URL={new_url}"
    ENV.write_text("\n".join(lines) + "\n")
    print("Connected to Supabase. Saved to backend/.env.")


if __name__ == "__main__":
    main()
