from app.domain.economics import offer_economics
from app.domain.facts import (
    AssetContent,
    FactSheet,
    deterministic_checks,
    malformed_words,
    normalize_digits,
    render,
    report,
    wording_issues,
)
from app.domain.impact import affected_assets, changed_fact_keys
from app.domain.stats import Arm, decide, prior_from_history, thompson_allocate

SHEET = FactSheet.model_validate({
    "version": 1,
    "facts": [
        {"key": "discount", "label": "Discount", "type": "percent", "value": 20,
         "display": {"en": "20% off", "kn": "೨೦% ರಿಯಾಯಿತಿ"}},
        {"key": "days", "label": "Days", "type": "date_range", "value": ["2026-10-10", "2026-10-11"],
         "display": {"en": "this Sat & Sun", "kn": "ಈ ಶನಿವಾರ ಮತ್ತು ಭಾನುವಾರ"}},
        {"key": "dine_in", "label": "Dine-in only", "type": "condition", "value": True,
         "display": {"en": "Dine-in only", "kn": "ಕೆಫೆಯಲ್ಲಿ ಮಾತ್ರ"}},
    ],
    "forbidden_claims": {"en": ["free", "all day", "delivery"], "kn": ["ಉಚಿತ"]},
})


def content(body: str, hashtags: list[str] | None = None) -> AssetContent:
    return AssetContent.model_validate({
        "headline": [{"text": "Filter kaapi, your way", "sources": ["brand:voice"]}],
        "body": [{"text": body, "sources": ["fact:discount"]}],
        "cta": [{"text": "See you at the counter"}],
        "hashtags": hashtags or [],
    })


def failed(checks):
    return {c.name for c in checks if not c.passed and c.severity == "block"}


def test_clean_copy_passes_and_renders_approved_wording():
    c = content("{{discount}} on kaapi + snack, {{days}}. {{dine_in}}.")
    checks = deterministic_checks(c, SHEET, lang="en", channel="whatsapp")
    assert failed(checks) == set()
    assert render(c, SHEET, "en")["body"] == "20% off on kaapi + snack, this Sat & Sun. Dine-in only."
    assert "೨೦% ರಿಯಾಯಿತಿ" in render(c, SHEET, "kn")["body"]


def test_model_authored_number_is_blocked():
    c = content("30% off on kaapi, {{days}}. {{dine_in}}. {{discount}}")
    assert "no_unapproved_numbers" in failed(deterministic_checks(c, SHEET, lang="en", channel="whatsapp"))


def test_kannada_numerals_are_caught():
    assert normalize_digits("೩೦%") == "30%"
    c = content("೩೦% ರಿಯಾಯಿತಿ {{days}} {{dine_in}} {{discount}}")
    assert "no_unapproved_numbers" in failed(deterministic_checks(c, SHEET, lang="kn", channel="whatsapp"))


def test_allowed_business_phrases_pass_but_bare_numbers_do_not():
    phrases = ("4th Block", "11th Main", "Jayanagar4thBlock")
    c = content("On 11th Main, {{discount}} {{days}} {{dine_in}}", hashtags=["#Jayanagar4thBlock"])
    assert failed(deterministic_checks(c, SHEET, lang="en", channel="instagram_post", allowed_phrases=phrases)) == set()
    c = content("Open till 11! {{discount}} {{days}} {{dine_in}}")
    assert "no_unapproved_numbers" in failed(
        deterministic_checks(c, SHEET, lang="en", channel="instagram_post", allowed_phrases=phrases))


def test_missing_required_unknown_slot_forbidden_claim():
    c = content("{{discount}} all day, plus {{free_cookie}}!")
    f = failed(deterministic_checks(c, SHEET, lang="en", channel="whatsapp"))
    assert {"required_facts_present", "known_facts_only", "no_forbidden_claims"} <= f


def test_forbidden_claim_word_boundary():
    # "freshly" must not trip "free"
    c = content("Freshly brewed. {{discount}} {{days}} {{dine_in}}")
    assert "no_forbidden_claims" not in failed(deterministic_checks(c, SHEET, lang="en", channel="whatsapp"))


def test_missing_translation_blocks():
    c = content("{{discount}} {{days}} {{dine_in}}")
    assert "approved_wording" in failed(deterministic_checks(c, SHEET, lang="hi", channel="whatsapp"))


def test_report_ignores_warnings():
    c = AssetContent.model_validate({"body": [{"text": "{{discount}} {{days}} {{dine_in}}"}]})
    r = report(deterministic_checks(c, SHEET, lang="en", channel="poster"), facts_version=1, l3_status="skipped")
    assert r["passed"] is True  # provenance is a warning, not a block


