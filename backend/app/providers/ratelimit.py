import asyncio
import random
import time
from collections import deque
from collections.abc import Awaitable, Callable

from app.providers.base import RateLimited


class RpmLimiter:
    """Sliding-window limiter: at most `rpm` request starts in any 60 s window.

    Requests queue in arrival order instead of failing, which is what the
    Agnes free plan (10 text RPM) needs.
    """

    def __init__(self, rpm: int, window: float = 60.0):
        self.rpm = rpm
        self.window = window
        self._starts: deque[float] = deque()
        self._lock = asyncio.Lock()
        self.waiting = 0

    async def acquire(self) -> None:
        self.waiting += 1
        try:
            async with self._lock:
                while True:
                    now = time.monotonic()
                    while self._starts and now - self._starts[0] >= self.window:
                        self._starts.popleft()
                    if len(self._starts) < self.rpm:
                        self._starts.append(now)
                        return
                    await asyncio.sleep(self.window - (now - self._starts[0]) + 0.05)
        finally:
            self.waiting -= 1

    def used(self) -> int:
        now = time.monotonic()
        return sum(1 for t in self._starts if now - t < self.window)


async def with_backoff[T](
    fn: Callable[[], Awaitable[T]], *, attempts: int = 3, base: float = 2.0, cap: float = 10.0
) -> T:
    """Retry on RateLimited with exponential backoff + jitter, honouring Retry-After."""
    for attempt in range(attempts):
        try:
            return await fn()
        except RateLimited as e:
            if attempt == attempts - 1:
                raise
            delay = min(cap, e.retry_after if e.retry_after is not None else base * 2**attempt)
            await asyncio.sleep(delay + random.uniform(0, 0.5))
    raise AssertionError("unreachable")
