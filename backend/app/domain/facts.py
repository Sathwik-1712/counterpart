"""Offer facts, fact slots and the deterministic layers of the Fact Guard.

The guarantee: the model never writes an offer value. Copy references facts
through {{slot}} tokens, and rendering substitutes the owner-approved display
string for that language. On top of that:

  L1  any digit the model authored itself (outside a slot) blocks the asset,
      across Latin, Kannada and Devanagari numerals; so do malformed
      Kannada/Devanagari letter sequences;
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


# Claims no small offer should make unless a locked fact says so. Merged with each campaign's forbidden_claims.
BASELINE_FORBIDDEN: dict[str, list[str]] = {
    "en": ["free", "unlimited", "all day", "guaranteed", "cheapest", "lowest price", "no conditions",
           # redemption mechanics that do not exist: customers show a code, scan a QR or tap a link
           "dm", "dm us", "direct message", "inbox us", "order now", "order online", "home delivery", "delivery",
           "call us", "book now", "promo code online"],
    "kn": ["ಉಚಿತ", "ಪುಕ್ಕಟೆ", "ಫ್ರೀ", "ಅನಿಯಮಿತ", "ಅಪರಿಮಿತ", "ದಿನವಿಡೀ", "ಇಡೀ ದಿನ", "ಗ್ಯಾರಂಟಿ", "ಡೆಲಿವರಿ", "ಆರ್ಡರ್"],
    "hi": ["मुफ़्त", "मुफ्त", "फ्री", "फ़्री", "असीमित", "अनलिमिटेड", "पूरे दिन", "दिन भर", "गारंटी", "सबसे सस्ता",
           "डिलीवरी", "ऑर्डर"],
}
# Phrases that make copy read as machine-written or as an agency ad. Posts must sound like the owner talking to a
# regular, so the guard blocks these in what the writer typed (owner edits get a warning instead).
AI_CLICHES: tuple[str, ...] = (
    "elevate", "elevated", "indulge", "indulgence", "treat yourself", "don't miss out", "dont miss out", "unleash",
    "unlock", "embark", "delve", "look no further", "game-changer", "game changer", "fast-paced", "whether you're",
    "nestled", "vibrant", "tantalizing", "tantalising", "mouth-watering", "mouthwatering", "culinary journey",
    "experience the magic", "fuel your", "step into", "symphony", "taste sensation", "like never before",
    "next level", "level up", "must-try", "irresistible", "curated", "seamless", "the perfect blend",
    "perfect harmony", "delightful", "exquisite", "awaits you", "await you", "your go-to", "go-to spot",
    "it's time to", "get ready to", "say goodbye to", "say hello to", "in the heart of", "hidden gem",
    "cherish", "savor every", "savour every", "a feast for", "ultimate", "epic", "amazing", "mind-blowing",
)
_DASHES = re.compile(r"[\u2014\u2013]")  # em and en dashes: the most common tell of generated copy


def machine_voice(text: str) -> list[str]:
    """Phrases in the text that make it sound machine-written."""
    low = unicodedata.normalize("NFC", text).casefold().replace("\u2019", "'")
    hits = [p for p in AI_CLICHES if re.search(rf"(?<!\w){re.escape(p)}(?!\w)", low)]
    if _DASHES.search(text):
        hits.append("long dash")
    if re.search(r"!.*!", text):
        hits.append("two exclamation marks")
    return hits


HARMLESS_IDIOMS = ("feel free", "sugar-free", "sugar free", "gluten-free", "hands-free")


_SCRIPTS = {"kn": ("Kannada", r"[\u0C80-\u0CFF]"), "hi": ("Hindi (Devanagari)", r"[\u0900-\u097F]")}


def wording_issues(sheet: FactSheet) -> list[dict[str, str]]:
    """Deterministic checks of each translated fact wording: well-formed script, same numbers as the English."""
    issues = []
    for f in sheet.facts:
        base = f.display.get("en")
        want = sorted(numbers_in(base)) if base is not None else None
        for lang, wording in f.display.items():
            if lang == "en":
                continue
            if (script := _SCRIPTS.get(lang)) and re.search(r"[A-Za-z]", wording) and not re.search(script[1], wording):
                issues.append({"key": f.key, "label": f.label, "lang": lang, "wording": wording,
                               "issue": f"It is not written in {script[0]}; it was left in English."})
            elif bad := malformed_words(wording):
                issues.append({"key": f.key, "label": f.label, "lang": lang, "wording": wording,
                               "issue": f"Misspelt or broken letters: {', '.join(bad)}."})
            elif want is not None and sorted(numbers_in(wording)) != want:
                issues.append({"key": f.key, "label": f.label, "lang": lang, "wording": wording,
                               "issue": f"Its numbers differ from the English ({', '.join(want) or 'none'})."})
    return issues


def _num_values(text: str) -> set[float]:
    out: set[float] = set()
    for n in numbers_in(text):
        for part in n.split(":"):
            try:
                out.add(float(part.replace(",", "")))
            except ValueError:
                pass
    return out


def assumed_facts(sheet: FactSheet, known_text: str) -> list[dict[str, Any]]:
    """Facts carrying a number the owner never gave (not in their words, the menu or the margin check).
    These are Counterpart's assumptions, e.g. offer dates it picked itself, and the owner must confirm them."""
    known = _num_values(known_text)
    out = []
    for f in sheet.facts:
        nums = _num_values(f.display.get("en") or str(f.value))
        if unknown := sorted(nums - known):
            out.append({"key": f.key, "label": f.label,
                        "numbers": [str(int(n)) if n.is_integer() else str(n) for n in unknown]})
    return out


