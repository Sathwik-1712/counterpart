"""OpenAI-compatible HTTP adapters. Agnes is configured through these.

Agnes contract (wiki.agnes-ai.com, checked 2026-10-08):
  chat:   POST /chat/completions  -> choices[0].message.{content, tool_calls}, usage.{prompt,completion}_tokens
  images: POST /images/generations {model, prompt, size: "1K".., ratio, extra_body.image: [...]}
          -> data[0].url | data[0].b64_json  (response_format goes in extra_body, never top level)
"""

import base64
from typing import Any

import httpx

from app.providers.base import ChatResult, ImageResult, ProviderError, RateLimited, ToolCall, Usage
from app.providers.ratelimit import RpmLimiter, with_backoff


def _raise_for(resp: httpx.Response) -> None:
    if resp.status_code == 429:
        ra = resp.headers.get("retry-after")
        raise RateLimited(float(ra) if ra and ra.replace(".", "", 1).isdigit() else None)
    if resp.status_code >= 500:
        raise RateLimited(None)  # transient: back off and retry
    if resp.status_code >= 400:
        raise ProviderError(f"{resp.status_code}: {resp.text[:300]}")


class OpenAICompatChat:
    def __init__(
        self,
        *,
        name: str,
        base_url: str,
        api_key: str,
        model: str,
        limiter: RpmLimiter,
        price_in: float = 0.0,
        price_out: float = 0.0,
        timeout: float = 120.0,
        client: httpx.AsyncClient | None = None,
    ):
        self.name = name
        self.model = model
        self.limiter = limiter
        self.price_in = price_in
        self.price_out = price_out
        self._client = client or httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
        )

    async def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> ChatResult:
        body: dict[str, Any] = {"model": self.model, "messages": messages}
        if tools:
            body["tools"] = tools
            if tool_choice is not None:
                body["tool_choice"] = tool_choice
        if temperature is not None:
            body["temperature"] = temperature
        if max_tokens is not None:
            body["max_tokens"] = max_tokens

        async def call() -> dict[str, Any]:
            await self.limiter.acquire()
            resp = await self._client.post("/chat/completions", json=body)
            _raise_for(resp)
            return resp.json()

        data = await with_backoff(call)
        try:
            msg = data["choices"][0]["message"]
        except (KeyError, IndexError) as e:
            raise ProviderError(f"malformed chat response: {str(data)[:200]}") from e
        calls = [
            ToolCall(id=tc.get("id") or f"call_{i}", name=tc["function"]["name"],
                     arguments=tc["function"].get("arguments") or "{}")
            for i, tc in enumerate(msg.get("tool_calls") or [])
        ]
        usage = data.get("usage") or {}
        return ChatResult(
            content=msg.get("content"),
            tool_calls=calls,
            usage=Usage(usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)),
            provider=self.name,
            model=self.model,
            raw_message=msg,
        )


class OpenAICompatImage:
    def __init__(
        self,
        *,
        name: str,
        base_url: str,
        api_key: str,
        model: str,
        limiter: RpmLimiter,
        timeout: float = 180.0,
        client: httpx.AsyncClient | None = None,
    ):
        self.name = name
        self.model = model
        self.limiter = limiter
        self._client = client or httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
        )

    async def generate(
        self, prompt: str, *, size: str = "1K", ratio: str = "1:1", references: list[str] | None = None
    ) -> ImageResult:
        body: dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "size": size,
            "ratio": ratio,
            "extra_body": {"response_format": "b64_json"},
        }
        if references:
            body["extra_body"]["image"] = references  # public URLs or data: URIs
        else:
            body["return_base64"] = True

        async def call() -> dict[str, Any]:
            await self.limiter.acquire()
            resp = await self._client.post("/images/generations", json=body)
            _raise_for(resp)
            return resp.json()

        data = await with_backoff(call)
        try:
            item = data["data"][0]
        except (KeyError, IndexError) as e:
            raise ProviderError(f"malformed image response: {str(data)[:200]}") from e
        if item.get("b64_json"):
            raw = base64.b64decode(item["b64_json"])
        elif item.get("url"):
            # Plain client: the result URL is third-party storage and must never see our API key.
            async with httpx.AsyncClient(timeout=60) as plain:
                r = await plain.get(item["url"])
            r.raise_for_status()
            raw = r.content
        else:
            raise ProviderError("image response had neither b64_json nor url")
        return ImageResult(data=raw, mime=_sniff_mime(raw), provider=self.name, model=self.model)


def _sniff_mime(raw: bytes) -> str:
    if raw.startswith(b"\x89PNG"):
        return "image/png"
    if raw[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"
