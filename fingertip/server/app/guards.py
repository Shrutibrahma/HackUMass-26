"""Code-level guards. These run on every outgoing line; the LLM can't bypass them.

- Fact guard: every number, price, time, day/date and name in an AI-written
  sentence must come from the signs, a chip, the note, or the caller's words.
- Negation guard: NO / NOT / DON'T in the signs => the sentence must negate.
- Commitment guard: money / payment / booking / final confirmation => Confirm.
- Duplicate guard: the same line is never spoken twice within 10 s.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field

# ------------------------------------------------------------------ numbers

_ONES = {
    "zero": 0, "oh": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
    "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40,
    "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    "hundred": 100, "dozen": 12, "half-dozen": 6,
}
_ORDINALS = {
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6,
    "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10, "eleventh": 11, "twelfth": 12,
    "thirteenth": 13, "fifteenth": 15, "twentieth": 20, "thirtieth": 30,
}
# "one" and "second" are too common as non-numbers ("the blue one", "one sec").
_AMBIGUOUS = {"one", "oh", "second"}

DAYS = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
        "today", "tomorrow", "tonight", "yesterday"}
MONTHS = {"january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"}

_NUM_RE = re.compile(r"\$?\d+(?:[.,:]\d+)*")


def _num_values(token: str) -> set[str]:
    """Canonical forms for a numeric token: '$23.40' -> {'23.40','23.4'}; '7:30' -> {'7:30','7','30'}."""
    t = token.lstrip("$").replace(",", "")
    out = {t}
    if ":" in t:
        h, m = t.split(":", 1)
        out |= {h.lstrip("0") or "0", m}
        if m == "00":
            out.add(h.lstrip("0") or "0")
    if "." in t:
        try:
            f = float(t)
            out.add(("%g" % f))
            out.add("%.2f" % f)
            if f == int(f):
                out.add(str(int(f)))
        except ValueError:
            pass
    return out


def extract_numbers(text: str, *, include_ambiguous: bool = True) -> set[str]:
    low = text.lower()
    vals: set[str] = set()
    for m in _NUM_RE.finditer(low):
        vals |= _num_values(m.group())
    words = re.findall(r"[a-z]+(?:-[a-z]+)?", low)
    # compound number words: "twenty three" -> 23
    i = 0
    while i < len(words):
        w = words[i]
        if w in _ONES or w in _ORDINALS:
            if not include_ambiguous and w in _AMBIGUOUS:
                i += 1
                continue
            v = _ONES.get(w, _ORDINALS.get(w))
            if v in (20, 30, 40, 50, 60, 70, 80, 90) and i + 1 < len(words) and words[i + 1] in _ONES \
                    and _ONES[words[i + 1]] < 10:
                v += _ONES[words[i + 1]]
                i += 1
            vals.add(str(v))
        elif "-" in w:
            a, _, b = w.partition("-")
            if a in _ONES and b in _ONES:
                vals.add(str(_ONES[a] + _ONES[b]))
        i += 1
    return vals


# ------------------------------------------------------------------ names

_COMMON_CAPS = {
    "i", "i'm", "i'll", "i'd", "i've", "ok", "okay", "oh", "mm", "yeah", "yes", "no", "hey", "hi",
    "hello", "sorry", "thanks", "thank", "please", "sure", "great", "perfect", "cool", "bye",
    "goodbye", "sounds", "that", "this", "the", "a", "and", "but", "so", "can", "could",
    "would", "will", "do", "does", "is", "are", "it", "it's", "we", "you", "my", "mom", "dad",
    "love", "see", "just", "um", "uh", "well", "alright", "awesome", "nope", "yep", "deaf",
    "asl", "quick", "bear", "what", "when", "where", "how", "who", "why", "let", "let's", "not",
    "maybe", "also", "actually", "got", "good", "fine", "miss", "am", "pm", "a.m.", "p.m.",
}


def extract_names(text: str) -> set[str]:
    """Capitalized words not at a sentence start and not common words."""
    names: set[str] = set()
    for sentence in re.split(r"(?<=[.!?])\s+", text.strip()):
        toks = re.findall(r"[A-Za-z][A-Za-z'\.]*", sentence)
        for idx, tok in enumerate(toks):
            if idx == 0:
                continue
            if tok[0].isupper() and tok.lower() not in _COMMON_CAPS \
                    and tok.lower() not in DAYS and tok.lower() not in MONTHS:
                names.add(tok.lower().rstrip("."))
    return names


def extract_days(text: str) -> set[str]:
    words = set(re.findall(r"[a-z]+", text.lower()))
    return (words & DAYS) | (words & MONTHS)


# ------------------------------------------------------------------ sign glosses

_GLOSS_NUM = {k.upper(): str(v) for k, v in _ONES.items() if v <= 20 and k not in ("oh", "dozen", "half-dozen")}


def gloss_text(signs: list[str]) -> str:
    """Turn sign glosses into searchable text: 'SIX' -> 'six 6', 'MONDAY' -> 'monday'."""
    out = []
    for s in signs:
        g = s.upper()
        if g in _GLOSS_NUM:
            out.append(f"{g.lower()} {_GLOSS_NUM[g]}")
        elif g.isdigit():
            out.append(g)
        else:
            out.append(g.lower().replace("-", " "))
    return " ".join(out)


# ------------------------------------------------------------------ guards


@dataclass
class GuardResult:
    ok: bool
    problems: list[str] = field(default_factory=list)
    unsupported: list[str] = field(default_factory=list)


def fact_guard(sentence: str, sources: list[str]) -> GuardResult:
    pool = " \n ".join(s for s in sources if s)
    allowed_nums = extract_numbers(pool)
    allowed_names = {n for n in re.findall(r"[a-z][a-z'\.]*", pool.lower())}
    allowed_days = extract_days(pool)

    bad: list[str] = []
    for n in extract_numbers(sentence, include_ambiguous=False):
        if n not in allowed_nums:
            bad.append(n)
    for d in extract_days(sentence):
        if d not in allowed_days:
            bad.append(d)
    for name in extract_names(sentence):
        if name not in allowed_names:
            bad.append(name)
    if bad:
        return GuardResult(False, [f"says {', '.join(sorted(set(bad)))}, which you didn't sign or choose"],
                           sorted(set(bad)))
    return GuardResult(True)


_NEG_SIGNS = {"NO", "NOT", "DON'T", "DONT", "NONE", "NEVER", "CANCEL"}
_NEG_RE = re.compile(r"\b(no|not|nope|never|none|nothing|can't|cannot|won't|don't|doesn't|didn't|isn't|"
                     r"aren't|wasn't|shouldn't|couldn't|wouldn't|haven't|hasn't|cancel)\b|n't\b", re.I)


def has_negation(text: str) -> bool:
    return bool(_NEG_RE.search(text.replace("’", "'")))


def negation_guard(sentence: str, signs: list[str]) -> GuardResult:
    if any(s.upper() in _NEG_SIGNS for s in signs) and not has_negation(sentence):
        return GuardResult(False, ["you signed NO, but the sentence doesn't say no"])
    return GuardResult(True)


_MONEY_RE = re.compile(
    r"(\$\s?\d|\b\d+(\.\d+)?\s?(dollars?|bucks|cents)\b|\b(pay|paying|payment|charge|charged|card|credit|debit|"
    r"venmo|deposit|fee|tip|total|price|cost|costs|refund|bill)\b)", re.I)
_BOOKING_RE = re.compile(
    r"\b(book|booked|booking|reserve|reservation|schedule|scheduled|appointment|confirm|confirmed|"
    r"confirmation|sign me up|put me down|lock (it|that) in|go ahead|place the order|that's final|deal)\b", re.I)
_ORDER_RE = re.compile(r"\b(place (it|the order|that)|put (it|that) in|ring (it|that) up|submit the order|order (it|that))\b", re.I)
_AFFIRM_RE = re.compile(r"^\W*(yes|yeah|yep|yup|sure|ok|okay|sounds good|that works|perfect|great|fine|"
                        r"go ahead|do it|that's fine|that's great|alright|correct|right)\b", re.I)


def mentions_money(text: str) -> bool:
    return bool(_MONEY_RE.search(text))


def mentions_commitment(text: str) -> bool:
    return bool(_MONEY_RE.search(text) or _BOOKING_RE.search(text))


def is_affirmative(text: str) -> bool:
    return bool(_AFFIRM_RE.search(text)) and not has_negation(text.split(",")[0])


def commitment_guard(sentence: str, caller_line: str, analyzer_flag: bool = False) -> tuple[bool, str]:
    """Return (needs_confirm, plain summary for the confirm sheet)."""
    amount = first_amount(sentence) or first_amount(caller_line)
    places = bool(_ORDER_RE.search(caller_line) or _ORDER_RE.search(sentence))
    order = " and places the order" if places else ""
    agrees = is_affirmative(sentence) or bool(_BOOKING_RE.search(sentence)) or bool(_ORDER_RE.search(sentence))
    if mentions_money(sentence):
        return True, f"This agrees to pay {amount}{order}" if amount else "This talks about money"
    caller_commit = analyzer_flag or mentions_commitment(caller_line)
    if caller_commit and agrees and not has_negation(sentence):
        if mentions_money(caller_line) and amount:
            return True, f"This agrees to pay {amount}{order}"
        if places:
            return True, "This places the order"
        return True, "This confirms a booking" if _BOOKING_RE.search(sentence + " " + caller_line) \
            else "This says yes to a commitment"
    if _BOOKING_RE.search(sentence) or _ORDER_RE.search(sentence):
        return True, "This places the order" if places else "This confirms a booking"
    return False, ""


def first_amount(text: str) -> str:
    m = re.search(r"\$\s?\d+(?:[.,]\d{1,2})?", text)
    if m:
        return m.group().replace(" ", "")
    m = re.search(r"\b(\d+(?:\.\d{1,2})?)\s?(dollars?|bucks)\b", text, re.I)
    if m:
        return f"${m.group(1)}"
    return ""


_HEDGE_RE = re.compile(r"\b(might|maybe|probably|perhaps|possibly|not sure)\b", re.I)


def hedge_guard(sentence: str, signs: list[str]) -> GuardResult:
    """'might/maybe/probably' in the sentence requires MAYBE in the signs, and vice versa."""
    signed = any(s.upper() == "MAYBE" for s in signs)
    said = bool(_HEDGE_RE.search(sentence))
    if said and not signed:
        return GuardResult(False, ["sounds unsure, but you didn't sign MAYBE"])
    if signed and not said:
        return GuardResult(False, ["you signed MAYBE, but the sentence sounds certain"])
    return GuardResult(True)


def terms(*texts: str) -> list[str]:
    """The deal terms in play: amounts, numbers, days, times."""
    out: set[str] = set()
    for t in texts:
        if not t:
            continue
        out |= extract_numbers(t, include_ambiguous=False) | extract_days(t)
        a = first_amount(t)
        if a:
            out.add(a)
    return sorted(out)


def approval_hash(text: str, caller_line: str) -> str:
    """Binds an approval to the exact words AND the terms currently on the table.
    An edit, or new terms from the caller, gives a different hash."""
    import hashlib

    basis = text.strip() + "\x1f" + ",".join(terms(text, caller_line))
    return hashlib.sha256(basis.encode()).hexdigest()[:20]


def normalize_line(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


class DuplicateGuard:
    def __init__(self, window_s: float = 10.0, clock=time.monotonic) -> None:
        self.window = window_s
        self.clock = clock
        self._recent: dict[str, float] = {}

    def check(self, text: str) -> bool:
        """True if allowed to speak."""
        key = normalize_line(text)
        now = self.clock()
        t = self._recent.get(key)
        return t is None or now - t >= self.window

    def mark(self, text: str) -> None:
        self._recent[normalize_line(text)] = self.clock()


