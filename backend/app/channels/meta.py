"""The one place that talks to Meta's Graph API. Tests replace `graph` with a fake."""

from typing import Any

import httpx

from app.config import get_settings

FB = "https://graph.facebook.com"  # WhatsApp Cloud API
IG = "https://graph.instagram.com"  # Instagram API with Instagram Login


class MetaError(Exception):
    """Meta refused or failed. The message is Meta's own, safe to show the owner (it never contains the token)."""


def url(host: str, path: str) -> str:
    return f"{host}/{get_settings().meta_graph_version}/{path.lstrip('/')}"


async def graph(method: str, full_url: str, *, token: str, params: dict[str, Any] | None = None,
                json: dict[str, Any] | None = None, bearer: bool = True) -> dict[str, Any]:
    params = dict(params or {})
    headers = {"Authorization": f"Bearer {token}"} if bearer else {}
    if not bearer:
        params["access_token"] = token
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.request(method, full_url, params=params, json=json, headers=headers)
    try:
        data = r.json()
    except ValueError:
        data = {}
    if r.status_code >= 400 or (isinstance(data, dict) and "error" in data):
        err = data.get("error", {}) if isinstance(data, dict) else {}
        raise MetaError(err.get("error_user_msg") or err.get("message") or f"Meta answered {r.status_code}.")
    return data
