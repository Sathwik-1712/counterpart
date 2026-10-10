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


def test_unknown_slot_forbidden_claim_and_system_offer_box():
    c = content("{{discount}} all day, plus {{free_cookie}}!")
    f = failed(deterministic_checks(c, SHEET, lang="en", channel="whatsapp"))
    assert {"known_facts_only", "no_forbidden_claims"} <= f
    # required facts are never "missing": the system's offer box states them in the approved wording
    r = render(content("Your kaapi, your table."), SHEET, "kn")
    assert r["offer"] == ["೨೦% ರಿಯಾಯಿತಿ", "ಈ ಶನಿವಾರ ಮತ್ತು ಭಾನುವಾರ", "ಕೆಫೆಯಲ್ಲಿ ಮಾತ್ರ"] and r["cta"] == "ಕೌಂಟರ್‌ನಲ್ಲಿ ಇದನ್ನು ತೋರಿಸಿ"


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


def test_invented_redemption_steps_are_blocked():
    c = content("{{discount}} on kaapi, {{days}}. {{dine_in}}. DM us for the code!")
    assert "no_forbidden_claims" in failed(deterministic_checks(c, SHEET, lang="en", channel="whatsapp"))


def test_doubled_words_around_slots_are_blocked():
    sheet = SHEET.model_copy(update={"facts": [SHEET.facts[0].model_copy(update={"display": {
        "en": "20% off", "kn": "೨೦% ರಿಯಾಯಿತಿ"}})] + SHEET.facts[1:]})
    for lang, body in (("en", "Get {{discount}} off, {{days}}. {{dine_in}}."),
                       ("kn", "{{discount}} ರಿಯಾಯಿತಿ, {{days}}. {{dine_in}}.")):
        assert "no_repeated_words" in failed(deterministic_checks(content(body), sheet, lang=lang, channel="whatsapp"))
    ok = content("Get {{discount}} on kaapi, {{days}}. {{dine_in}}.")
    assert "no_repeated_words" not in failed(deterministic_checks(ok, sheet, lang="en", channel="whatsapp"))


def test_translation_left_in_english_is_flagged():
    sheet = FactSheet.model_validate({"version": 1, "facts": [
        {"key": "discount", "label": "Discount", "type": "percent", "value": 15,
         "display": {"en": "15% off", "hi": "15% off", "kn": "ಶೇಕಡಾ 15 ರಷ್ಟು ರಿಯಾಯಿತಿ"}}]})
    assert [(i["lang"], "English" in i["issue"]) for i in wording_issues(sheet)] == [("hi", True)]


def test_planned_call_to_action_never_reaches_the_writer_or_checker():
    """Seen live: the planner set cta 'Join now'; the system always prints 'Show this at the counter', so the
    checker failed every post for a mismatch it could not fix."""
    from app.domain.audit import SYSTEM, intent_for_copy

    intent = {"core_message": "Christmas membership deal", "cta": "Join now", "tone": "bold"}
    assert intent_for_copy(intent) == {"core_message": "Christmas membership deal", "tone": "bold"}
    assert intent_for_copy(None) == {}
    assert "never judge them against the intent" in SYSTEM


def test_machine_sounding_copy_is_blocked_for_the_writer_and_warned_for_the_owner():
    from app.domain.facts import machine_voice

    assert machine_voice("Elevate your evenings — indulge!!") == ["elevate", "indulge", "long dash", "two exclamation marks"]
    assert machine_voice("Your usual filter coffee, still in the steel tumbler.") == []
    c = content("Treat yourself to the ultimate break")
    by_writer = {k.name: k for k in deterministic_checks(c, SHEET, lang="en", channel="whatsapp")}
    assert not by_writer["sounds_human"].passed and by_writer["sounds_human"].severity == "block"
    by_owner = {k.name: k for k in deterministic_checks(c, SHEET, lang="en", channel="whatsapp", strict_voice=False)}
    assert by_owner["sounds_human"].severity == "warn"


def test_festivals_are_recognised_in_any_script_and_by_date():
    from datetime import date

    from app.domain import culture

    assert [f.key for f in culture.mentioned("Dasara holidays offer")] == ["dasara"]
    assert [f.key for f in culture.mentioned("ದಸರಾ ಹಬ್ಬಕ್ಕೆ ವಿಶೇಷ")] == ["dasara"]
    assert culture.mentioned("dosa and coffee") == []
    during = culture.relevant("Weekend special", date(2026, 10, 18), date(2026, 10, 25))
    assert "dasara" in [f.key for f in during]
    card = culture.card(culture.get("dasara"), ["en", "kn"], today=date(2026, 10, 9))
    assert card["greetings"] == {"en": "Happy Dasara", "kn": "ದಸರಾ ಹಬ್ಬದ ಶುಭಾಶಯಗಳು"} and card["starts_in_days"] == 2
    # every hand-written greeting passes the guard's own script check
    from app.domain.facts import malformed_words

    assert not [g for f in culture.FESTIVALS for g in [*f.greetings.values(), *f.sayings.values()] if malformed_words(g)]