# ------------------------------------------------------------------ script sanity (Kannada, Devanagari)
# Models writing Indic scripts sometimes emit sequences no word can contain: a vowel sign or anusvara right
# after a virama ("ಪೂರ್ಾಹ್ನ"), a vowel sign at the start of a word, or Latin letters inside a word ("ಮಾಸala").
# Checked per character class, so it needs no dictionary.

_PREV_OK = {"M": "CN", "L": "CNM", "H": "CN", "A": "CNMLV", "N": "C", "Z": "H"}
_WORD = re.compile(r"[^\s.,!?;:()\[\]{}\"'“”‘’\-–—/+#@|]+")


def _cls(cp: int) -> str | None:
    if 0x0C80 <= cp <= 0x0CFF:  # Kannada
        if 0x0C95 <= cp <= 0x0CB9 or cp == 0x0CDE:
            return "C"
        if 0x0C85 <= cp <= 0x0C94 or cp in (0x0CE0, 0x0CE1):
            return "V"
        if 0x0CBE <= cp <= 0x0CCC or cp in (0x0CE2, 0x0CE3):
            return "M"
        return {0x0CD5: "L", 0x0CD6: "L", 0x0CCD: "H", 0x0C81: "A", 0x0C82: "A", 0x0C83: "A", 0x0CBC: "N"}.get(cp, "O")
    if 0x0900 <= cp <= 0x097F:  # Devanagari
        if 0x0915 <= cp <= 0x0939 or 0x0958 <= cp <= 0x095F or 0x0978 <= cp <= 0x097F:
            return "C"
        if 0x0904 <= cp <= 0x0914 or cp in (0x0960, 0x0961) or 0x0972 <= cp <= 0x0977:
            return "V"
        if 0x093E <= cp <= 0x094C or cp in (0x093A, 0x093B, 0x094E, 0x094F, 0x0955, 0x0956, 0x0957, 0x0962, 0x0963):
            return "M"
        return {0x094D: "H", 0x0900: "A", 0x0901: "A", 0x0902: "A", 0x0903: "A", 0x093C: "N"}.get(cp, "O")
    if cp in (0x200C, 0x200D):  # ZWNJ / ZWJ only after a virama
        return "Z"
    return None


def malformed_words(text: str) -> list[str]:
    bad: list[str] = []
    for word in _WORD.findall(unicodedata.normalize("NFC", text)):
        classes = [_cls(ord(ch)) for ch in word]
        indic = any(c in ("C", "V", "M") for c in classes)
        if indic and re.search(r"[A-Za-z]", word):
            bad.append(word)
            continue
        prev: str | None = None
        for c in classes:
            if c in _PREV_OK and (prev is None or prev not in _PREV_OK[c]):
                bad.append(word)
                break
            prev = c
    return list(dict.fromkeys(bad))


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

# Text drawn on a picture: limits are about space, so combining marks (Indic vowel signs, viramas) don't count.
# Caption limits (WhatsApp, Instagram post) are platform limits and count every character.
VISUAL_CHANNELS = {"instagram_story", "poster"}


def visible_len(text: str) -> int:
    return sum(1 for ch in unicodedata.normalize("NFC", text) if unicodedata.category(ch) not in ("Mn", "Mc", "Cf"))


LANG_NAMES = {"en": "English", "kn": "Kannada", "hi": "Hindi"}
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
    # The offer box and the call to action are the system's, not the model's: exact locked wording, one fact per
    # line, and the one real way to claim it. So required facts are never missing, doubled or misinflected.
    out["offer"] = offer_lines(sheet, lang)
    out["cta"] = CTA_TEXT.get(lang, CTA_TEXT["en"])
    return out


CTA_TEXT = {"en": "Show this at the counter", "kn": "ಕೌಂಟರ್‌ನಲ್ಲಿ ಇದನ್ನು ತೋರಿಸಿ", "hi": "काउंटर पर यह दिखाएँ"}


def offer_lines(sheet: FactSheet, lang: str) -> list[str]:
    return [f.display[lang] for f in sheet.facts if f.required and lang in f.display]


