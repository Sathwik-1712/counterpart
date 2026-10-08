"""Fact Guard L3: semantic audit by an LLM in the 'verification' role.

One batched call checks many assets: back-translate to English, list every
promise a customer could rely on, and mark each as supported by the fact sheet
or not. Deterministic layers (facts.py) run first and do not depend on this.
"""

import json
from typing import Any

from pydantic import BaseModel

from app.domain.facts import Check, FactSheet
from app.providers.router import ModelRouter


class ClaimCheck(BaseModel):
    claim: str
    supported: bool
    fact_key: str | None = None
    issue: str | None = None


class AssetAudit(BaseModel):
    ref: str
    back_translation: str
    claims: list[ClaimCheck]
    intent_preserved: bool
    intent_notes: str = ""


class AuditResult(BaseModel):
    audits: list[AssetAudit]


SYSTEM = """You audit small-business marketing copy before customers see it.
For each asset: translate it to plain English, then list EVERY promise a customer could rely on
(discount, price, dates, times, items included, conditions, free things, delivery, availability,
speed or quality guarantees). A promise is supported only if the fact sheet states it or it is
harmless brand language that promises nothing measurable. Exaggerations of the offer
("all day", "everything", "free") are NOT supported. Then judge whether the asset keeps the
campaign intent (core message, call to action, tone). Be strict: when unsure, mark unsupported."""


async def audit(
    router: ModelRouter, items: list[dict[str, Any]], sheet: FactSheet, intent: dict[str, Any] | None
) -> tuple[dict[str, list[Check]], dict[str, str]]:
    """items: [{ref, language, channel, rendered}] -> (checks per ref, back-translation per ref)."""
    user = {
        "fact_sheet": [{"key": f.key, "label": f.label, "value": f.value, "display": f.display} for f in sheet.facts],
        "forbidden_claims": sheet.forbidden_claims,
        "intent": intent or {},
        "assets": items,
    }
    result, _ = await router.chat_json(
        "verification",
        [{"role": "system", "content": SYSTEM}, {"role": "user", "content": json.dumps(user, ensure_ascii=False)}],
        AuditResult,
        temperature=0,
    )
    checks: dict[str, list[Check]] = {}
    translations: dict[str, str] = {}
    for a in result.audits:
        bad = [c for c in a.claims if not c.supported]
        checks[a.ref] = [
            Check("L3", "claims_supported", not bad,
                  f"All {len(a.claims)} customer promises match the facts." if not bad else
                  "Unsupported promises: " + "; ".join(f"“{c.claim}” ({c.issue or 'not in facts'})" for c in bad),
                  evidence=[c.claim for c in bad]),
            Check("L3", "intent_preserved", a.intent_preserved,
                  a.intent_notes or ("Keeps the campaign intent." if a.intent_preserved else "Drifts from intent.")),
        ]
        translations[a.ref] = a.back_translation
    missing = {i["ref"] for i in items} - set(checks)
    for ref in missing:  # the auditor skipped an asset: that is a failure, not a pass
        checks[ref] = [Check("L3", "claims_supported", False, "Auditor returned no result for this asset.")]
    return checks, translations
