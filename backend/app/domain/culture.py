"""Festivals and cultural context for campaigns in India (Karnataka first).

Hand-written and reviewed, not generated: greetings are the standard phrases people actually use, written natively
in each script. The writer gets this as context when a campaign is about a festival (named in the brief) or runs
during one, so posts reference the right customs instead of generic "festive offers". Dates are listed only where
they are fixed or published for 2026-27; festivals without dates are still recognised when the owner names them.
"""

import re
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from typing import Any


@dataclass(frozen=True)
class Festival:
    key: str
    name: str
    aliases: tuple[str, ...]
    meaning: str
    greetings: dict[str, str]
    customs: tuple[str, ...]
    angles: tuple[str, ...]
    imagery: str
    avoid: tuple[str, ...]
    colours: tuple[str, ...]
    # (first day, last day, label) for the coming year; empty when the date moves and is not confirmed here.
    dates: tuple[tuple[date, date, str], ...] = ()
    sayings: dict[str, str] = field(default_factory=dict)
    region: str = "India"


FESTIVALS: tuple[Festival, ...] = (
    Festival(
        key="dasara",
        name="Dasara (Navaratri)",
        aliases=("dasara", "dussehra", "dasshera", "navaratri", "navratri", "vijayadashami", "vijaya dashami",
                 "ayudha puja", "ayudha pooja", "mysuru dasara", "mysore dasara", "nadahabba",
                 "ದಸರಾ", "ನವರಾತ್ರಿ", "ವಿಜಯದಶಮಿ", "ಆಯುಧ ಪೂಜೆ", "ನಾಡಹಬ್ಬ", "दशहरा", "नवरात्रि", "विजयादशमी"),
        meaning="Karnataka's Nadahabba (state festival): nine nights of Navaratri ending in Vijayadashami, the "
                "victory of good over evil. Mysuru celebrates with the lit-up palace and the Jamboo Savari procession.",
        greetings={"en": "Happy Dasara", "kn": "ದಸರಾ ಹಬ್ಬದ ಶುಭಾಶಯಗಳು", "hi": "दशहरा की हार्दिक शुभकामनाएँ"},
        customs=(
            "Bombe habba: many Karnataka homes display dolls (bombe) through Navaratri and visitors come to see them",
            "Ayudha Puja: shops, tools and vehicles are cleaned, decorated and worshipped; many shops close early "
            "or open late that day",
            "Vijayadashami is an auspicious day for new beginnings: starting lessons, buying a vehicle or gold",
            "School holidays: families visit relatives, go on outings and exchange sweets",
        ),
        angles=("A family outing in the Dasara holidays", "A treat after Ayudha Puja at your own shop",
                "Something new for Vijayadashami", "Sweets for visitors who come to see the bombe"),
        imagery="Marigold and mango-leaf torana at the entrance, banana stems, diyas, a small doll display; "
                "warm evening light.",
        avoid=("Meat or alcohol in Navaratri posts", "Jokes about the goddess or religious symbols",
               "Mixing it with Halloween or other Western festivals"),
        colours=("marigold orange", "kumkum red", "temple gold"),
        dates=((date(2026, 10, 11), date(2026, 10, 20), "Navaratri 11 to 19 Oct, Ayudha Puja 19 Oct, "
                "Vijayadashami 20 Oct 2026"),),
        region="Karnataka (Nadahabba), all India",
    ),
    Festival(
        key="rajyotsava",
        name="Kannada Rajyotsava",
        aliases=("rajyotsava", "karnataka rajyotsava", "kannada rajyotsava", "ಕನ್ನಡ ರಾಜ್ಯೋತ್ಸವ", "ರಾಜ್ಯೋತ್ಸವ"),
        meaning="1 November, the day Karnataka was formed. A day of pride in Kannada: the red-and-yellow Kannada "
                "flag is everywhere.",
        greetings={"en": "Happy Kannada Rajyotsava", "kn": "ಕನ್ನಡ ರಾಜ್ಯೋತ್ಸವದ ಶುಭಾಶಯಗಳು",
                   "hi": "कन्नड़ राज्योत्सव की शुभकामनाएँ"},
        customs=("Flag hoisting in neighbourhoods and offices", "Kannada songs and culture programmes all month"),
        angles=("Lead in Kannada: this is the day to write Kannada first", "Celebrate a local favourite"),
        imagery="Red and yellow, the Kannada flag colours, used respectfully.",
        avoid=("English-only posts on this day", "Altering or printing text over the flag"),
        colours=("Kannada red", "Kannada yellow"),
        dates=((date(2026, 11, 1), date(2026, 11, 1), "1 Nov 2026"),),
        region="Karnataka",
    ),
    Festival(
        key="deepavali",
        name="Deepavali",
        aliases=("deepavali", "diwali", "deepawali", "divali", "balipadyami", "naraka chaturdashi",
                 "ದೀಪಾವಳಿ", "ಬಲಿಪಾಡ್ಯಮಿ", "दीपावली", "दिवाली"),
        meaning="The festival of lights: lamps for Lakshmi, the goddess of prosperity. In Karnataka it runs from "
                "Naraka Chaturdashi to Balipadyami.",
        greetings={"en": "Happy Deepavali", "kn": "ದೀಪಾವಳಿ ಹಬ್ಬದ ಶುಭಾಶಯಗಳು", "hi": "दीपावली की हार्दिक शुभकामनाएँ"},
        customs=("An early-morning oil bath on Naraka Chaturdashi",
                 "Rows of clay lamps (hanate) and rangoli at the door",
                 "Lakshmi Puja: traders worship their account books and start fresh ones",
                 "Sweets and gift boxes for family, staff and neighbours; new clothes"),
        angles=("Sweets or gift boxes for visiting family", "Treat your staff", "A fresh start for the new account year"),
        imagery="Clay diyas, rangoli, marigolds, sweets on a steel or brass plate; soft warm light.",
        avoid=("Heavy firecracker imagery (noise and pollution are sensitive topics)", "Promising free gifts"),
        colours=("diya gold", "deep maroon", "marigold"),
        dates=((date(2026, 11, 7), date(2026, 11, 10), "Deepavali 8 Nov, Balipadyami 10 Nov 2026"),),
    ),
    Festival(
        key="christmas",
        name="Christmas",
        aliases=("christmas", "xmas", "x-mas", "ಕ್ರಿಸ್ಮಸ್", "क्रिसमस"),
        meaning="Celebrated widely in Bengaluru, with plum cakes, stars and lit-up churches.",
        greetings={"en": "Merry Christmas", "kn": "ಕ್ರಿಸ್ಮಸ್ ಹಬ್ಬದ ಶುಭಾಶಯಗಳು", "hi": "क्रिसमस की शुभकामनाएँ"},
        customs=("Plum cake and rose cookies (achappam)", "Paper stars hung outside homes", "Year-end family dinners"),
        angles=("Plum cake season", "Year-end get-togethers"),
        imagery="A paper star, fairy lights, plum cake on a plate.",
        avoid=("Religious imagery used as decoration on unrelated products",),
        colours=("deep red", "pine green", "gold"),
        dates=((date(2026, 12, 24), date(2026, 12, 25), "25 Dec 2026"),),
    ),
    Festival(
        key="new_year",
        name="New Year",
        aliases=("new year", "new years", "ಹೊಸ ವರ್ಷ", "नया साल", "नए साल"),
        meaning="1 January: resolutions, parties on the eve, fresh starts.",
        greetings={"en": "Happy New Year", "kn": "ಹೊಸ ವರ್ಷದ ಶುಭಾಶಯಗಳು", "hi": "नए साल की शुभकामनाएँ"},
        customs=("New Year's Eve outings", "Resolutions: fitness, learning, eating better"),
        angles=("A fresh-start habit", "Gathering with friends on the eve"),
        imagery="Evening lights, friends at a table.",
        avoid=("Alcohol references unless the business serves it legally",),
        colours=("gold", "midnight blue"),
        dates=((date(2026, 12, 31), date(2027, 1, 1), "31 Dec 2026 to 1 Jan 2027"),),
    ),
    Festival(
        key="sankranti",
        name="Makara Sankranti",
        aliases=("sankranti", "sankranthi", "makar sankranti", "makara sankranti", "pongal", "ಸಂಕ್ರಾಂತಿ",
                 "ಮಕರ ಸಂಕ್ರಾಂತಿ", "मकर संक्रांति", "संक्रांति"),
        meaning="The harvest festival as the sun turns north. In Karnataka people exchange ellu-bella.",
        greetings={"en": "Happy Sankranti", "kn": "ಮಕರ ಸಂಕ್ರಾಂತಿಯ ಶುಭಾಶಯಗಳು", "hi": "मकर संक्रांति की शुभकामनाएँ"},
        sayings={"kn": "ಎಳ್ಳು ಬೆಲ್ಲ ತಿಂದು ಒಳ್ಳೆ ಮಾತಾಡಿ"},
        customs=("Ellu-bella: sesame, jaggery, dry coconut and groundnut, shared with neighbours",
                 "Sugarcane and new harvest; cattle are decorated", "Kite flying in north India"),
        angles=("Share something sweet, like ellu-bella", "Fresh from the harvest"),
        imagery="Sugarcane, ellu-bella in a small plate, rangoli, sunlight.",
        avoid=("Calling it a 'winter sale'",),
        colours=("sugarcane green", "jaggery brown", "sun yellow"),
        dates=((date(2027, 1, 14), date(2027, 1, 15), "14 to 15 Jan 2027"),),
    ),
    Festival(
        key="ugadi",
        name="Ugadi",
        aliases=("ugadi", "yugadi", "ಯುಗಾದಿ", "उगादी", "gudi padwa"),
        meaning="New Year in Karnataka. Bevu-bella (neem and jaggery) is eaten for life's bitter and sweet.",
        greetings={"en": "Happy Ugadi", "kn": "ಯುಗಾದಿ ಹಬ್ಬದ ಶುಭಾಶಯಗಳು", "hi": "उगादी की शुभकामनाएँ"},
        customs=("Bevu-bella", "Holige (obbattu) at home", "Mango-leaf torana and new clothes"),
        angles=("A new-year treat", "Holige for those who can't make it at home"),
        imagery="Mango leaves, neem flowers, holige on a banana leaf.",
        avoid=("Generic 'New Year' wording without saying Ugadi",),
        colours=("mango-leaf green", "jaggery gold"),
    ),
    Festival(
        key="ganesha",
        name="Gowri-Ganesha",
        aliases=("ganesh chaturthi", "ganesha chaturthi", "gowri ganesha", "gauri ganesha", "vinayaka chaturthi",
                 "ಗಣೇಶ ಚತುರ್ಥಿ", "ಗೌರಿ ಗಣೇಶ", "गणेश चतुर्थी"),
        meaning="Gowri and Ganesha are welcomed home; in Karnataka the two are celebrated together.",
        greetings={"en": "Happy Ganesha festival", "kn": "ಗಣೇಶ ಚತುರ್ಥಿಯ ಶುಭಾಶಯಗಳು", "hi": "गणेश चतुर्थी की शुभकामनाएँ"},
        customs=("Kadubu and modaka", "Neighbourhood Ganesha pandals and processions"),
        angles=("Kadubu for the festival", "A stop on the way to the pandal"),
        imagery="Kadubu on a plate, flowers, a small clay Ganesha (eco-friendly).",
        avoid=("Plaster idol imagery (eco-friendly clay is preferred)",),
        colours=("vermilion", "turmeric yellow"),
    ),
    Festival(
        key="eid",
        name="Eid",
        aliases=("eid", "ramzan", "ramadan", "bakrid", "eid ul fitr", "eid al fitr", "ಈದ್", "ईद"),
        meaning="Eid ul-Fitr ends the month of Ramzan fasting with prayers, family feasts and sweets.",
        greetings={"en": "Eid Mubarak", "kn": "ಈದ್ ಮುಬಾರಕ್", "hi": "ईद मुबारक"},
        customs=("Sheer khurma and biryani with family", "New clothes and visiting relatives"),
        angles=("Something sweet for the Eid table", "Evening plans after iftar during Ramzan"),
        imagery="Sheer khurma in a bowl, lanterns, crescent moon (respectfully).",
        avoid=("Daytime food promotions aimed at people who are fasting during Ramzan",),
        colours=("emerald green", "silver"),
    ),
    Festival(
        key="holi",
        name="Holi",
        aliases=("holi", "ಹೋಳಿ", "होली"),
        meaning="The spring festival of colours.",
        greetings={"en": "Happy Holi", "kn": "ಹೋಳಿ ಹಬ್ಬದ ಶುಭಾಶಯಗಳು", "hi": "होली की हार्दिक शुभकामनाएँ"},
        customs=("Playing with colours", "Gujiya and thandai"),
        angles=("Colour-safe treats", "A cool drink after playing"),
        imagery="Bright powder colours, gujiya.",
        avoid=("Pushing people to play with colours",),
        colours=("pink", "green", "yellow"),
    ),
)

