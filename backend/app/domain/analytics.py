"""Campaign performance and what to do about it. Pure functions over tracked outcomes; no I/O, no model.

Funnel per post: scan (opened the link or QR) -> click (claimed a code) -> redeem (code typed at the counter).
Tips are deterministic rules with the evidence in their text, so the owner can see why each one is suggested;
each tip can carry a plain-language instruction the owner may send to the agent with one tap.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from app.domain.stats import Arm
from app.domain.stats import summarize as posterior

MIN_SCANS = 5  # below this a rate is noise, so no comparison is made
SURE = 0.9  # a tip says one group beats another only when it is at least this likely, given the data


def _rate(n: int, d: int) -> float | None:
    return round(n / d, 4) if d else None


def _group(posts: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    g: dict[str, dict[str, Any]] = {}
    for p in posts:
        k = p.get(key) or "none"
        row = g.setdefault(k, {"key": k, "posts": 0, "scans": 0, "claims": 0, "redeems": 0})
        row["posts"] += 1
        for m in ("scans", "claims", "redeems"):
            row[m] += p[m]
    rows = list(g.values())
    # The plausible range of each group's true conversion (90%), so a small sample is not read as a sure thing.
    ranges = posterior([Arm(r["key"], min(r["redeems"], r["scans"]), r["scans"]) for r in rows if r["scans"]])
    for row in rows:
        row["conversion"] = _rate(row["redeems"], row["scans"])
        rg = ranges.get(row["key"])
        row["likely"] = [round(rg["ci90_low"], 4), round(rg["ci90_high"], 4)] if rg else None
    return sorted(rows, key=lambda r: (-r["redeems"], -r["scans"]))


def _best(rows: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any], float] | None:
    """The best and worst group by conversion, only when the data make the gap likely to be real.
    -> (best, worst, probability that best really converts better)."""
    ok = [r for r in rows if r["scans"] >= MIN_SCANS and r["conversion"] is not None]
    if len(ok) < 2:
        return None
    ok.sort(key=lambda r: r["conversion"], reverse=True)
    best, worst = ok[0], ok[-1]
    if best["conversion"] < max(0.02, 1.2 * (worst["conversion"] or 0)):
        return None
    p = posterior([Arm("best", min(best["redeems"], best["scans"]), best["scans"]),
                   Arm("worst", min(worst["redeems"], worst["scans"]), worst["scans"])])["best"]["p_best"]
    return (best, worst, p) if p >= SURE else None


def summarize(
    posts: list[dict[str, Any]],
    events: list[dict[str, Any]],
    *,
    today: date,
    since: date,
    labels: dict[str, dict[str, str]] | None = None,
    festivals: list[dict[str, Any]] | None = None,
    experiments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """posts: live posts {asset_id, code, channel, language, segment, variant, headline}.
    events: {asset_id, type, qty, at (local datetime), source}."""
    labels = labels or {}
    by_asset: dict[str, dict[str, float]] = defaultdict(lambda: {"scan": 0, "click": 0, "redeem": 0, "sales": 0, "bills": 0})
    days = max(1, min((today - since).days + 1, 30))
    start = today - timedelta(days=days - 1)
    daily = {start + timedelta(days=i): {"scans": 0, "claims": 0, "redeems": 0} for i in range(days)}
    hours = [{"hour": h, "scans": 0, "redeems": 0} for h in range(24)]
    simulated = 0
    name = {"scan": "scans", "click": "claims", "redeem": "redeems"}
    for e in events:
        t, q = e["type"], int(e["qty"])
        if t not in name:
            continue
        if e.get("asset_id"):
            by_asset[str(e["asset_id"])][t] += q
            if t == "redeem" and e.get("bill") is not None:  # what the customer paid, typed at the counter
                by_asset[str(e["asset_id"])]["sales"] += float(e["bill"])
                by_asset[str(e["asset_id"])]["bills"] += 1
        at: datetime = e["at"]
        if at.date() in daily:
            daily[at.date()][name[t]] += q
        if t in ("scan", "redeem"):
            hours[at.hour][name[t]] += q
        simulated += q if e.get("source") == "simulated" else 0

    rows = []
    for p in posts:
        o = by_asset[str(p["asset_id"])]
        rows.append({**p, "scans": int(o["scan"]), "claims": int(o["click"]), "redeems": int(o["redeem"]),
                     "sales": round(o["sales"], 2), "bills": int(o["bills"]), "conversion": _rate(int(o["redeem"]), int(o["scan"]))})
    rows.sort(key=lambda r: (-r["redeems"], -(r["conversion"] or 0), -r["scans"]))
    scans = sum(r["scans"] for r in rows)
    claims = sum(r["claims"] for r in rows)
    redeems = sum(r["redeems"] for r in rows)
    sales, bills = round(sum(r["sales"] for r in rows), 2), sum(r["bills"] for r in rows)
    out: dict[str, Any] = {
        "totals": {"posts": len(rows), "scans": scans, "claims": claims, "redeems": redeems,
                   "sales": sales, "bills": bills, "average_bill": round(sales / bills) if bills else None,
                   "claim_rate": _rate(claims, scans), "redeem_rate": _rate(redeems, claims),
                   "conversion": _rate(redeems, scans)},
        "daily": [{"date": d.isoformat(), **v} for d, v in daily.items()],
        "hours": hours,
        "by": {k: _group(rows, k) for k in ("channel", "language", "segment")},
        "posts": rows,
        "simulated": simulated,
    }
    out["tips"] = tips(out, today=today, labels=labels, festivals=festivals or [], experiments=experiments or [])
    return out


def _hour(h: int) -> str:
    return f"{(h % 12) or 12} {'am' if h < 12 else 'pm'}"


def tips(a: dict[str, Any], *, today: date, labels: dict[str, dict[str, str]], festivals: list[dict[str, Any]],
         experiments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    t = a["totals"]
    out: list[dict[str, Any]] = []

    def add(priority: int, kind: str, title: str, detail: str, ask: str | None = None) -> None:
        out.append({"priority": priority, "kind": kind, "title": title, "detail": detail, "ask": ask})

    def label(dim: str, key: str) -> str:
        return labels.get(dim, {}).get(key, key.replace("_", " "))

    if not t["posts"]:
        add(1, "not_live", "Nothing is live yet", "Approve posts to give each one a link and a QR code. Counting "
            "starts the moment the first one goes out.")
        return out

    for f in festivals:
        n = f.get("starts_in_days")
        if n is not None and 0 <= n <= 14:
            when = "today" if n == 0 else "tomorrow" if n == 1 else f"in {n} days"
            add(1, "festival", f"{f['name']} starts {when}",
                f"Posts that greet customers for the festival feel local. {f['angles'][0]}?",
                ask=f"Add a {f['name']} touch to the posts: use the festival greeting and one real custom.")

    if t["scans"] == 0:
        add(1, "no_opens", "Nobody has opened a link yet",
            "Send the WhatsApp message to your regulars, post the picture with its caption, and put the QR "
            "code on the counter. Each one is tracked separately.")
    else:
        if t["scans"] >= 10 and (t["claim_rate"] or 0) < 0.2:
            add(2, "weak_claim", f"Only {round((t['claim_rate'] or 0) * 100)}% of visitors claim a code",
                "People are curious but the offer is not pulling them in. A clearer hook or a stronger offer "
                "usually fixes this.", ask="Write a new version of the posts with a sharper, more specific hook.")
        if t["claims"] >= 5 and (t["redeem_rate"] or 0) < 0.3:
            add(2, "weak_redeem", f"Only {round((t['redeem_rate'] or 0) * 100)}% of claimed codes are redeemed",
                "People want the offer but don't come in. Remind them before the offer window, and make sure "
                "staff ask for the code at the counter.")
        if t["redeems"] > t["scans"]:
            add(3, "offline", "Most redemptions skip the link",
                "Customers show the code from a poster or a forwarded message. Print more counter posters.")

    for dim, noun in (("channel", "channel"), ("language", "language"), ("segment", "audience")):
        pair = _best(a["by"][dim])
        if pair:
            best, worst, sure = pair
            ratio = (best["conversion"] or 0) / max(worst["conversion"] or 0, 0.001)
            times = f"{ratio:.1f}x as often as" if worst["conversion"] else "far more often than"
            add(2, f"best_{dim}", f"{label(dim, best['key'])} converts {times} {label(dim, worst['key'])}",
                f"{best['redeems']} of {best['scans']} who opened came in ({round((best['conversion'] or 0) * 100)}%), against "
                f"{worst['redeems']} of {worst['scans']} ({round((worst['conversion'] or 0) * 100)}%). With this much data "
                f"that gap is {'over 99' if sure > 0.99 else round(sure * 100)}% likely to be real, not luck. Put more of this campaign into the "
                f"better {noun}.",
                ask=f"Make more posts for {label(dim, best['key'])} and fewer for {label(dim, worst['key'])}.")

    busy = sorted(a["hours"], key=lambda h: h["scans"], reverse=True)
    if busy and busy[0]["scans"] >= 5:
        h = busy[0]["hour"]
        add(3, "timing", f"Most people open the links around {_hour(h)}",
            f"Share new posts about an hour earlier, around {_hour((h - 1) % 24)}, so they are fresh when people look.")

    live = [p for p in a["posts"] if p["scans"] or p["redeems"]]
    if len(live) >= 2:
        avg = sum(p["scans"] for p in a["posts"]) / len(a["posts"])
        for p in a["posts"]:
            if avg >= 6 and p["scans"] <= avg / 4:
                add(3, "weak_post", f"One post gets very few opens: “{p.get('headline') or p['code']}”",
                    f"{p['scans']} opens against an average of {avg:.0f}. A different photo or headline may help.",
                    ask=f"Rewrite the post “{p.get('headline') or p['code']}” with a different hook and photo.")
                break

    for e in experiments:
        need = [arm for arm in e.get("arms", []) if (arm.get("trials") or 0) < 15]
        if e.get("winner"):
            add(2, "ab_winner", f"The A/B test has a winner: version {e['winner']}",
                "Use its angle for the rest of this campaign and the next one.",
                ask=f"Decide the experiment and use version {e['winner']}'s angle from now on.")
        elif need:
            short = sum(15 - (arm.get("trials") or 0) for arm in need)
            add(4, "ab_wait", f"The A/B test needs {short} more link opens",
                "Share both versions equally so the comparison is fair.")

    return sorted(out, key=lambda x: x["priority"])
