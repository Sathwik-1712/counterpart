"""Capability interfaces. System code depends on these, never on a vendor SDK."""

from dataclasses import dataclass, field
from typing import Any, Protocol


class ProviderError(Exception):
    """A provider failed in a way that retrying the same provider will not fix."""


class RateLimited(Exception):
    def __init__(self, retry_after: float | None = None):
        super().__init__("rate limited")
        self.retry_after = retry_after


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: str  # raw JSON string as returned by the model; validated by the tool layer


@dataclass
class ChatResult:
    content: str | None
    tool_calls: list[ToolCall]
    usage: Usage
    provider: str
    model: str
    replayed: bool = False
    raw_message: dict[str, Any] = field(default_factory=dict)


@dataclass
class ImageResult:
    data: bytes
    mime: str
    provider: str
    model: str
    replayed: bool = False


class LLMProvider(Protocol):
    name: str
    model: str
    # list price per 1M tokens (USD), for the cost ledger
    price_in: float
    price_out: float

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> ChatResult: ...


class ImageProvider(Protocol):
    name: str
    model: str

    async def generate(
        self, prompt: str, *, size: str = "1K", ratio: str = "1:1", references: list[str] | None = None
    ) -> ImageResult: ...


class EmbeddingProvider(Protocol):
    name: str
    dim: int

    async def embed(self, texts: list[str]) -> list[list[float]]: ...