_BY_KEY = {f.key: f for f in FESTIVALS}


def _norm(text: str) -> str:
    return unicodedata.normalize("NFC", text or "").casefold()


def mentioned(text: str) -> list[Festival]:
    """Festivals the text names, in any of English, Kannada or Hindi."""
    t = _norm(text)
    out = []
    for f in FESTIVALS:
        for a in f.aliases:
            needle = _norm(a)
            pattern = rf"(?<!\w){re.escape(needle)}(?!\w)" if needle.isascii() else re.escape(needle)
            if re.search(pattern, t):
                out.append(f)
                break
    return out


def upcoming(today: date, days: int = 45) -> list[tuple[Festival, date, date, str]]:
    """Dated festivals that start within `days` (or are on now)."""
    out = []
    for f in FESTIVALS:
        for start, end, label in f.dates:
            if end >= today and start <= today + timedelta(days=days):
                out.append((f, start, end, label))
    return sorted(out, key=lambda x: x[1])


def relevant(text: str, start: date | None, end: date | None) -> list[Festival]:
    """Festivals a campaign is about (named in its brief or name) or runs during."""
    found = {f.key: f for f in mentioned(text)}
    if start:
        end = end or start
        for f in FESTIVALS:
            if any(s <= end and e >= start for s, e, _ in f.dates):
                found.setdefault(f.key, f)
    return list(found.values())


def card(f: Festival, languages: list[str] | None = None, today: date | None = None) -> dict[str, Any]:
    """What the UI and the writer get about one festival, limited to the business's languages."""
    d = asdict(f)
    langs = languages or list(f.greetings)
    d["greetings"] = {k: v for k, v in f.greetings.items() if k in langs}
    d["sayings"] = {k: v for k, v in f.sayings.items() if k in langs}
    d["dates"] = [{"start": s.isoformat(), "end": e.isoformat(), "label": label} for s, e, label in f.dates]
    if today:
        nxt = next(((s, e) for s, e, _ in f.dates if e >= today), None)
        d["starts_in_days"] = (nxt[0] - today).days if nxt else None
    d.pop("aliases")
    return d


def get(key: str) -> Festival | None:
    return _BY_KEY.get(key)
