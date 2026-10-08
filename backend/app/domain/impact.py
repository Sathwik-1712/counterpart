"""Change propagation: which assets does a fact change actually touch?"""

from typing import Any

from app.domain.facts import FactSheet


def changed_fact_keys(old: FactSheet, new: FactSheet) -> set[str]:
    old_by = {f.key: f for f in old.facts}
    new_by = {f.key: f for f in new.facts}
    changed = set(old_by) ^ set(new_by)
    for k in set(old_by) & set(new_by):
        if old_by[k].model_dump() != new_by[k].model_dump():
            changed.add(k)
    return changed


def forbidden_changed(old: FactSheet, new: FactSheet) -> bool:
    return old.forbidden_claims != new.forbidden_claims


def affected_assets(revisions: list[dict[str, Any]], changed: set[str], *, all_if: bool = False) -> list[str]:
    """revisions: [{asset_id, fact_keys}] for each asset's current revision."""
    if all_if:
        return [str(r["asset_id"]) for r in revisions]
    return [str(r["asset_id"]) for r in revisions if changed & set(r.get("fact_keys") or [])]
