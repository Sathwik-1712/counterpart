"""Offer economics: will this discount make or lose money for this business?"""

from typing import Any


def offer_economics(
    items: list[dict[str, Any]],
    *,
    discount_pct: float = 0.0,
    flat_off: float = 0.0,
    baseline_covers: int,
    expected_extra_covers: float | None = None,
) -> dict[str, Any]:
    """items: [{name, price, unit_cost}] making up one redemption (e.g. coffee + snack). unit_cost may be unknown
    (None) for businesses that have not entered costs; the margin verdict is then "unknown_cost".

    Conservative assumption: every customer in the offer window takes the deal,
    so baseline customers also get the discount.
    """
    price = sum(float(i["price"]) for i in items)
    if any(i.get("unit_cost") is None for i in items):
        offer_price = max(price * (1 - discount_pct / 100) - flat_off, 0.0)
        return {"items": [i["name"] for i in items], "list_price": round(price, 2), "offer_price": round(offer_price, 2),
                "verdict": "unknown_cost",
                "summary": "Item costs are not set, so the margin can't be checked. Ask the owner what each item costs them."}
    cost = sum(float(i["unit_cost"]) for i in items)
    offer_price = max(price * (1 - discount_pct / 100) - flat_off, 0.0)
    margin_before = price - cost
    margin_after = offer_price - cost

    out: dict[str, Any] = {
        "items": [i["name"] for i in items],
        "list_price": round(price, 2),
        "offer_price": round(offer_price, 2),
        "unit_cost": round(cost, 2),
        "margin_before": round(margin_before, 2),
        "margin_after": round(margin_after, 2),
        "margin_after_pct": round(100 * margin_after / offer_price, 1) if offer_price else None,
        "baseline_covers": baseline_covers,
    }
    if margin_after <= 0:
        out |= {"verdict": "loss_making", "break_even_extra_covers": None,
                "summary": f"Every redemption loses ₹{abs(margin_after):.0f}; no volume makes this profitable."}
        return out

    needed = baseline_covers * margin_before / margin_after - baseline_covers
    out["break_even_extra_covers"] = round(needed, 1)
    out["verdict"] = "thin" if margin_after / offer_price < 0.25 else "healthy"
    out["summary"] = (f"Needs {needed:.0f} extra customers per offer window to match today's margin "
                      f"(margin per order ₹{margin_before:.0f} → ₹{margin_after:.0f}).")
    if expected_extra_covers is not None:
        delta = (baseline_covers + expected_extra_covers) * margin_after - baseline_covers * margin_before
        out["expected_margin_delta"] = round(delta, 2)
        out["expected_extra_covers"] = expected_extra_covers
    return out
