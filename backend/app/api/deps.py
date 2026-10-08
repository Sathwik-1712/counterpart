import hmac

from fastapi import Header, HTTPException, Request

from app.agent.tools import ToolContext
from app.config import get_settings
from app.providers.router import ModelRouter


def get_router(request: Request) -> ModelRouter:
    return request.app.state.router


async def require_owner(x_owner_token: str | None = Header(default=None)) -> None:
    """Owner routes. When OWNER_API_TOKEN is set, the Next.js server adds it; browsers never see it."""
    expected = get_settings().owner_api_token
    if expected is None:
        return
    if not x_owner_token or not hmac.compare_digest(x_owner_token, expected.get_secret_value()):
        raise HTTPException(status_code=401, detail="owner token required")


def tool_context(request: Request, business: dict, campaign_id: str | None, *, actor: str = "agent") -> ToolContext:
    return ToolContext(business=business, campaign_id=campaign_id, router=get_router(request),
                       settings=get_settings(), actor=actor)  # type: ignore[arg-type]
