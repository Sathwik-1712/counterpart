"""Model router: tools and the agent ask for a ROLE, never a vendor or model.

role -> ordered provider chain, with per-provider circuit breaker, a cost/usage
ledger, and record/replay (replayed outputs are labelled).
"""

import json
import re
import time
from collections import deque
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import asdict, dataclass
from typing import Any, Literal, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from app.providers.base import (
    ChatResult,
    ImageProvider,
    ImageResult,
    LLMProvider,
    ProviderError,
    RateLimited,
)
from app.providers.replay import ReplayCache

M = TypeVar("M", bound=BaseModel)
Role = Literal["reasoning", "generation", "verification", "image", "vision"]


class NoProviderAvailable(ProviderError):
    pass


# Which business and which job a model call belongs to, so the owner can see what each agent is doing.
_scope: ContextVar[dict[str, str | None] | None] = ContextVar("model_call_scope", default=None)


@contextmanager
def call_scope(**tags: str | None):
    token = _scope.set({**(_scope.get() or {}), **tags})
    try:
        yield
    finally:
        _scope.reset(token)


@dataclass
class CallRecord:
    at: float
    role: str
    provider: str
    model: str
    ok: bool
    replayed: bool
    input_tokens: int
    output_tokens: int
    cost_usd: float
    latency_ms: int
    error: str | None = None
    business_id: str | None = None
    campaign_id: str | None = None
    task: str | None = None


class _Breaker:
    def __init__(self, threshold: int = 3, cooldown: float = 30.0):
        self.threshold, self.cooldown = threshold, cooldown
        self.failures, self.opened_at = 0, 0.0

    def open(self) -> bool:
        return self.failures >= self.threshold and time.monotonic() - self.opened_at < self.cooldown

    def fail(self) -> None:
        self.failures += 1
        if self.failures >= self.threshold:
            self.opened_at = time.monotonic()

    def ok(self) -> None:
        self.failures = 0


_RECOVERABLE = (ProviderError, RateLimited, httpx.HTTPError)


def rest_for(e: Exception) -> float:
    """How long to skip a model after this failure, so later calls go straight to one that works.
    Seen live on the Gemini free tier: daily quota runs out (429), models get overloaded (503), and some
    accept the request but never answer (timeout)."""
    text = str(e).lower()
    if "quota" in text or "resource_exhausted" in text:
        return 1800.0
    if isinstance(e, httpx.TimeoutException):
        return 900.0
    if "503" in text or "high demand" in text or "overloaded" in text or "unavailable" in text:
        return 120.0
    return 0.0


