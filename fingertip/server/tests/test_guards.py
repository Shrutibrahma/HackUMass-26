from app import guards
from app.ai import RulesBrain, extract_options, rules_sentence
import asyncio


def test_numbers():
    assert "23.40" in guards.extract_numbers("your total is $23.40")
    assert "23" in guards.extract_numbers("twenty three")
    assert "12" in guards.extract_numbers("a dozen")
    assert "7" in guards.extract_numbers("7:30")


def test_fact_guard_blocks_invented_price():
    assert not guards.fact_guard("Sure, $15 is fine.", ["large"]).ok
    assert guards.fact_guard("The large, please.", ["large"]).ok


def test_options():
    assert extract_options("Do you want six or twelve?") == ["six", "twelve"]
    assert extract_options("Small, medium or large?") == ["Small", "medium", "large"]
    assert extract_options("Want to get pizza or tacos tonight?")[:2] == ["pizza", "tacos"]


def test_demo_sentence():
    assert rules_sentence(["YES", "SUNDAY", "COME"], casual=True) == "Yeah! I'll be there Sunday."
    assert "can't" in rules_sentence(["NO", "COME"], casual=True)


def test_note_parser_rules():
    p = asyncio.run(RulesBrain().parse_note("order garlic bread and wings, name Shruti, tell me the total first"))
    keys = {f.key: f.value for f in p.auto_facts}
    assert keys == {"order": "garlic bread and wings", "name": "Shruti"}
    assert p.needs_confirmation == ["tell me the total first"]


