"""Record/replay of model outputs, keyed by request content.

Used two ways:
  * REPLAY_MODE=replay: serve saved outputs first (rehearsed demo).
  * Any mode: if every live provider fails, fall back to a saved output.
Every replayed result carries replayed=True and is labelled "Saved output" in the UI,
as the hackathon rules require.
"""

import base64
import hashlib
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from app.providers.base import ChatResult, ImageResult, ToolCall, Usage


class ReplayCache:
    def __init__(self, directory: Path):
        self.dir = directory

    @staticmethod
    def key(kind: str, role: str, payload: dict[str, Any]) -> str:
        blob = json.dumps({"kind": kind, "role": role, **payload}, sort_keys=True, ensure_ascii=False, default=str)
        return hashlib.sha256(blob.encode()).hexdigest()[:32]

    def _path(self, key: str) -> Path:
        return self.dir / f"{key}.json"

    def save_chat(self, key: str, result: ChatResult) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        data = asdict(result)
        data["replayed"] = False
        self._path(key).write_text(json.dumps({"type": "chat", "result": data}, ensure_ascii=False, indent=1))

    def load_chat(self, key: str) -> ChatResult | None:
        p = self._path(key)
        if not p.exists():
            return None
        d = json.loads(p.read_text())["result"]
        return ChatResult(
            content=d["content"],
            tool_calls=[ToolCall(**tc) for tc in d["tool_calls"]],
            usage=Usage(**d["usage"]),
            provider=d["provider"],
            model=d["model"],
            replayed=True,
            raw_message=d.get("raw_message", {}),
        )

    def save_image(self, key: str, result: ImageResult) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        self._path(key).write_text(json.dumps({
            "type": "image", "mime": result.mime, "provider": result.provider, "model": result.model,
            "b64": base64.b64encode(result.data).decode(),
        }))

    def load_image(self, key: str) -> ImageResult | None:
        p = self._path(key)
        if not p.exists():
            return None
        d = json.loads(p.read_text())
        return ImageResult(data=base64.b64decode(d["b64"]), mime=d["mime"], provider=d["provider"],
                           model=d["model"], replayed=True)
