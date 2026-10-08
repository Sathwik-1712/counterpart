from pathlib import Path

import pytest
from pydantic import BaseModel

from app.providers.base import ProviderError
from app.providers.replay import ReplayCache
from app.providers.router import ModelRouter, NoProviderAvailable, extract_json
from tests.fakes import ScriptedLLM, text


class Out(BaseModel):
    answer: int


def make(tmp_path: Path, mode: str = "off", *providers: ScriptedLLM) -> ModelRouter:
    return ModelRouter(llms={p.name: p for p in providers}, images={},
                       roles={"reasoning": [p.name for p in providers]}, replay=ReplayCache(tmp_path),
                       replay_mode=mode)  # type: ignore[arg-type]


async def test_fallback_to_next_provider(tmp_path):
    a, b = ScriptedLLM("a"), ScriptedLLM("b")
    a.push(ProviderError("down"))
    b.push(text("hi"))
    res = await make(tmp_path, "off", a, b).chat("reasoning", [{"role": "user", "content": "x"}])
    assert res.provider == "scripted" and res.content == "hi"


async def test_record_then_replay_when_live_fails(tmp_path):
    a = ScriptedLLM("a")
    a.push(text("recorded answer"))
    msgs = [{"role": "user", "content": "q"}]
    await make(tmp_path, "record", a).chat("reasoning", msgs)
    a.push(ProviderError("down"), ProviderError("down"))
    res = await make(tmp_path, "off", a).chat("reasoning", msgs)
    assert res.replayed and res.content == "recorded answer"  # labelled saved output
    with pytest.raises(NoProviderAvailable):
        await make(tmp_path, "off", a).chat("reasoning", [{"role": "user", "content": "never recorded"}])


async def test_chat_json_repairs_once(tmp_path):
    a = ScriptedLLM("a")
    a.push(text("Sure! ```json\n{\"answer\": \"many\"}\n```"), text('{"answer": 42}'))
    out, _ = await make(tmp_path, "off", a).chat_json("reasoning", [{"role": "user", "content": "q"}], Out)
    assert out.answer == 42
    assert "invalid" in a.requests[1]["messages"][-1]["content"]


def test_extract_json_tolerates_prose():
    assert extract_json('Here you go: {"a": 1} thanks') == {"a": 1}


async def test_models_out_of_quota_or_hanging_are_skipped_for_a_while(tmp_path):
    import httpx

    a, b = ScriptedLLM("a"), ScriptedLLM("b")
    a.push(ProviderError("429: You exceeded your current quota"))
    b.push(text("first"), text("second"))
    router = make(tmp_path, "off", a, b)
    msgs = [{"role": "user", "content": "x"}]
    assert (await router.chat("reasoning", msgs)).content == "first"
    assert (await router.chat("reasoning", msgs)).content == "second"
    assert len(a.requests) == 1  # the exhausted model was not asked again
    assert "a" in router.status()["resting"]

    c, d = ScriptedLLM("c"), ScriptedLLM("d")
    c.push(httpx.ReadTimeout("no answer"))
    d.push(text("ok"))
    r2 = make(tmp_path, "off", c, d)
    assert (await r2.chat("reasoning", msgs)).content == "ok"
    assert r2.status()["resting"]["c"] > 200

    e = ScriptedLLM("e")  # when every model is resting, they are still tried rather than giving up
    e.push(ProviderError("503 high demand"), text("back"))
    r3 = make(tmp_path, "off", e)
    with pytest.raises(NoProviderAvailable):
        await r3.chat("reasoning", msgs)
    assert (await r3.chat("reasoning", msgs)).content == "back"
