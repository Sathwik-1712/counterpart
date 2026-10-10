"""Save a secret into backend/.env without it ever appearing on screen or in chat.

    uv run python -m scripts.set_secret SUPABASE_SERVICE_ROLE_KEY
    uv run python -m scripts.set_secret GOOGLE_MAPS_API_KEY
    uv run python -m scripts.set_secret GROQ_API_KEY        (free, no card: console.groq.com > API Keys)
    uv run python -m scripts.set_secret CEREBRAS_API_KEY    (free, no card: cloud.cerebras.ai > API Keys)
    uv run python -m scripts.set_secret GEMINI_API_KEY_2    (a second Google project's key, aistudio.google.com)
    uv run python -m scripts.set_secret SARVAM_API_KEY      (Kannada/Hindi voice and translation, dashboard.sarvam.ai)
    uv run python -m scripts.set_secret META_APP_SECRET     (Meta app > App settings > Basic > App secret)
    uv run python -m scripts.set_secret WHATSAPP_VERIFY_TOKEN (any phrase you choose; type the same into Meta's webhook form)

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
    "GEMINI_API_KEY": "Gemini API key (aistudio.google.com > Get API key)",
    "GEMINI_API_KEY_2": "Gemini API key from a DIFFERENT Google project (same-project keys share one quota)",
    "GROQ_API_KEY": "Groq API key (console.groq.com > API Keys, gsk_...)",
    "CEREBRAS_API_KEY": "Cerebras API key (cloud.cerebras.ai > API Keys, csk-...)",
    "SARVAM_API_KEY": "Sarvam AI API subscription key (dashboard.sarvam.ai > API Keys)",
    "META_APP_SECRET": "Meta app secret (developers.facebook.com > your app > App settings > Basic > App secret)",
    "WHATSAPP_VERIFY_TOKEN": "A phrase of your choice, 8+ characters; type the same one as 'Verify token' in Meta's webhook form",
}
# Free backup providers: (models URL, preferred models best first). The first one the key can use is saved too.
BACKUPS = {
    "GROQ_API_KEY": ("https://api.groq.com/openai/v1/models", "GROQ_MODEL",
                     ["openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct-0905", "llama-3.3-70b-versatile"]),
    "CEREBRAS_API_KEY": ("https://api.cerebras.ai/v1/models", "CEREBRAS_MODEL",
                         ["gpt-oss-120b", "qwen-3-235b-a22b-instruct-2507", "llama-3.3-70b"]),
}
extra: dict[str, str] = {}  # other settings learned while checking the key (the backup model to use)


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
    if name == "META_APP_SECRET":  # Meta cannot check it without the app id; the shape catches copy mistakes
        return None if len(value) == 32 and all(c in "0123456789abcdef" for c in value.lower()) else \
            "an app secret is 32 letters and digits (0-9, a-f); press Show next to App secret and copy all of it"
    if name == "WHATSAPP_VERIFY_TOKEN":
        return None if len(value) >= 8 and " " not in value else "use 8 or more characters, no spaces"
    if name == "SARVAM_API_KEY":
        r = httpx.post("https://api.sarvam.ai/translate", timeout=20, headers={"api-subscription-key": value},
                       json={"input": "Good morning", "source_language_code": "en-IN", "target_language_code": "kn-IN"})
        return None if r.status_code == 200 else f"Sarvam said {r.status_code}: {r.text[:160]}"
    if name.startswith("GEMINI_API_KEY"):
        r = httpx.get("https://generativelanguage.googleapis.com/v1beta/openai/models", timeout=15,
                      headers={"Authorization": f"Bearer {value}"})
        if r.status_code != 200:
            return f"Google said {r.status_code}: {r.text[:160]}"
        first = _env_value("GEMINI_API_KEY")
        if name == "GEMINI_API_KEY_2" and first and first == value:
            return "this is the same key as GEMINI_API_KEY; a backup only helps from a different Google project"
        return None
    if name in BACKUPS:
        url, setting, preferred = BACKUPS[name]
        r = httpx.get(url, headers={"Authorization": f"Bearer {value}"}, timeout=15)
        if r.status_code != 200:
            return f"the service said {r.status_code}: {r.text[:160]}"
        ids = [m["id"] for m in r.json().get("data", [])]
        model = next((m for m in preferred if m in ids), None)
        if not model:
            return f"none of {preferred} is offered to this key (it offers: {', '.join(ids[:12])})"
        extra[setting] = model
        return None
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
    new = {name: value, **extra}
    lines = [line for line in ENV.read_text().splitlines() if line.split("=", 1)[0] not in new]
    lines += [f"{k}={v}" for k, v in new.items()]
    ENV.write_text("\n".join(lines) + "\n")
    print(f"{name} works and is saved to backend/.env" + "".join(f" (using {v})" for v in extra.values())
          + ". Restart the backend to use it.")


if __name__ == "__main__":
    main()
