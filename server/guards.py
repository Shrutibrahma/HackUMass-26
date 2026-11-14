"""Safety checks between the AI and a live phone call.

Rule of the product: the AI may *suggest* words, but it may not add facts the user never gave
or the caller never said, flip a "no" into a "yes", or commit the user to money or bookings
without an explicit confirmation tap.
"""
from __future__ import annotations

import re

NUMBER_WORDS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6",
    "seven": "7", "eight": "8", "nine": "9", "ten": "10", "eleven": "11", "twelve": "12",
    "fifteen": "15", "twenty": "20", "thirty": "30", "forty": "40", "fifty": "50", "hundred": "100",
}
DAYS = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
        "today", "tomorrow", "tonight"}
NEGATIVE = re.compile(r"\b(no|nope|not|don't|dont|can't|cant|won't|wont|never|unfortunately)\b", re.I)
COMMIT = re.compile(
    r"(\$|\bdollars?\b|\bpay\b|\bpayment\b|\bcharge\b|\bcard\b|\border\b|\bbook\b|\bbooking\b|"
    r"\breserve\b|\breservation\b|\bappointment\b|\bsubscribe\b|\bsign me up\b|\bpurchase\b|\bbuy\b)",
    re.I,
)


def facts(text: str) -> set[str]:
    """Numbers (digits or words) and day words found in `text`, normalised."""
    t = text.lower()
    out = set(re.findall(r"\d+(?:[.:]\d+)?", t))
    # "8:00" and "8" should match each other
    out |= {x.split(":")[0].split(".")[0] for x in list(out)}
    for w in re.findall(r"[a-z']+", t):
        if w in NUMBER_WORDS:
            out.add(NUMBER_WORDS[w])
        if w in DAYS:
            out.add(w)
    return out


def invented_facts(suggestion: str, *sources: str) -> set[str]:
    """Facts in the suggestion that appear in none of the sources."""
    allowed: set[str] = set()
    for s in sources:
        allowed |= facts(s)
    return facts(suggestion) - allowed


def is_negative(text: str) -> bool:
    return bool(NEGATIVE.search(text))


def needs_confirmation(text: str) -> bool:
    """Money, orders, bookings: the user must confirm before this is spoken."""
    return bool(COMMIT.search(text))


def check_suggestion(suggestion: str, *, user_input: str, context: list[str]) -> str | None:
    """None if the AI suggestion is safe to offer, else the reason it was dropped."""
    s = suggestion.strip()
    if not s:
        return "empty"
    if len(s) > 240:
        return "too long"
    extra = invented_facts(s, user_input, *context)
    if extra:
        return f"invented facts: {sorted(extra)}"
    if user_input and is_negative(user_input) and not is_negative(s):
        return "user said no, suggestion doesn't"
    return None