def test_analytics_finds_the_better_channel_and_peak_hour():
    from datetime import date, datetime

    from app.domain.analytics import summarize

    posts = [{"asset_id": "a", "code": "A1", "channel": "whatsapp", "language": "kn", "segment": "students",
              "variant": None, "headline": "x"},
             {"asset_id": "b", "code": "B1", "channel": "instagram_post", "language": "en", "segment": "students",
              "variant": None, "headline": "y"}]
    ev = [{"asset_id": "a", "type": "scan", "qty": 1, "at": datetime(2026, 10, 8, 18, 5)} for _ in range(20)]
    ev += [{"asset_id": "a", "type": "redeem", "qty": 1, "at": datetime(2026, 10, 8, 19)} for _ in range(6)]
    ev += [{"asset_id": "b", "type": "scan", "qty": 1, "at": datetime(2026, 10, 8, 18)} for _ in range(20)]
    ev += [{"asset_id": "b", "type": "redeem", "qty": 1, "at": datetime(2026, 10, 8, 20)}]
    out = summarize(posts, ev, today=date(2026, 10, 9), since=date(2026, 10, 3),
                    labels={"channel": {"whatsapp": "WhatsApp", "instagram_post": "Instagram posts"}})
    assert out["totals"]["scans"] == 40 and out["totals"]["redeems"] == 7
    kinds = {t["kind"]: t for t in out["tips"]}
    assert kinds["best_channel"]["title"].startswith("WhatsApp converts 6.0x as often as")
    assert "6 pm" in kinds["timing"]["title"]
    assert len(out["daily"]) == 7 and out["daily"][-2]["scans"] == 40


def test_reviews_keep_only_text_found_on_the_page():
    from app.reviews import Found, verified
    page = "Our story since 1962.\nWhat guests say:\n“The decoction is strong, just like my grandfather's café.”\nಕಾಫಿ ತುಂಬಾ ಚೆನ್ನಾಗಿದೆ, ಮತ್ತೆ ಬರುತ್ತೇನೆ."

    def f(text: str, lang: str = "en") -> Found:
        return Found(text=text, language=lang, sentiment=0.8, themes=["coffee_strength"])

    kept, skipped = verified([
        f("The decoction is strong, just like my grandfather's café."),   # on the page
        f("ಕಾಫಿ ತುಂಬಾ ಚೆನ್ನಾಗಿದೆ, ಮತ್ತೆ ಬರುತ್ತೇನೆ.", "kn"),                # on the page, Kannada
        f("Best coffee in Bengaluru, five stars!"),                         # invented by the model
        f("Our story since 1962."),                                         # already stored
        f("the decoction is strong,   just like my grandfather's café."),  # same review twice
    ], page, existing={"our story since 1962."})
    assert [k.text for k in kept] == ["The decoction is strong, just like my grandfather's café.", "ಕಾಫಿ ತುಂಬಾ ಚೆನ್ನಾಗಿದೆ, ಮತ್ತೆ ಬರುತ್ತೇನೆ."]
    assert skipped == 3


def test_sarvam_chunks_stay_under_the_limit():
    from app.sarvam import MAX_CHARS, _chunks
    text = ("ಇದು ಒಂದು ವಾಕ್ಯ. " * 200).strip()
    parts = _chunks(text)
    assert all(len(p) <= MAX_CHARS for p in parts) and len(parts) > 1
    assert " ".join(parts).replace("  ", " ") == text


