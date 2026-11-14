"""Deterministic AI Assist fallback (used when Gemini is down) on the demo phrases."""
import asyncio

from app.ai import RulesBrain


def expand(hint, name="Mom", casual=True):
    return asyncio.run(RulesBrain().write_typed_reply(hint, "", {"contact_name": name, "casual": casual}, "neutral"))


def test_demo_phrases():
    assert expand("yes tomorrow 5") == "Yes, tomorrow at five works for me."
    assert expand("yes home 6") == "Yes, Mom, I'll be home around six."
    assert expand("mom late traffic 20").startswith("Mom, I'm running a little late because of traffic.")
    assert "twenty minutes" in expand("mom late traffic 20")
    assert expand("refund order broken", "Acme", False) == \
        "I'm calling because my order arrived damaged, and I'd like to request a refund."


def test_unknown_shorthand_is_not_embellished():
    # The fallback only tidies: no invented facts.
    assert expand("coming home now") == "Coming home now."