class ModelRouter:
    def __init__(
        self,
        *,
        llms: dict[str, LLMProvider],
        images: dict[str, ImageProvider],
        roles: dict[str, list[str]],
        replay: ReplayCache,
        replay_mode: Literal["off", "record", "replay"] = "off",
    ):
        self.llms, self.images, self.roles = llms, images, roles
        self.replay, self.replay_mode = replay, replay_mode
        self._breakers: dict[str, _Breaker] = {}
        self._rest_until: dict[str, float] = {}
        self.calls: deque[CallRecord] = deque(maxlen=300)

    # ------------------------------------------------------------- helpers
    def _chain(self, role: str, pool: dict[str, Any]) -> list[Any]:
        return [pool[n] for n in self.roles.get(role, []) if n in pool]

    def available(self, role: str) -> bool:
        pool = self.images if role == "image" else self.llms
        return bool(self._chain(role, pool)) or self.replay_mode == "replay"

    def _breaker(self, name: str) -> _Breaker:
        return self._breakers.setdefault(name, _Breaker())

    def _resting(self, name: str) -> bool:
        return self._rest_until.get(name, 0.0) > time.monotonic()

    def _failed(self, name: str, e: Exception) -> None:
        self._breaker(name).fail()
        if rest := rest_for(e):
            self._rest_until[name] = time.monotonic() + rest

    def _log(self, role: str, provider: str, model: str, started: float, *, ok: bool, replayed: bool = False,
             tin: int = 0, tout: int = 0, cost: float = 0.0, error: str | None = None) -> None:
        tags = _scope.get() or {}
        self.calls.append(CallRecord(time.time(), role, provider, model, ok, replayed, tin, tout, cost,
                                     int((time.monotonic() - started) * 1000), error, tags.get("business_id"),
                                     tags.get("campaign_id"), tags.get("task")))

    # ------------------------------------------------------------- chat
    async def chat(self, role: str, messages: list[dict[str, Any]], **kw: Any) -> ChatResult:
        key = self.replay.key("chat", role, {"messages": messages, **kw})
        started = time.monotonic()
        if self.replay_mode == "replay" and (hit := self.replay.load_chat(key)):
            self._log(role, hit.provider, hit.model, started, ok=True, replayed=True)
            return hit

        errors: list[str] = []
        chain = self._chain(role, self.llms)
        # Resting models are skipped; if every model is resting, try them anyway rather than give up.
        ready = [p for p in chain if not self._resting(p.name)] or chain
        for p in ready:
            br = self._breaker(p.name)
            if br.open():
                errors.append(f"{p.name}: circuit open")
                continue
            started = time.monotonic()
            try:
                res = await p.chat(messages, **kw)
            except _RECOVERABLE as e:
                self._failed(p.name, e)
                errors.append(f"{p.name}: {type(e).__name__} {e}")
                self._log(role, p.name, p.model, started, ok=False, error=str(e)[:200])
                continue
            br.ok()
            cost = (res.usage.input_tokens * p.price_in + res.usage.output_tokens * p.price_out) / 1e6
            self._log(role, p.name, p.model, started, ok=True, tin=res.usage.input_tokens,
                      tout=res.usage.output_tokens, cost=cost)
            if self.replay_mode == "record":
                self.replay.save_chat(key, res)
            return res

        if hit := self.replay.load_chat(key):  # demo fallback, labelled as saved output
            self._log(role, hit.provider, hit.model, started, ok=True, replayed=True)
            return hit
        raise NoProviderAvailable(f"no provider for role '{role}': {'; '.join(errors) or 'none configured'}")

    async def chat_json(
        self, role: str, messages: list[dict[str, Any]], schema: type[M], *, retries: int = 1, **kw: Any
    ) -> tuple[M, ChatResult]:
        """Structured output: providers with a JSON-schema mode (Gemini) get it enforced; others (Agnes) get the
        schema as an instruction. Either way the reply is validated, with one repair attempt."""
        json_schema = schema.model_json_schema()
        kw.setdefault("response_schema", json_schema)
        instruction = {
            "role": "system",
            "content": "Reply with one JSON object only, no prose and no code fences. It must validate "
            f"against this JSON Schema:\n{json.dumps(json_schema, ensure_ascii=False)}",
        }
        convo = [*messages, instruction]
        last_error = ""
        for _ in range(retries + 1):
            res = await self.chat(role, convo, **kw)
            try:
                return schema.model_validate(extract_json(res.content or "")), res
            except (ValueError, ValidationError) as e:
                last_error = str(e)[:800]
                convo = [*convo, {"role": "assistant", "content": res.content or ""},
                         {"role": "user", "content": f"That JSON was invalid: {last_error}\nReturn the corrected JSON only."}]
        raise ProviderError(f"structured output failed validation: {last_error}")

    # ------------------------------------------------------------- images
    async def image(self, prompt: str, **kw: Any) -> ImageResult:
        key = self.replay.key("image", "image", {"prompt": prompt, **kw})
        started = time.monotonic()
        if self.replay_mode == "replay" and (hit := self.replay.load_image(key)):
            self._log("image", hit.provider, hit.model, started, ok=True, replayed=True)
            return hit
        errors: list[str] = []
        for p in self._chain("image", self.images):
            br = self._breaker(p.name + ":image")
            if br.open() or self._resting(p.name + ":image"):
                continue
            started = time.monotonic()
            try:
                res = await p.generate(prompt, **kw)
            except _RECOVERABLE as e:
                self._failed(p.name + ":image", e)
                errors.append(f"{p.name}: {e}")
                self._log("image", p.name, p.model, started, ok=False, error=str(e)[:200])
                continue
            br.ok()
            self._log("image", p.name, p.model, started, ok=True)
            if self.replay_mode == "record":
                self.replay.save_image(key, res)
            return res
        if hit := self.replay.load_image(key):
            self._log("image", hit.provider, hit.model, started, ok=True, replayed=True)
            return hit
        raise NoProviderAvailable(f"no image provider: {'; '.join(errors) or 'none configured'}")

    # ------------------------------------------------------------- status
    def status(self) -> dict[str, Any]:
        live = [c for c in self.calls if not c.replayed]
        return {
            "replay_mode": self.replay_mode,
            "roles": {r: [n for n in chain if n in self.llms or n in self.images] for r, chain in self.roles.items()},
            "providers": sorted(set(self.llms) | set(self.images)),
            "calls": len(self.calls),
            "replayed_calls": sum(c.replayed for c in self.calls),
            "failed_calls": sum(not c.ok for c in self.calls),
            "input_tokens": sum(c.input_tokens for c in live),
            "output_tokens": sum(c.output_tokens for c in live),
            "cost_usd_list_price": round(sum(c.cost_usd for c in live), 6),
            "limiters": {
                name: {"used_last_minute": p.limiter.used(), "rpm": p.limiter.rpm, "waiting": p.limiter.waiting}
                for name, p in {**self.llms, **{k + ":image": v for k, v in self.images.items()}}.items()
                if hasattr(p, "limiter")
            },
            "resting": {n: round(t - time.monotonic()) for n, t in self._rest_until.items() if t > time.monotonic()},
            "recent": [asdict(c) for c in list(self.calls)[-10:]],
        }

    def calls_for(self, business_id: str, limit: int = 60) -> list[dict[str, Any]]:
        return [asdict(c) for c in self.calls if c.business_id == business_id][-limit:]


_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def extract_json(text: str) -> Any:
    """Parse the first JSON object in a model reply, tolerating fences and stray prose."""
    t = _FENCE.sub("", text.strip())
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass
    start = t.find("{")
    if start < 0:
        raise ValueError("no JSON object in reply")
    obj, _ = json.JSONDecoder().raw_decode(t[start:])
    return obj