def test_offer_rules_come_from_the_locked_facts():
    from datetime import date, datetime

    from app.domain import redeem

    facts = [
        {"key": "discount", "type": "percent", "value": 15, "display": {"en": "15% off"}},
        {"key": "hours", "type": "time_range", "value": "16:00-19:00", "display": {"en": "4 to 7 pm"}},
        {"key": "days", "type": "text", "value": "weekdays", "display": {"en": "Monday to Friday"}},
        {"key": "dates", "type": "date_range", "value": ["2026-10-12", "2026-10-31"], "display": {"en": "till 31 Oct"}},
        {"key": "id", "type": "condition", "value": "college ID", "display": {"en": "with a valid college ID"}},
    ]
    r = redeem.rules(facts)
    assert r.days == {0, 1, 2, 3, 4} and r.start == date(2026, 10, 12) and r.end == date(2026, 10, 31)
    assert r.checks == ["With a valid college ID"]
    assert redeem.evaluate(r, datetime(2026, 10, 14, 17, 30)) == (True, None)  # Wednesday 5:30 pm
    ok, why = redeem.evaluate(r, datetime(2026, 10, 17, 17, 30))  # Saturday
    assert not ok and "Saturday" in why
    ok, why = redeem.evaluate(r, datetime(2026, 10, 14, 20, 5))
    assert not ok and "4 pm to 7 pm" in why and "8:05 pm" in why
    assert not redeem.evaluate(r, datetime(2026, 11, 2, 17, 0))[0]  # after the offer ended
    assert not redeem.evaluate(r, datetime(2026, 10, 9, 17, 0))[0]  # before it starts


def test_weekday_phrases():
    from app.domain.redeem import weekdays

    assert weekdays("weekends only") == {5, 6}
    assert weekdays("Mon-Wed") == {0, 1, 2}
    assert weekdays("this Saturday and Sunday, 8 to 11 am") == {5, 6}
    assert weekdays("Friday to Monday") == {4, 5, 6, 0}
    assert weekdays("with a valid college ID") is None
    assert weekdays("sunny mornings") is None


def test_autofill_keeps_only_what_the_page_says():
    from app.autofill import Item, Read, checked, is_maps_link, name_in_maps_url

    page = "Kaapi Kone, 11th Main, Jayanagar, Bengaluru. WhatsApp 98450-12345. Filter coffee ₹30 · Masala dosa Rs. 90"
    read = Read(name="Kaapi Kone", kind="cafe", city="Bengaluru", locality="Jayanagar", phone="+91 98450 12345",
                offerings=[Item(name="Filter coffee", price=30), Item(name="Masala dosa", price=95),
                           Item(name="Idli vada", price=60)])
    fields, dropped = checked(read, page)
    assert fields["name"] == "Kaapi Kone" and fields["city"] == "Bengaluru" and fields["phone"] == "+919845012345"
    assert fields["offerings"] == [{"name": "Filter coffee", "price": 30}] and dropped == 2  # wrong price, not on page
    assert "phone" not in checked(Read(phone="1800 103 7455"), "Call 1800 103 7455")[0]  # toll-free: no WhatsApp
    assert is_maps_link("https://maps.app.goo.gl/abc123") and is_maps_link("https://www.google.com/maps/place/X")
    assert not is_maps_link("https://kaapikone.in/menu")
    assert name_in_maps_url("https://www.google.com/maps/place/Kaapi+Kone/@12.9,77.5,17z") == "Kaapi Kone"


def test_whatsapp_numbers():
    from app.services import whatsapp_number

    assert whatsapp_number("98450 12345") == "919845012345"
    assert whatsapp_number("+91 98450-12345") == "919845012345"
    assert whatsapp_number("12345") is None and whatsapp_number(None) is None


def test_no_tip_when_the_gap_could_be_luck():
    from datetime import date, datetime

    from app.domain.analytics import summarize

    posts = [{"asset_id": "a", "code": "A1", "channel": "whatsapp", "language": "kn", "segment": "s", "variant": None},
             {"asset_id": "b", "code": "B1", "channel": "instagram_post", "language": "en", "segment": "s", "variant": None}]
    ev = [{"asset_id": "a", "type": "scan", "qty": 1, "at": datetime(2026, 10, 8, 18)} for _ in range(8)]
    ev += [{"asset_id": "a", "type": "redeem", "qty": 1, "at": datetime(2026, 10, 8, 19)} for _ in range(3)]
    ev += [{"asset_id": "b", "type": "scan", "qty": 1, "at": datetime(2026, 10, 8, 18)} for _ in range(8)]
    ev += [{"asset_id": "b", "type": "redeem", "qty": 1, "at": datetime(2026, 10, 8, 20)} for _ in range(2)]
    out = summarize(posts, ev, today=date(2026, 10, 9), since=date(2026, 10, 8))
    assert "best_channel" not in {t["kind"] for t in out["tips"]}  # 3 of 8 against 2 of 8 proves nothing
    lo, hi = out["by"]["channel"][0]["likely"]
    assert lo < 0.375 < hi and hi - lo > 0.3  # and the range says so
