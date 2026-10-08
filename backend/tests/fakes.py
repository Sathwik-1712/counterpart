import json
from collections import deque
from typing import Any

from app.providers.base import ChatResult, ProviderError, ToolCall, Usage
from app.providers.ratelimit import RpmLimiter


def text(content: str) -> ChatResult:
    return ChatResult(content=content, tool_calls=[], usage=Usage(100, 50), provider="scripted", model="scripted")


def calls(*items: tuple[str, dict[str, Any]]) -> ChatResult:
    return ChatResult(content=None, usage=Usage(100, 50), provider="scripted", model="scripted",
                      tool_calls=[ToolCall(id=f"c{i}", name=n, arguments=json.dumps(a)) for i, (n, a) in enumerate(items)])


class ScriptedLLM:
    """Returns queued responses in order; records every request it received."""

    def __init__(self, name: str = "scripted"):
        self.name, self.model = name, "scripted-1"
        self.price_in = self.price_out = 0.0
        self.limiter = RpmLimiter(1000)
        self.queue: deque[ChatResult | Exception] = deque()
        self.requests: list[dict[str, Any]] = []

    def push(self, *items: ChatResult | Exception) -> None:
        self.queue.extend(items)

    async def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult:
        self.requests.append({"messages": messages, **kw})
        if not self.queue:
            raise ProviderError("script exhausted")
        item = self.queue.popleft()
        if isinstance(item, Exception):
            raise item
        return item
