"""Fact Guard L3: semantic audit by an LLM in the 'verification' role.

One batched call checks many assets: back-translate to English, list every
promise a customer could rely on, and mark each as supported by the fact sheet
or not. Deterministic layers (facts.py) run first and do not depend on this.
"""

import json
from typing import Any

from pydantic import BaseModel

from app import sarvam
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
    reads_naturally: bool = True
    language_issue: str = ""


class AuditResult(BaseModel):
    audits: list[AssetAudit]


SYSTEM = """You audit small-business marketing copy before customers see it.
For each asset: translate it to plain English, then list EVERY promise a customer could rely on
(discount, price, dates, times, items included, conditions, free things, delivery, availability,
speed or quality guarantees). A promise is supported only if the fact sheet states it or it is
harmless brand language that promises nothing measurable. Exaggerations of the offer
("all day", "everything", "free") are NOT supported. So is anything that contradicts or goes beyond the facts in
time, place, action or product: "tonight" or "morning" when the offer is 4 to 7 pm; "order" or "delivery" when
customers must show the post at the counter; "sweet" for a savoury dish. Be strict: when unsure, mark unsupported.
The offer lines and the call to action ("Show this at the counter" in the asset's language) are added by the system
from the locked facts; they are always correct, so never judge them against the intent. The business name and place
are printed on the post, so the copy need not repeat them. Set intent_preserved false only if the headline or body
contradicts the intent's core message or tone, or says something in must_not_say; leaving a detail out is fine.
Finally judge, as a native speaker of the asset's language, whether it reads naturally: no repeated words, no
phrase said twice, no dangling fragments, correct grammar and spelling. If not, set reads_naturally false and
name the exact problem in language_issue (one sentence).
Some assets carry `independent_translation`: an English translation made by a separate translation system, not by
the writer. Use it as a second reading. If it shows a promise, time, item or meaning that your own reading missed,
judge by the stricter of the two."""


def intent_for_copy(intent: dict[str, Any] | None) -> dict[str, Any]:
    """The intent as the writer and checker see it. The call to action is fixed by the system, so a planned one
    ("Join now") is dropped rather than letting it fail every post."""
    return {k: v for k, v in (intent or {}).items() if k not in ("cta", "call_to_action")}


async def audit(
    router: ModelRouter, items: list[dict[str, Any]], sheet: FactSheet, intent: dict[str, Any] | None
) -> tuple[dict[str, list[Check]], dict[str, str]]:
    """items: [{ref, language, channel, rendered}] -> (checks per ref, back-translation per ref)."""
    # A dedicated translation model reads Kannada and Hindi posts first, so the checker is not the only reader.
    texts = [("\n".join(str(i["rendered"].get(f) or "") for f in ("headline", "body")).strip(), i["language"]) for i in items]
    independent = await sarvam.many_to_english(texts)
    items = [{**i, "independent_translation": t} if t else i for i, t in zip(items, independent, strict=True)]
    user = {
        "fact_sheet": [{"key": f.key, "label": f.label, "value": f.value, "display": f.display} for f in sheet.facts],
        "forbidden_claims": sheet.forbidden_claims,
        "intent": intent_for_copy(intent),
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
            Check("L3", "reads_naturally", a.reads_naturally,
                  "Reads naturally." if a.reads_naturally else (a.language_issue or "Does not read naturally.")),
        ]
        translations[a.ref] = a.back_translation
    for i in items:  # show the owner the independent translation when there is one
        if i.get("independent_translation") and i["ref"] in translations:
            translations[i["ref"]] = i["independent_translation"]
    missing = {i["ref"] for i in items} - set(checks)
    for ref in missing:  # the auditor skipped an asset: that is a failure, not a pass
        checks[ref] = [Check("L3", "claims_supported", False, "Auditor returned no result for this asset.")]
    return checks, translations


# ------------------------------------------------------------------ fact wording (before lock)


class WordingCheck(BaseModel):
    key: str
    language: str
    back_translation: str
    same_meaning: bool
    issue: str | None = None


class WordingResult(BaseModel):
    checks: list[WordingCheck]


WORDING_SYSTEM = """You check the translated wording of a small business's offer before the owner locks it.
For each item, translate `wording` into plain, literal English. Then decide whether it means exactly the same
as `english` (and `value`). Any difference a customer could act on is a mismatch: days, dates, times, amounts,
items, who qualifies, conditions. Ignore style, word order and politeness. Be strict.
Some items carry `independent_translation`, made by a separate translation system. Use it as a second reading:
if it differs from `english` in anything a customer could act on, that is a mismatch.
Reply with JSON: {"checks": [{"key", "language", "back_translation", "same_meaning", "issue"}]}.
`issue` is null when the meaning is the same, otherwise ONE short sentence naming the difference."""


async def audit_fact_wording(router: ModelRouter, sheet: FactSheet) -> tuple[list[dict[str, str]], dict[str, dict]]:
    """Back-translate every non-English fact wording -> (issues, back-translations by key and language)."""
    labels = {f.key: f.label for f in sheet.facts}
    items = [{"key": f.key, "language": lang, "wording": text, "english": f.display.get("en"), "value": f.value}
             for f in sheet.facts for lang, text in f.display.items() if lang != "en"]
    if not items:
        return [], {}
    independent = await sarvam.many_to_english([(i["wording"], i["language"]) for i in items])
    items = [{**i, "independent_translation": t} if t else i for i, t in zip(items, independent, strict=True)]
    result, _ = await router.chat_json(
        "verification",
        [{"role": "system", "content": WORDING_SYSTEM},
         {"role": "user", "content": json.dumps({"items": items}, ensure_ascii=False)}],
        WordingResult,
        temperature=0,
    )
    got = {(c.key, c.language): c for c in result.checks}
    issues: list[dict[str, str]] = []
    translations: dict[str, dict] = {}
    for it in items:
        c = got.get((it["key"], it["language"]))
        if c is None:  # skipped by the checker: a failure, not a pass
            issues.append({"key": it["key"], "label": labels[it["key"]], "lang": it["language"],
                           "wording": it["wording"], "issue": "The checker returned no result for this wording."})
            continue
        translations.setdefault(c.key, {})[c.language] = it.get("independent_translation") or c.back_translation
        if not c.same_meaning:
            issue = (c.issue or "It does not mean the same as the English.").strip()
            issues.append({"key": c.key, "label": labels.get(c.key, c.key), "lang": c.language,
                           "wording": it["wording"], "back_translation": c.back_translation,
                           "issue": issue if len(issue) <= 220 else issue[:217].rsplit(" ", 1)[0] + "…"})
    return issues, translations
