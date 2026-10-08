"""Save a secret into backend/.env without it ever appearing on screen or in chat.

    uv run python -m scripts.set_secret SUPABASE_SERVICE_ROLE_KEY
    uv run python -m scripts.set_secret GOOGLE_MAPS_API_KEY

The value is typed hidden and checked against the service before it is saved.
"""

import getpass
import sys
from pathlib import Path

import httpx

ENV = Path(__file__).resolve().parents[1] / ".env"
SUPABASE_URL = "https://owstnpcbfihxzmiiiznj.supabase.co"
ALLOWED = {
    "SUPABASE_SERVICE_ROLE_KEY": "Supabase secret key (Dashboard > Project Settings > API Keys > Secret keys, sb_secret_...)",
    "GOOGLE_MAPS_API_KEY": "Google Maps Platform key with 'Places API (New)' enabled",
}


def _env_value(name: str) -> str | None:
    for line in ENV.read_text().splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip().strip("\"'")
    return None


def check(name: str, value: str) -> str | None:
    """Returns a problem description, or None if the key works."""
    if name == "SUPABASE_SERVICE_ROLE_KEY":
        base = _env_value("SUPABASE_URL") or SUPABASE_URL
        headers = {"apikey": value, **({"Authorization": f"Bearer {value}"} if value.startswith("eyJ") else {})}
        r = httpx.get(f"{base}/auth/v1/admin/users", params={"per_page": 1}, headers=headers, timeout=15)
        return None if r.status_code == 200 else f"Supabase said {r.status_code}; check you copied the secret key"
    if name == "GOOGLE_MAPS_API_KEY":
        r = httpx.post("https://places.googleapis.com/v1/places:searchText", timeout=15,
                       headers={"X-Goog-Api-Key": value, "X-Goog-FieldMask": "places.id"},
                       json={"textQuery": "MTR, Lalbagh Road, Bengaluru", "maxResultCount": 1})
        if r.status_code == 200:
            return None
        msg = r.json().get("error", {}).get("message", "")
        hint = ("Enable 'Places API (New)' (not the old 'Places API') in APIs & Services > Library, wait a minute, retry"
                if "has not been used" in msg or "disabled" in msg or "SERVICE_DISABLED" in r.text
                else "Link a billing account to this Google Cloud project (Billing), then retry" if "billing" in msg.lower()
                else "Check the key is copied fully and its API restrictions include 'Places API (New)'"
                if "API key not valid" in msg or "not authorized" in msg.lower() or r.status_code == 403
                else "")
        return f"Google said {r.status_code}: {msg[:160]}" + (f"\n  What to do: {hint}" if hint else "")
    return None


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in ALLOWED:
        raise SystemExit("Usage: uv run python -m scripts.set_secret " + " | ".join(ALLOWED))
    name = sys.argv[1]
    value = getpass.getpass(f"{ALLOWED[name]} (hidden): ").strip()
    if not value:
        raise SystemExit("Nothing entered; nothing changed.")
    if problem := check(name, value):
        raise SystemExit(f"That key did not work ({problem}). backend/.env was not changed.")
    lines = [line for line in ENV.read_text().splitlines() if not line.startswith(f"{name}=")]
    lines.append(f"{name}={value}")
    ENV.write_text("\n".join(lines) + "\n")
    print(f"{name} works and is saved to backend/.env. Restart the backend to use it.")


if __name__ == "__main__":
    main()
