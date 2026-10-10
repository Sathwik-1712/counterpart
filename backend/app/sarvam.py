"""Sarvam AI, for the two jobs where general LLMs are weakest in Kannada and Hindi.

- Speech to text (`saaras`): the owner speaks a brief in Kannada, Hindi or English.
- Translation (`mayura`): an independent translation of a post or an offer wording into English, made by a
  dedicated translation model rather than the model that wrote it. The checker compares meanings against it.

Optional. Every caller works without a key: voice falls back to the browser, the checker to its own reading.
"""

import asyncio
import re
from typing import Any

import httpx

from app.config import get_settings

LANG = {"en": "en-IN", "kn": "kn-IN", "hi": "hi-IN"}
FROM_CODE = {v: k for k, v in LANG.items()}
MAX_CHARS = 1000  # mayura:v1 per request
MAX_AUDIO = 3 * 1024 * 1024  # the REST endpoint is for clips under 30 seconds


class SarvamError(Exception):
    pass


def available() -> bool:
    return get_settings().sarvam_api_key is not None


def _headers() -> dict[str, str]:
    key = get_settings().sarvam_api_key
    if key is None:
        raise SarvamError("Sarvam is not set up.")
    return {"api-subscription-key": key.get_secret_value()}


def _raise_for(r: httpx.Response) -> None:
    if r.status_code == 200:
        return
    try:
        msg = (r.json().get("error") or {}).get("message") or r.text[:200]
    except ValueError:
        msg = r.text[:200]
    raise SarvamError(f"Sarvam {r.status_code}: {msg}")


async def transcribe(audio: bytes, mime: str, language: str | None) -> dict[str, Any]:
    """Audio clip -> {"transcript", "language"} (language as en/kn/hi when recognised)."""
    if len(audio) > MAX_AUDIO:
        raise SarvamError("That recording is too long. Keep it under 30 seconds.")
    s = get_settings()
    ext = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav"}
    name = f"brief.{ext.get(mime.split(';')[0], 'webm')}"
    data = {"model": s.sarvam_stt_model, "language_code": LANG.get(language or "", "unknown")}
    async with httpx.AsyncClient(timeout=40) as c:
        r = await c.post(f"{s.sarvam_base_url}/speech-to-text", headers=_headers(), data=data,
                         files={"file": (name, audio, mime.split(";")[0] or "audio/webm")})
    _raise_for(r)
    body = r.json()
    code = body.get("language_code") or ""
    return {"transcript": (body.get("transcript") or "").strip(), "language": FROM_CODE.get(code, code or language)}


def _chunks(text: str) -> list[str]:
    """Split on sentence ends so each request stays under the model's character limit."""
    out, cur = [], ""
    for part in re.split(r"(?<=[.!?।\n])\s+", text.strip()):
        while len(part) > MAX_CHARS:
            out.append(part[:MAX_CHARS])
            part = part[MAX_CHARS:]
        if len(cur) + len(part) + 1 > MAX_CHARS and cur:
            out.append(cur)
            cur = ""
        cur = f"{cur} {part}".strip()
    return [*out, cur] if cur else out


async def translate(text: str, source: str, target: str = "en") -> str:
    s = get_settings()
    async with httpx.AsyncClient(timeout=30) as c:
        parts = []
        for chunk in _chunks(text):
            r = await c.post(f"{s.sarvam_base_url}/translate", headers=_headers(), json={
                "input": chunk, "source_language_code": LANG.get(source, "auto"),
                "target_language_code": LANG[target], "model": s.sarvam_translate_model,
                "mode": "formal", "numerals_format": "international",
            })
            _raise_for(r)
            parts.append((r.json().get("translated_text") or "").strip())
    return " ".join(p for p in parts if p)


async def to_english(text: str, language: str) -> str | None:
    """Independent English reading of Kannada or Hindi text, or None (no key, other language, or Sarvam failed)."""
    if not available() or language not in ("kn", "hi") or not text.strip():
        return None
    try:
        return await translate(text, language, "en") or None
    except (SarvamError, httpx.HTTPError):
        return None


async def many_to_english(items: list[tuple[str, str]]) -> list[str | None]:
    """[(text, language)] -> English for each, in parallel (a few at a time to respect rate limits)."""
    sem = asyncio.Semaphore(4)

    async def one(t: str, lang: str) -> str | None:
        async with sem:
            return await to_english(t, lang)

    return list(await asyncio.gather(*(one(t, lang) for t, lang in items)))