def depends_on(content: AssetContent, sheet: FactSheet) -> list[str]:
    """Facts a piece shows: its slots plus every required fact (the offer box)."""
    return sorted(set(slot_keys(content)) | {f.key for f in sheet.facts if f.required})


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
    strict_voice: bool = True,  # the writer's copy is blocked for machine-sounding phrases; the owner's only warned
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

    # L1: well-formed Kannada/Devanagari in what the model wrote (code-mixed copy is checked in every script)
    broken = malformed_words(" ".join(SLOT.sub(" ", s.text) for f in TEXT_FIELDS for s in getattr(content, f))
                             + " " + " ".join(content.hashtags))
    checks.append(Check("L1", "well_formed_script", not broken,
                        "Every word is correctly formed." if not broken else
                        f"Misspelt or broken letters: {', '.join(broken)}", evidence=broken))

    # L2: sounds like a person, not a generated ad
    robotic = machine_voice(" ".join(SLOT.sub(" ", s.text) for f in TEXT_FIELDS for s in getattr(content, f)))
    checks.append(Check("L2", "sounds_human", not robotic,
                        "Sounds like a person, not an ad." if not robotic else
                        f"Sounds machine-written ({', '.join(robotic)}). Say it the way the owner would.",
                        severity="block" if strict_voice else "warn", evidence=robotic))

    # L2: slots exist and are translated
    unknown = [k for k in used if sheet.get(k) is None]
    checks.append(Check("L2", "known_facts_only", not unknown,
                        "All referenced facts exist." if not unknown else
                        f"References facts that do not exist: {', '.join(unknown)}", evidence=unknown))
    untranslated = [k for k in dict.fromkeys([*used, *(f.key for f in sheet.facts if f.required)])
                    if (f := sheet.get(k)) and lang not in f.display]
    checks.append(Check("L2", "approved_wording", not untranslated,
                        f"Every fact has owner-approved wording in '{lang}'." if not untranslated else
                        f"No approved '{lang}' wording for: {', '.join(untranslated)}", evidence=untranslated))

    # L2: words repeated across a slot edge ("{{discount}} off" when the wording already ends in "off"). Only at
    # slot edges: reduplication elsewhere is idiomatic ("ಬಿಸಿ ಬಿಸಿ", piping hot).
    doubled = []
    for f in TEXT_FIELDS:
        for seg in getattr(content, f):
            for m in SLOT.finditer(seg.text):
                fact = sheet.get(m.group(1))
                words = (fact.display.get(lang) or "").casefold().split() if fact else []
                if not words:
                    continue
                before = seg.text[:m.start()].casefold().split()
                after = SLOT.sub(" ", seg.text[m.end():]).casefold().split()
                if after and len(words[-1]) > 1 and after[0].strip(".,!?:;").startswith(words[-1].strip(".,!?:;")):
                    doubled.append(words[-1])
                elif before and before[-1].strip(".,!?:;") == words[0].strip(".,!?:;") and len(words[0]) > 1:
                    doubled.append(words[0])
    checks.append(Check("L2", "no_repeated_words", not doubled,
                        "No doubled words." if not doubled else f"Says “{doubled[0]}” twice around an offer detail",
                        evidence=doubled))

    # L2: forbidden claims, any language (customers code-switch). The campaign's own list plus a built-in one,
    # so blocking "free" in Kannada never depends on a model-written translation.
    full = " ".join([rendered[f] for f in TEXT_FIELDS] + rendered["hashtags"])
    hay = unicodedata.normalize("NFC", full).casefold()
    for idiom in HARMLESS_IDIOMS:
        hay = hay.replace(idiom, " ")
    offered = unicodedata.normalize("NFC", " ".join(v for f in sheet.facts for v in f.display.values())).casefold()
    hits = []
    for phrases in [*sheet.forbidden_claims.values(), *BASELINE_FORBIDDEN.values()]:
        for p in phrases:
            if p in hits or unicodedata.normalize("NFC", p).casefold() in offered:
                continue  # a phrase the locked offer itself uses (e.g. a genuine "buy one, get one free")
            needle = unicodedata.normalize("NFC", p).casefold()
            pattern = rf"(?<!\w){re.escape(needle)}(?!\w)" if needle.isascii() else re.escape(needle)
            if needle and re.search(pattern, hay):
                hits.append(p)
    checks.append(Check("L2", "no_forbidden_claims", not hits,
                        "No forbidden claims." if not hits else f"Forbidden claims: {', '.join(hits)}",
                        evidence=hits))

    # Channel limits
    limits = CHANNEL_LIMITS.get(channel, {})
    size = visible_len if channel in VISUAL_CHANNELS else len
    over = [f"{f} {size(rendered[f])}/{limits[f]}" for f in TEXT_FIELDS if f in limits and size(rendered[f]) > limits[f]]
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
