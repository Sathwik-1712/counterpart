"""Offer facts, fact slots and the deterministic layers of the Fact Guard.

The guarantee: the model never writes an offer value. Copy references facts
through {{slot}} tokens, and rendering substitutes the owner-approved display
string for that language. On top of that:

  L1  any digit the model authored itself (outside a slot) blocks the asset,
      across Latin, Kannada and Devanagari numerals;
  L2  every slot must exist and have an approved display string, every
      required fact must be present, and no forbidden claim may appear;
  L3  (domain/audit.py) an LLM back-translates and checks every customer
      promise against the fact sheet.
"""

import re
import unicodedata
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, Field

# ------------------------------------------------------------------ models

FactType = Literal["percent", "price", "date_range", "time_range", "item", "condition", "text"]


class Fact(BaseModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{1,40}$")
    label: str
    type: FactType
    value: Any
    display: dict[str, str]  # language -> exact customer-facing string, approved at lock time
    required: bool = True


class FactSheet(BaseModel):
    version: int
    facts: list[Fact]
    forbidden_claims: dict[str, list[str]] = {}

    def get(self, key: str) -> Fact | None:
        return next((f for f in self.facts if f.key == key), None)


class Segment(BaseModel):
    text: str
    sources: list[str] = []  # "fact:discount", "insight:<id>", "brand:<rule>", "learning:<id>"


class AssetContent(BaseModel):
    headline: list[Segment] = []
    body: list[Segment] = []
    cta: list[Segment] = []
    hashtags: list[str] = []


TEXT_FIELDS = ("headline", "body", "cta")

CHANNEL_LIMITS: dict[str, dict[str, int]] = {
    "whatsapp": {"headline": 60, "body": 1024, "cta": 80, "hashtags": 0},
    "instagram_post": {"headline": 80, "body": 2200, "cta": 80, "hashtags": 8},
    "instagram_story": {"headline": 60, "body": 160, "cta": 40, "hashtags": 3},
    "poster": {"headline": 40, "body": 160, "cta": 40, "hashtags": 2},
}

CHANNEL_NAMES = {"whatsapp": "WhatsApp", "instagram_post": "an Instagram post",
                 "instagram_story": "an Instagram story", "poster": "a counter poster"}

# ------------------------------------------------------------------ numerals

_DIGIT_BLOCKS = (0x0CE6, 0x0966, 0x0BE6, 0x0C66, 0x09E6)  # Kannada, Devanagari, Tamil, Telugu, Bengali
_DIGIT_MAP = {cp + i: str(i) for cp in _DIGIT_BLOCKS for i in range(10)}
_NUMBER = re.compile(r"\d+(?:[.,:]\d+)*")


def normalize_digits(text: str) -> str:
    return unicodedata.normalize("NFC", text).translate(_DIGIT_MAP)


def numbers_in(text: str) -> list[str]:
    return _NUMBER.findall(normalize_digits(text))


# ------------------------------------------------------------------ slots

SLOT = re.compile(r"\{\{\s*([a-z][a-z0-9_]*)\s*\}\}")


def slot_keys(content: AssetContent) -> list[str]:
    keys: list[str] = []
    for f in TEXT_FIELDS:
        for seg in getattr(content, f):
            for k in SLOT.findall(seg.text):
                if k not in keys:
                    keys.append(k)
    return keys


def _join(segments: list[Segment]) -> str:
    return " ".join(s.text.strip() for s in segments if s.text.strip())


def render(content: AssetContent, sheet: FactSheet, lang: str) -> dict[str, Any]:
    """Customer-facing text. Unknown slots or missing translations render as-is and fail L2."""

    def sub(m: re.Match[str]) -> str:
        fact = sheet.get(m.group(1))
        return fact.display.get(lang, m.group(0)) if fact else m.group(0)

    out: dict[str, Any] = {f: SLOT.sub(sub, _join(getattr(content, f))) for f in TEXT_FIELDS}
    out["hashtags"] = list(content.hashtags)
    return out


# ------------------------------------------------------------------ guard


@dataclass
class Check:
    layer: Literal["L1", "L2", "L3", "channel", "provenance"]
    name: str
    passed: bool
    detail: str
    severity: Literal["block", "warn"] = "block"
    evidence: list[str] = field(default_factory=list)


def deterministic_checks(
    content: AssetContent,
    sheet: FactSheet,
    *,
    lang: str,
    channel: str,
    allowed_phrases: tuple[str, ...] = (),  # business constants containing digits, e.g. "4th Block"
) -> list[Check]:
    checks: list[Check] = []
    used = slot_keys(content)
    rendered = render(content, sheet, lang)

    # L1: digits the model authored outside slots. Known phrases (an address) are removed first,
    # so "11th Main" is fine but a bare "11 am" is not.
    authored = [SLOT.sub(" ", s.text) for f in TEXT_FIELDS for s in getattr(content, f)] + content.hashtags
    for phrase in allowed_phrases:
        pat = re.compile(re.escape(phrase).replace(r"\ ", r"\s*"), re.IGNORECASE)
        authored = [pat.sub(" ", t) for t in authored]
    stray = sorted({n for t in authored for n in numbers_in(t)}, key=lambda n: (len(n), n))
    checks.append(Check("L1", "no_unapproved_numbers", not stray,
                        "Every number comes from an approved fact." if not stray else
                        f"It says {', '.join(stray)}, which is not in the locked offer", evidence=stray))

    # L2: slots exist and are translated
    unknown = [k for k in used if sheet.get(k) is None]
    checks.append(Check("L2", "known_facts_only", not unknown,
                        "All referenced facts exist." if not unknown else
                        f"References facts that do not exist: {', '.join(unknown)}", evidence=unknown))
    untranslated = [k for k in used if (f := sheet.get(k)) and lang not in f.display]
    checks.append(Check("L2", "approved_wording", not untranslated,
                        f"Every fact has owner-approved wording in '{lang}'." if not untranslated else
                        f"No approved '{lang}' wording for: {', '.join(untranslated)}", evidence=untranslated))

    # L2: required facts present
    missing = [f.key for f in sheet.facts if f.required and f.key not in used]
    checks.append(Check("L2", "required_facts_present", not missing,
                        "All required facts are stated." if not missing else
                        f"Missing required facts: {', '.join(missing)}", evidence=missing))

    # L2: forbidden claims, any language (customers code-switch)
    full = " ".join([rendered[f] for f in TEXT_FIELDS] + rendered["hashtags"])
    hay = unicodedata.normalize("NFC", full).casefold()
    hits = []
    for phrases in sheet.forbidden_claims.values():
        for p in phrases:
            needle = unicodedata.normalize("NFC", p).casefold()
            pattern = rf"(?<!\w){re.escape(needle)}(?!\w)" if needle.isascii() else re.escape(needle)
            if needle and re.search(pattern, hay):
                hits.append(p)
    checks.append(Check("L2", "no_forbidden_claims", not hits,
                        "No forbidden claims." if not hits else f"Forbidden claims: {', '.join(hits)}",
                        evidence=hits))

    # Channel limits
    limits = CHANNEL_LIMITS.get(channel, {})
    over = [f"{f} {len(rendered[f])}/{limits[f]}" for f in TEXT_FIELDS if f in limits and len(rendered[f]) > limits[f]]
    if "hashtags" in limits and len(content.hashtags) > limits["hashtags"]:
        over.append(f"hashtags {len(content.hashtags)}/{limits['hashtags']}")
    checks.append(Check("channel", "fits_channel", not over,
                        f"Fits {CHANNEL_NAMES.get(channel, channel)}." if not over else
                        f"Too long for {CHANNEL_NAMES.get(channel, channel)}: {'; '.join(over)}",
                        evidence=over))

    # Provenance: segments that state something should say where it came from
    unsourced = [s.text for f in ("headline", "body") for s in getattr(content, f) if s.text.strip() and not s.sources]
    checks.append(Check("provenance", "sourced_segments", not unsourced,
                        "Every line cites its source." if not unsourced else
                        f"{len(unsourced)} line(s) without a source", severity="warn", evidence=unsourced[:3]))
    return checks


def report(checks: list[Check], *, facts_version: int, l3_status: str) -> dict[str, Any]:
    blocking = [c for c in checks if not c.passed and c.severity == "block"]
    return {
        "passed": not blocking,
        "facts_version": facts_version,
        "l3": l3_status,  # passed | failed | skipped:<reason>
        "checks": [asdict(c) for c in checks],
    }
