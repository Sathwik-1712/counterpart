"""Accounts. Supabase Auth owns users and passwords; this module talks to its REST API (GoTrue) and checks that the
signed-in user is a member of the business a request touches.

The browser never holds a token: the Next.js server keeps it in an httpOnly cookie and forwards it here as a
Bearer header. Every owner route depends on `current_user`, then calls `require_member` with the business it is
about to read or change. Unknown and forbidden look the same (404), so business ids do not leak.
"""

import hashlib
import time
from typing import Annotated, Any

import httpx
from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel

from app.config import get_settings
from app.db import Conn, fetch_one
from app.services import NotFound


class User(BaseModel):
    id: str
    email: str | None = None


class AuthError(Exception):
    """A sign-in or sign-up problem the owner can act on (wrong password, email taken)."""


_cache: dict[str, tuple[float, User]] = {}
_TTL = 60.0


def _base() -> str:
    s = get_settings()
    if not s.supabase_url or not s.supabase_publishable_key:
        raise HTTPException(503, "Accounts are not configured on this server (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY).")
    return s.supabase_url.rstrip("/") + "/auth/v1"


def _public_headers() -> dict[str, str]:
    return {"apikey": get_settings().supabase_publishable_key or ""}


def _admin_headers() -> dict[str, str]:
    key = get_settings().supabase_service_role_key
    if key is None:
        raise HTTPException(503, "Sign-up is not configured on this server (SUPABASE_SERVICE_ROLE_KEY).")
    k = key.get_secret_value()
    # New secret keys (sb_secret_...) go only in the apikey header; legacy service_role JWTs also as Bearer.
    return {"apikey": k, **({"Authorization": f"Bearer {k}"} if k.startswith("eyJ") else {})}


def _message(r: httpx.Response) -> str:
    try:
        body = r.json()
    except ValueError:
        return r.text[:200] or f"HTTP {r.status_code}"
    return body.get("msg") or body.get("error_description") or body.get("message") or body.get("error") or str(body)


def _session(body: dict[str, Any]) -> dict[str, Any]:
    return {"access_token": body["access_token"], "refresh_token": body["refresh_token"],
            "expires_in": body.get("expires_in", 3600), "user": {"id": body["user"]["id"], "email": body["user"].get("email")}}


async def sign_in(email: str, password: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(f"{_base()}/token", params={"grant_type": "password"}, headers=_public_headers(),
                         json={"email": email, "password": password})
    if r.status_code >= 400:
        raise AuthError("That email and password don't match an account." if r.status_code in (400, 401)
                        else _message(r))
    return _session(r.json())


async def refresh(refresh_token: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(f"{_base()}/token", params={"grant_type": "refresh_token"}, headers=_public_headers(),
                         json={"refresh_token": refresh_token})
    if r.status_code >= 400:
        raise AuthError("Your session ended. Please sign in again.")
    return _session(r.json())


async def sign_up(email: str, password: str) -> dict[str, Any]:
    """Create a confirmed account through the admin API (no confirmation email to wait for), then sign in."""
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(f"{_base()}/admin/users", headers=_admin_headers(),
                         json={"email": email, "password": password, "email_confirm": True})
    if r.status_code >= 400:
        msg = _message(r)
        if r.status_code == 422 and ("registered" in msg or "exists" in msg):
            raise AuthError("An account with this email already exists. Sign in instead.")
        raise AuthError(msg)
    return await sign_in(email, password)


async def sign_in_or_create(email: str, password: str) -> dict[str, Any]:
    """Sign in, creating the account first if it does not exist (the shared demo login)."""
    try:
        return await sign_in(email, password)
    except AuthError:
        return await sign_up(email, password)


async def sign_out(access_token: str) -> None:
    async with httpx.AsyncClient(timeout=10) as c:
        await c.post(f"{_base()}/logout", headers={**_public_headers(), "Authorization": f"Bearer {access_token}"})


async def current_user(authorization: str | None = Header(default=None)) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in required.")
    token = authorization[7:].strip()
    h = hashlib.sha256(token.encode()).hexdigest()
    if (hit := _cache.get(h)) and hit[0] > time.monotonic():
        return hit[1]
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{_base()}/user", headers={**_public_headers(), "Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        raise HTTPException(401, "Your session ended. Please sign in again.")
    body = r.json()
    user = User(id=body["id"], email=body.get("email"))
    if len(_cache) > 2000:
        _cache.clear()
    _cache[h] = (time.monotonic() + _TTL, user)
    return user


CurrentUser = Annotated[User, Depends(current_user)]


async def require_member(conn: Conn, user: User, business_id: Any) -> None:
    row = await fetch_one(conn, "select 1 from memberships where user_id = %s and business_id = %s",
                          (user.id, business_id))
    if not row:
        raise NotFound("not found")


async def business_for(conn: Conn, user: User, slug: str) -> dict[str, Any]:
    from app import services

    b = await services.get_business(conn, slug)
    await require_member(conn, user, b["id"])
    return b