def test_change_impact_only_touches_dependents():
    new = SHEET.model_copy(deep=True)
    new.facts[1].display = {"en": "this Sunday", "kn": "ಈ ಭಾನುವಾರ"}
    changed = changed_fact_keys(SHEET, new)
    assert changed == {"days"}
    revs = [{"asset_id": "a", "fact_keys": ["discount", "days"]}, {"asset_id": "b", "fact_keys": ["discount"]}]
    assert affected_assets(revs, changed) == ["a"]


def test_decide_waits_then_picks_clear_winner():
    assert decide([Arm("A", 1, 5), Arm("B", 2, 5)]).winner is None
    d = decide([Arm("A", 4, 60), Arm("B", 24, 60)])
    assert d.winner == "B" and d.summary["B"]["p_best"] > 0.99


def test_thompson_and_prior():
    alloc = thompson_allocate([Arm("A", 2, 50), Arm("B", 20, 50)], 200, seed=1)
    assert sum(alloc.values()) == 200 and alloc["B"] > alloc["A"]
    a, b = prior_from_history([(10, 100), (30, 100)], strength=20)
    assert abs(a / (a + b) - 0.2) < 1e-9 and abs(a + b - 20) < 1e-9


def test_offer_economics():
    items = [{"name": "Filter coffee", "price": 60, "unit_cost": 18}, {"name": "Masala vada", "price": 70, "unit_cost": 28}]
    e = offer_economics(items, discount_pct=20, baseline_covers=40)
    assert e["offer_price"] == 104 and e["margin_after"] == 58
    assert e["break_even_extra_covers"] == round(40 * 84 / 58 - 40, 1)
    assert offer_economics(items, discount_pct=70, baseline_covers=40)["verdict"] == "loss_making"


def test_builtin_forbidden_claims_cover_kannada_and_hindi():
    bare = SHEET.model_copy(update={"forbidden_claims": {}})  # campaign list empty or badly translated
    for body in ("{{discount}} ಉಚಿತ ಕಾಫಿ, {{days}}. {{dine_in}}.", "{{discount}}, मुफ्त चाय! {{days}}. {{dine_in}}.",
                 "{{discount}}, unlimited refills, {{days}}. {{dine_in}}."):
        lang = "en" if "unlimited" in body else ("kn" if "ಉ" in body else "hi")
        assert "no_forbidden_claims" in failed(deterministic_checks(content(body), bare, lang=lang, channel="whatsapp"))
    ok = content("Feel free to drop in: {{discount}}, {{days}}. {{dine_in}}.")
    assert "no_forbidden_claims" not in failed(deterministic_checks(ok, bare, lang="en", channel="whatsapp"))


def test_fact_wording_numbers_must_match_english():
    assert wording_issues(SHEET) == []  # Kannada digits count as the same numbers
    bad = FactSheet.model_validate({"version": 1, "facts": [
        {"key": "time", "label": "Time", "type": "time_range", "value": "16:00-19:00",
         "display": {"en": "Weekdays, 4 to 7 pm", "kn": "ಸಂಜೆ 4 ರಿಂದ 8"}}]})
    assert [(i["key"], i["lang"]) for i in wording_issues(bad)] == [("time", "kn")]


def test_broken_indic_letters_are_caught():
    # all three seen live from the model, plus Hindi equivalents
    assert malformed_words("ಸೋಮವಾರ–ಶುಕ್ರವಾರ, ಪೂರ್ಾಹ್ನ 4–7") == ["ಪೂರ್ಾಹ್ನ"]   # vowel sign after a virama
    assert malformed_words("27 ಅಕ್ಟೋಬರ್ಂದ") == ["ಅಕ್ಟೋಬರ್ಂದ"]                 # anusvara after a virama
    assert malformed_words("ಫಿಲ್ಟರ್ ಕಾಫಿ + ಮಾಸala ಡೋಸಾ") == ["ಮಾಸala"]        # Latin inside a Kannada word
    assert malformed_words("ि चाय") == ["ि"] and malformed_words("मुफ़्त चाय, हैं") == []
    assert malformed_words("ಅಕ್ಟೋಬರ್\u200cನಿಂದ ಸ್ಟೂಡೆಂಟ್ ID, ೨೦% ರಿಯಾಯಿತಿ") == []
    sheet = SHEET.model_copy(update={"facts": [SHEET.facts[0].model_copy(update={"display": {"en": "20% off",
                                                                                             "kn": "20% ರಿಯಾಯಿತ್ಿ"}})]})
    assert "Misspelt" in wording_issues(sheet)[0]["issue"]
    c = content("{{discount}} ಮಾಸala ದೋಸೆ, {{days}}. {{dine_in}}.")
    assert "well_formed_script" in failed(deterministic_checks(c, SHEET, lang="kn", channel="whatsapp"))


def test_visual_limits_count_visible_letters():
    from app.domain.facts import visible_len
    assert visible_len("ಮಸಾಲೆ ದೋಸೆ") == 6 and len("ಮಸಾಲೆ ದೋಸೆ") == 10  # vowel signs are not extra letters
    assert visible_len("Kaapi") == 5
