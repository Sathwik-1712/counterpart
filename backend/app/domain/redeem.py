"""When a coupon may be used, read from the locked offer facts. Deterministic: no model is asked at the counter.

The facts already say when the offer runs ("16:00-19:00", ["2026-10-10", "2026-10-11"], "Monday to Friday").
The counter turns those into rules and checks a code against the business's local time. Conditions a person must
see (a college ID, dine-in only) cannot be checked by software, so they come back as a checklist for staff.
"""

import re
from dataclasses import dataclass, field
from datetime import date, datetime, time
from typing import Any

DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
_DAY = {**{d: i for i, d in enumerate(DAY_NAMES)}, **{d[:3]: i for i, d in enumerate(DAY_NAMES)},
        "tues": 1, "wed": 2, "thur": 3, "thurs": 3}
_DAY_RE = "|".join(sorted(_DAY, key=len, reverse=True))
_TIME = re.compile(r"(\d{1,2})[:.](\d{2})\s*(?:-|–|to)\s*(\d{1,2})[:.](\d{2})")
_ISO = re.compile(r"\d{4}-\d{2}-\d{2}")


@dataclass
class Rules:
    start: date | None = None
    end: date | None = None
    days: set[int] | None = None  # weekday numbers, Monday = 0; None = any day
    hours: tuple[time, time] | None = None
    checks: list[str] = field(default_factory=list)  # for staff to see with their own eyes

    def describe(self) -> list[str]:
        out = []
        if self.days is not None and len(self.days) < 7:
            out.append(", ".join(DAY_NAMES[d].title()[:3] for d in sorted(self.days)))
        if self.hours:
            out.append(f"{_clock(self.hours[0])} to {_clock(self.hours[1])}")
        if self.start or self.end:
            out.append(" to ".join(d.strftime("%-d %b") for d in (self.start, self.end) if d))
        return out


def _clock(t: time) -> str:
    h = t.hour % 12 or 12
    return f"{h}{f':{t.minute:02d}' if t.minute else ''} {'am' if t.hour < 12 else 'pm'}"


def weekdays(text: str) -> set[int] | None:
    """Days named in a phrase: 'weekdays', 'Monday to Friday', 'Mon-Fri', 'Saturday and Sunday', 'weekends'."""
    low = text.casefold()
    found: set[int] = set()
    if re.search(r"\bweek ?days?\b", low):
        found |= {0, 1, 2, 3, 4}
    if re.search(r"\bweek ?ends?\b", low):
        found |= {5, 6}
    for a, b in re.findall(rf"\b({_DAY_RE})\b\s*(?:-|–|to|through|till|until)\s*\b({_DAY_RE})\b", low):
        i, j = _DAY[a], _DAY[b]
        found |= {(i + k) % 7 for k in range((j - i) % 7 + 1)}
    found |= {_DAY[d] for d in re.findall(rf"\b({_DAY_RE})s?\b", low)}
    return found or None


def _dates(value: Any) -> list[date]:
    raw = value if isinstance(value, list) else [value.get("start"), value.get("end")] if isinstance(value, dict) else [value]
    out = []
    for v in raw:
        if isinstance(v, str) and (m := _ISO.search(v)):
            try:
                out.append(date.fromisoformat(m.group()))
            except ValueError:
                continue
    return out


def rules(facts: list[dict[str, Any]], *, starts_on: date | None = None, ends_on: date | None = None) -> Rules:
    r = Rules(start=starts_on, end=ends_on)
    for f in facts:
        kind, value, en = f.get("type"), f.get("value"), str((f.get("display") or {}).get("en") or "")
        if kind == "date_range":
            if ds := _dates(value):
                r.start, r.end = min(ds), max(ds)
        if kind == "time_range":
            for text in (str(value), en):
                if m := _TIME.search(text):
                    h1, m1, h2, m2 = (int(x) for x in m.groups())
                    if h1 < 24 and h2 < 24 and m1 < 60 and m2 < 60:
                        r.hours = (time(h1, m1), time(h2, m2))
                        break
        if kind in ("date_range", "time_range", "text"):
            text = " ".join(value if isinstance(value, list) and all(isinstance(v, str) for v in value) else [str(value)])
            if days := weekdays(f"{text} {en}"):
                r.days = days if r.days is None else r.days & days
        if kind == "condition" and en:
            r.checks.append(en[0].upper() + en[1:])
    return r


def evaluate(r: Rules, now: datetime) -> tuple[bool, str | None]:
    """(allowed, why not) for a code shown at local time `now`."""
    today = now.date()
    if r.start and today < r.start:
        return False, f"The offer starts on {r.start.strftime('%A %-d %B')}."
    if r.end and today > r.end:
        return False, f"The offer ended on {r.end.strftime('%A %-d %B')}."
    if r.days is not None and now.weekday() not in r.days:
        return False, f"The offer is not on {DAY_NAMES[now.weekday()].title()}s. It runs {r.describe()[0]}."
    if r.hours:
        a, b = r.hours
        inside = a <= now.time() <= b if a <= b else (now.time() >= a or now.time() <= b)
        if not inside:
            return False, f"The offer runs {_clock(a)} to {_clock(b)}. It is {_clock(now.time().replace(second=0, microsecond=0))} now."
    return True, None
