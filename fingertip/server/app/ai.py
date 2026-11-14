"""The four AI jobs: note parser, turn analyzer, reply writer, recap.

GeminiBrain calls Gemini with structured JSON output. Every job has a
deterministic fallback (RulesBrain) used when Gemini is slow, down, or not
configured, so a call never stalls on the model. Whatever writes the
sentence, the guards in guards.py check it before anything is spoken.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Literal, Optional

from pydantic import BaseModel, Field

from . import guards
from .config import settings
from .latency import latency

log = logging.getLogger("ai")

QuestionType = Literal[
    "yes_no", "options", "number", "time", "open", "info_request", "price_confirm",
    "repeat_request", "presence_check", "hold", "robot_check", "out_of_scope", "emergency",
    "greeting", "closing", "statement",
]
Tone = Literal["neutral", "warm", "question", "concerned"]


class NoteFact(BaseModel):
    key: str = Field(description="short label, e.g. name, order, pickup_time, phone")
    value: str = Field(description="the fact exactly as the signer wrote it")
    say: str = Field(description="one natural spoken sentence stating only this fact")


class NoteParse(BaseModel):
    auto_facts: list[NoteFact] = Field(default_factory=list)
    needs_confirmation: list[str] = Field(default_factory=list,
                                          description="instructions or topics the signer wants to approve first")


class TurnAnalysis(BaseModel):
    question_type: QuestionType = "statement"
    options: list[str] = Field(default_factory=list, description="options the caller named, in their words")
    chips: list[str] = Field(default_factory=list, description="2-4 short spoken replies the signer could tap")
    note_fact_key: Optional[str] = Field(default=None, description="key of the note fact that answers this, or null")
    involves_money: bool = False
    involves_commitment: bool = False
    unclear: bool = False


class Reply(BaseModel):
    sentence: str


class Recap(BaseModel):
    points: list[str]


# ======================================================================= rules

_HOLD = re.compile(r"\b(hold on|please hold|hang on|one moment|just a moment|bear with me|let me (check|see|look)|"
                   r"give me (a|one) (sec|second|minute|moment)|one sec)\b", re.I)
_PRESENCE = re.compile(r"\b(are you (still )?there|you there|hello\?|can you hear me|still with me)\b", re.I)
_REPEAT = re.compile(r"(say that again|^\W*sorry\W*$|^\W*what\W*$|what was that|come again|didn'?t (catch|hear)|"
                     r"pardon|repeat that|one more time)", re.I)
_ROBOT = re.compile(r"\b(robot|automated|a bot|machine|real person|is this (an? )?ai|computer voice|recording)\b", re.I)
_CARD = re.compile(r"\b(card number|credit card|debit card|cvv|security code|expiration|social security|ssn)\b", re.I)
_EMERG = re.compile(r"\b(911|emergency|ambulance|call the police)\b", re.I)
_CLOSING = re.compile(r"\b(bye|goodbye|talk (to you )?(later|soon)|have a (good|nice|great) (one|day|night)|"
                      r"take care|see you)\b", re.I)
_GREETING = re.compile(r"^\W*(hi|hey|hello|good (morning|afternoon|evening))\b", re.I)
_YESNO_START = re.compile(r"^\W*(are|is|was|do|does|did|can|could|will|would|should|shall|have|has|want|you|"
                          r"so you|and you|is that|that okay|okay)\b", re.I)
_TIMEQ = re.compile(r"\b(what time|when|what day|which day|how soon)\b", re.I)
_NUMQ = re.compile(r"\b(how many|how much|what size|quantity)\b", re.I)
_NAMEQ = re.compile(r"\b(name)\b", re.I)
_ORDERQ = re.compile(r"\b(what can i get|what would you like|ready to order|take your order|what'll it be|"
                     r"what do you want|anything else|your order)\b", re.I)
_PHONEQ = re.compile(r"\b(phone number|callback number|best number|number to reach)\b", re.I)
_DOBQ = re.compile(r"\b(date of birth|birthday|dob)\b", re.I)
_PICKUPQ = re.compile(r"\b(pick ?up or delivery|delivery or pick ?up)\b", re.I)

_OPT_FILLER = {"a", "an", "the", "do", "you", "want", "would", "like", "prefer", "is", "it", "for", "that",
               "should", "we", "i", "get", "make", "go", "with", "how", "about", "or", "and", "will", "be",
               "rather", "have", "to", "your", "can", "could", "did", "like", "say"}


def _last_question(text: str) -> str:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    qs = [p for p in parts if p.endswith("?")]
    return qs[-1] if qs else parts[-1] if parts else text


_LEAD_IN = re.compile(r"^\W*(?:(?:hi|hey|hello|oh|so|and|okay|ok|well|alright|honey|sweetie)\b[^,?]{0,20},\s*)+", re.I)


def _strip_lead_in(q: str) -> str:
    """'Hi sweetie, are you coming?' -> 'are you coming?'"""
    return _LEAD_IN.sub("", q)


def extract_options(text: str) -> list[str]:
    q = _last_question(text).rstrip("?.! ")
    if not re.search(r"\bor\b", q, re.I):
        return []
    left, right = re.split(r"\bor\b", q, maxsplit=1, flags=re.I)
    # left may contain a comma list: "small, medium"
    left_items = [s.strip() for s in left.split(",")]
    head = left_items[-1].split()
    # take the shortest meaningful tail of the last left chunk
    tail: list[str] = []
    for w in reversed(head):
        if w.lower() in _OPT_FILLER and tail:
            break
        if w.lower() in _OPT_FILLER:
            continue
        tail.insert(0, w)
        if len(tail) >= 2:
            break
    right_words = [w for w in right.strip().split() if w.lower() not in {"the", "a", "an"}]
    right_opt = " ".join(right_words[: max(1, len(tail))]).strip(" ,")
    opts = [i for i in left_items[:-1] if i and len(i.split()) <= 3] + [" ".join(tail), right_opt]
    opts = [o.strip(" ,").rstrip("?") for o in opts if o.strip(" ,")]
    return opts if len(opts) >= 2 else []


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:] if s else s


class RulesBrain:
    name = "rules"

    async def parse_note(self, note: str) -> NoteParse:
        out = NoteParse()
        if not note.strip():
            return out
        for raw in re.split(r"[,;\n]|\band\s+(?=(?:name|tell|ask|my|pick|phone|deliver)\b)", note):
            part = raw.strip().rstrip(".")
            if not part:
                continue
            low = part.lower()
            m = re.match(r"(?:my\s+)?name(?:\s+is)?[:\s]+(.+)", part, re.I)
            if m:
                v = m.group(1).strip()
                out.auto_facts.append(NoteFact(key="name", value=v, say=f"It's {v}."))
                continue
            m = re.match(r"(?:order|get|i want|i'd like)[:\s]+(.+)", part, re.I)
            if m:
                v = m.group(1).strip()
                out.auto_facts.append(NoteFact(key="order", value=v, say=f"Hi, could I get {v}?"))
                continue
            m = re.match(r"(?:my\s+)?(?:phone|number|callback)(?:\s+is)?[:\s]+([\d\-\s\(\)\+]{7,})", part, re.I)
            if m:
                v = m.group(1).strip()
                out.auto_facts.append(NoteFact(key="phone", value=v, say=f"My number's {v}."))
                continue
            m = re.match(r"(?:dob|date of birth|birthday)[:\s]+(.+)", part, re.I)
            if m:
                v = m.group(1).strip()
                out.auto_facts.append(NoteFact(key="dob", value=v, say=f"My date of birth is {v}."))
                continue
            if low in {"pickup", "pick up", "pick-up", "for pickup", "delivery", "for delivery"}:
                v = "delivery" if "deliver" in low else "pickup"
                out.auto_facts.append(NoteFact(key="pickup_or_delivery", value=v, say=f"It's for {v}."))
                continue
            if re.search(r"\b(tell me|ask me|check with me|before|first|confirm)\b", low):
                out.needs_confirmation.append(part)
                continue
            out.needs_confirmation.append(part)
        return out

    async def analyze_turn(self, caller_text: str, context: dict) -> TurnAnalysis:
        t = caller_text.strip()
        a = TurnAnalysis()
        a.involves_money = guards.mentions_money(t)
        a.involves_commitment = guards.mentions_commitment(t)
        facts = {f["key"]: f for f in context.get("note_facts", [])}
        casual = context.get("casual", False)

        words = re.findall(r"[a-z']+", t.lower())
        if len(t) < 2 or (len(words) <= 2 and not re.search(r"[a-z]{3,}", t.lower())):
            a.unclear = True

        if _EMERG.search(t):
            a.question_type = "emergency"
            a.chips = ["I can't help with an emergency on this call.", "Please call 911."]
            return a
        if _CARD.search(t):
            a.question_type = "out_of_scope"
            a.involves_money = True
            a.chips = ["Can I pay when I pick it up?", "I'd rather pay in person.", "Could you say that again?"]
            return a
        if _ROBOT.search(t):
            a.question_type = "robot_check"
            a.chips = ["No, I'm a real person. I'm deaf, and an app is voicing what I sign.",
                       "Real person here, just signing!"]
            return a
        if _REPEAT.search(t):
            a.question_type = "repeat_request"
            return a
        if _PRESENCE.search(t):
            a.question_type = "presence_check"
            return a
        if _HOLD.search(t) and "?" not in t:
            a.question_type = "hold"
            return a

        q = _strip_lead_in(_last_question(t))
        is_q = t.rstrip().endswith("?") or bool(_YESNO_START.search(q)) or bool(_ORDERQ.search(t))
        opts = extract_options(t) if is_q else []

        if _PHONEQ.search(t) and "phone" in facts:
            a.question_type, a.note_fact_key = "info_request", "phone"
        elif _DOBQ.search(t) and "dob" in facts:
            a.question_type, a.note_fact_key = "info_request", "dob"
        elif _NAMEQ.search(t) and is_q and "name" in facts:
            a.question_type, a.note_fact_key = "info_request", "name"
        elif _PICKUPQ.search(t) and "pickup_or_delivery" in facts:
            a.question_type, a.note_fact_key = "options", "pickup_or_delivery"
            a.options = opts
        elif _ORDERQ.search(t) and "order" in facts and not context.get("order_given"):
            a.question_type, a.note_fact_key = "info_request", "order"
        elif a.involves_money and is_q:
            a.question_type = "price_confirm"
        elif opts:
            a.question_type, a.options = "options", opts
        elif _TIMEQ.search(q) and is_q:
            a.question_type = "time"
        elif _NUMQ.search(q) and is_q:
            a.question_type = "number"
        elif is_q and _YESNO_START.search(q):
            a.question_type = "yes_no"
        elif is_q and (_NAMEQ.search(t) or _PHONEQ.search(t) or _DOBQ.search(t)):
            a.question_type = "info_request"
        elif is_q:
            a.question_type = "open"
        elif _CLOSING.search(t):
            a.question_type = "closing"
        elif _GREETING.search(t):
            a.question_type = "greeting"
        else:
            a.question_type = "statement"
        a.chips = self._chips(a, t, casual)
        if a.unclear:
            a.chips = ["Could you say that again?"] + [c for c in a.chips if "again" not in c][:2]
        return a

    def _chips(self, a: TurnAnalysis, t: str, casual: bool) -> list[str]:
        qt = a.question_type
        if qt == "options":
            return [_cap(o) + ("!" if casual else ", please.") for o in a.options[:3]] + ["Hmm, not sure yet."]
        if qt == "price_confirm":
            return ["Yes, that's fine.", "Hmm, that's more than I expected.", "Could you say the total again?"]
        if qt == "yes_no":
            return (["Yeah!", "No, sorry.", "Maybe, let me check."] if casual
                    else ["Yes, please.", "No, thank you.", "Let me think for a sec."])
        if qt in ("time", "number"):
            return ["Let me check.", "Could you say that again?"]
        if qt == "info_request":
            return ["One sec, let me find that.", "Could you say that again?"]
        if qt == "closing":
            return (["Love you, bye!", "Talk soon!", "Bye!"] if casual
                    else ["Thank you, bye!", "Thanks so much, have a good one."])
        if qt == "greeting":
            return (["Hey! How are you?", "Hi!"] if casual else ["Hi, thanks for picking up."])
        if qt == "open":
            return ["Hmm, let me think.", "Could you say that again?"]
        return (["Yeah!", "Oh nice.", "Mm, okay."] if casual else ["Okay, thank you.", "Got it."])

    async def write_reply(self, signs: list[str], caller_text: str, context: dict, tone: Tone) -> str:
        return rules_sentence(signs, casual=context.get("casual", False), tone=tone)

    async def write_typed_reply(self, hint: str, caller_text: str, context: dict, tone: Tone) -> str:
        """Fast deterministic expansion for the demo and for provider outages.

        These patterns deliberately use only facts present in ``hint``. The generic
        fallback cleans punctuation but never invents a commitment or detail.
        """
        raw = " ".join((hint or "").strip().split())
        low = raw.lower()
        contact = str(context.get("contact_name") or "").strip()
        casual_name = f", {contact}," if contact and contact.lower() in {"mom", "dad", "mum"} else ""
        number_words = {
            "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
            "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten", "20": "twenty",
        }

        if re.search(r"\b(refund|return)\b", low) and re.search(r"\b(order|item|package)\b", low) \
                and re.search(r"\b(broken|damaged|cracked)\b", low):
            return "I'm calling because my order arrived damaged, and I'd like to request a refund."
        late = re.search(r"\b(late|delay(?:ed)?)\b", low)
        minutes = re.search(r"\b(\d{1,3})\b", low)
        if late and "traffic" in low and minutes:
            n = minutes.group(1)
            spoken_n = number_words.get(n, n)
            prefix = f"{contact}, " if contact.lower() in {"mom", "dad", "mum"} else ""
            return (f"{prefix}I'm running a little late because of traffic. "
                    f"I should be there in about {spoken_n} minutes.")
        when = re.search(r"\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", low)
        clock = re.search(r"\b(\d{1,2})(?::(\d{2}))?\b", low)
        if re.search(r"\b(yes|yeah|yep|sure)\b", low) and when and clock:
            hour = number_words.get(clock.group(1), clock.group(1))
            return f"Yes, {when.group(1)} at {hour} works for me."
        if re.search(r"\b(yes|yeah|yep|sure)\b", low) and "home" in low and clock:
            hour = number_words.get(clock.group(1), clock.group(1))
            return f"Yes{casual_name} I'll be home around {hour}.".replace(",,", ",")
        if low in {"yes", "yeah", "yep"}:
            return "Yeah!" if context.get("casual") else "Yes."
        if low in {"no", "nope"}:
            return "No, sorry." if context.get("casual") else "No, thank you."
        if not raw:
            return ""
        sentence = raw[:1].upper() + raw[1:]
        return sentence if sentence.endswith((".", "?", "!")) else sentence + "."

    async def translate(self, text: str, target: str, source: str = "") -> Optional[str]:
        """Rules can't translate. None means: not available (calls stay English)."""
        return None

    async def recap(self, transcript: list[dict]) -> list[str]:
        pts: list[str] = []
        for line in transcript:
            txt = line.get("text", "")
            if guards.extract_numbers(txt, include_ambiguous=False) or guards.extract_days(txt) \
                    or guards.mentions_commitment(txt):
                who = "You" if line.get("who") == "me" else line.get("name", "They")
                pts.append(f"{who}: {txt}")
        return pts[-3:] if pts else ["Nothing to note from this call."]


# -------------------------------------------------- gloss -> sentence templates

_PHRASE = {
    "THANK-YOU": "thank you", "HELLO": "hi", "HOW-ARE-YOU": "how are you?", "LOVE": "love you",
    "MISS-YOU": "miss you", "SEE-YOU-LATER": "see you later", "WAIT": "one sec", "AGAIN": "could you say that again?",
    "SLOW": "could you slow down a little?", "HELP": "can you help me?", "SORRY": "sorry", "PLEASE": "please",
    "CANCEL": "actually, can we cancel that?", "CHANGE": "can I change that?", "FINISH": "that's all",
    "PICK-UP": "pickup", "DELIVER": "delivery", "HOW-MUCH": "how much is it?", "WHEN": "when?",
    "WHERE": "where?", "WHAT": "what?", "NOW": "now", "LATER": "later", "TODAY": "today", "TOMORROW": "tomorrow",
    "MORNING": "in the morning", "AFTERNOON": "in the afternoon", "NIGHT": "tonight", "WEEK": "this week",
    "MORE": "more", "SMALL": "a small", "LARGE": "a large", "READY": "ready", "HOME": "home",
    "MAYBE": "maybe",
}
_STATES = {"GOOD": "good", "FINE": "fine", "BUSY": "busy", "TIRED": "tired", "HAPPY": "happy", "READY": "ready",
           "HOME": "home"}
_DAYS_G = {"MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"}
_WHEN_G = _DAYS_G | {"TODAY", "TOMORROW", "NOW", "LATER", "MORNING", "AFTERNOON", "NIGHT", "WEEK"}
_NUM_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
              "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"]


def _when_phrase(gl: list[str]) -> str:
    out = []
    for g in gl:
        if g in _DAYS_G:
            out.append(g.capitalize())
        elif g in _WHEN_G:
            out.append(_PHRASE[g])
    return " ".join(out)


def rules_sentence(signs: list[str], *, casual: bool, tone: str = "neutral") -> str:
    gl = [s.upper() for s in signs if s]
    if not gl:
        return ""
    parts: list[str] = []
    neg = any(g in {"NO", "NOT", "DON'T", "DONT"} for g in gl)
    hedge = "MAYBE" in gl
    rest = [g for g in gl if g not in {"YES", "NO", "NOT", "DON'T", "DONT", "MAYBE"}]
    if hedge:
        parts.append("Maybe.")
    elif gl[0] == "YES":
        parts.append("Yeah!" if casual else "Yes.")
    elif neg:
        parts.append("No," if rest else ("Nope." if casual else "No, thank you."))

    when = _when_phrase(rest)
    nums = [g for g in rest if g in (w.upper() for w in _NUM_WORDS) or g.isdigit()]
    num_txt = " ".join(n.lower() for n in nums)
    core = [g for g in rest if g not in _WHEN_G and g not in nums]

    def add(s: str) -> None:
        parts.append(s)

    if "COME" in core or "GO" in core:
        verb = "I'll be there" if "COME" in core else "I'll go"
        if neg:
            verb = "I can't make it" if "COME" in core else "I can't go"
        add(f"{verb}{(' ' + when) if when else ''}.")
        core = [c for c in core if c not in {"COME", "GO"}]
        when = ""
    if "WANT" in core or "NEED" in core or "ORDER" in core:
        items = [ _PHRASE.get(c, c.lower().replace("-", " ")) for c in core
                  if c not in {"WANT", "NEED", "ORDER", "PLEASE", "HAVE"}]
        obj = " ".join([num_txt] + items).strip() or "that"
        add(("I don't want " if neg else "I'd like ") + obj + (", please." if "PLEASE" in core or not casual else "."))
        core, num_txt = [], ""
    if "APPOINTMENT" in core:
        add(("I can't do " if neg else "Could I get an appointment ") + (when or "") + ".")
        core, when = [c for c in core if c != "APPOINTMENT"], ""
    for c in list(core):
        if c in _STATES and len(core) <= 2:
            add(f"I'm {'not ' if neg else ''}{_STATES[c]}.")
            core.remove(c)
    if num_txt:
        add(_cap(num_txt) + (", please." if not casual else "."))
    for c in core:
        p = _PHRASE.get(c)
        if p:
            add(_cap(p) + ("" if p.endswith("?") else "."))
        else:
            add(_cap(c.lower().replace("-", " ")) + ".")
    if when:
        add(_cap(when) + ".")

    s = " ".join(parts).replace(",.", ".").replace(" .", ".").strip()
    s = re.sub(r"\.\s*\.", ".", s)
    if tone == "question" and not s.endswith("?"):
        s = s.rstrip(".!") + "?"
    elif tone == "warm" and s.endswith(".") and casual:
        s = s[:-1] + "!"
    elif tone == "concerned" and not s.lower().startswith(("oh", "no", "sorry")):
        s = "Oh, " + s[:1].lower() + s[1:] if not s.startswith("I") else "Oh, " + s
    return s


# ====================================================================== gemini

SYSTEM_STYLE = """You help a Deaf person who signs ASL during a live phone call.
You never speak on your own. You only write or classify, and code checks your output.
Rules for any sentence you write:
- Write the way a person talks on the phone: contractions, short sentences, natural openers like "oh", "mm", "yeah".
- Casual with family and friends, polite with businesses.
- NEVER add a fact (number, price, name, day, time, date, item) the signer didn't sign, choose, or put in their note.
- If the signs include NO, NOT or DON'T, the sentence must say no.
- Only sound unsure (maybe, might, probably) if the signs include MAYBE; if they do, you must sound unsure.
- One sentence (two very short ones at most). No emoji. No stage directions.
- Never pretend the voice is the signer's own voice; never deny that an app is voicing for them."""


class GeminiBrain:
    name = "gemini"

    def __init__(self) -> None:
        from google import genai

        self.client = genai.Client(api_key=settings.gemini_api_key)
        self.model = settings.gemini_model
        self.reply_model = settings.gemini_reply_model or settings.gemini_model
        self.fallback = RulesBrain()
        self.ok: Optional[bool] = None
        self.last_error = ""
        self._thinking = True

    async def check(self) -> bool:
        try:
            for name in {self.model, self.reply_model}:
                m = await self.client.aio.models.get(model=name)
                log.info("Gemini model ok: %s", getattr(m, "name", name))
            self.ok = True
        except Exception as e:
            self.ok, self.last_error = False, f"model check failed: {e}"
            log.error("Gemini %s", self.last_error)
        return bool(self.ok)

    async def _json(self, prompt: str, schema: type[BaseModel], temperature: float = 0.3,
                    timeout: Optional[float] = None, *, job: str, model: Optional[str] = None) -> BaseModel:
        from google.genai import types

        cfg = dict(
            system_instruction=SYSTEM_STYLE,
            response_mime_type="application/json",
            response_schema=schema,
            temperature=temperature,
        )
        if self._thinking and settings.gemini_thinking_level:
            cfg["thinking_config"] = types.ThinkingConfig(thinking_level=settings.gemini_thinking_level.upper())
        t0 = time.perf_counter()
        try:
            resp = await asyncio.wait_for(
                self.client.aio.models.generate_content(
                    model=model or self.model, contents=prompt, config=types.GenerateContentConfig(**cfg)),
                timeout=timeout or settings.gemini_timeout_s)
        except Exception as e:
            latency.record(f"gemini_{job}_fail_ms", (time.perf_counter() - t0) * 1000)
            # A model that rejects the thinking setting: retry once without it, and say so in the log.
            if self._thinking and "thinking" in str(e).lower():
                log.warning("model rejected thinking_level; continuing without it: %s", e)
                self._thinking = False
                return await self._json(prompt, schema, temperature, timeout, job=job, model=model)
            raise
        ms = (time.perf_counter() - t0) * 1000
        latency.record(f"gemini_{job}_ms", ms)
        log.info("gemini %s (%s) %.0f ms", job, model or self.model, ms)
        parsed = resp.parsed
        if isinstance(parsed, schema):
            return parsed
        return schema.model_validate(json.loads(resp.text))

    async def parse_note(self, note: str) -> NoteParse:
        if not note.strip():
            return NoteParse()
        try:
            return await self._json(
                "Split the signer's note for an errand phone call into facts the app may say on its own "
                "(each with a short natural sentence that states only that fact) and things that need the "
                "signer's approval before being said (prices, payments, bookings, anything conditional like "
                f"'tell me the total first').\nNote: {note!r}", NoteParse, timeout=4.0, job="note_parser")
        except Exception as e:
            log.warning("note parser fallback: %s", e)
            return await self.fallback.parse_note(note)

    async def analyze_turn(self, caller_text: str, context: dict) -> TurnAnalysis:
        rules = await self.fallback.analyze_turn(caller_text, context)
        # Safety-relevant classes are decided by deterministic code, not the model.
        if rules.question_type in {"emergency", "out_of_scope", "repeat_request", "presence_check", "hold",
                                   "robot_check"}:
            return rules
        try:
            a = await self._json(
                "Classify the caller's latest words in a phone call and suggest 2-4 short replies the signer "
                "could tap. Replies must not invent facts (no numbers, prices, days or names that the caller "
                "or the note didn't mention). If a note fact answers the question, give its key.\n"
                f"Contact: {context.get('contact_name')} ({'family/friend' if context.get('casual') else 'business'})\n"
                f"Note facts: {json.dumps(context.get('note_facts', []))}\n"
                f"Facts from the signer's video (a chip may repeat one word for word): {json.dumps(context.get('video_facts', []))}\n"
                f"Recent lines: {json.dumps(context.get('recent', [])[-6:])}\n"
                f"Caller just said: {caller_text!r}", TurnAnalysis, timeout=2.0, job="turn_analyzer")
        except Exception as e:
            log.warning("turn analyzer fallback: %s", e)
            return rules
        # Money / commitment flags are OR-ed with code so the model can't clear them.
        a.involves_money = a.involves_money or rules.involves_money
        a.involves_commitment = a.involves_commitment or rules.involves_commitment or a.involves_money
        a.unclear = a.unclear or rules.unclear
        if a.unclear and (not a.chips or "again" not in a.chips[0].lower()):
            a.chips = ["Could you say that again?"] + a.chips[:2]
        known = {f["key"] for f in context.get("note_facts", [])}
        if a.note_fact_key not in known:
            a.note_fact_key = None
        if a.question_type == "options" and not a.options:
            a.options = rules.options
        a.chips = [c for c in a.chips if c.strip()][:4] or rules.chips
        return a

    async def write_reply(self, signs: list[str], caller_text: str, context: dict, tone: Tone) -> str:
        try:
            r = await self._json(
                "Write what the signer means as one sentence to be spoken out loud on the phone.\n"
                f"Signs (ASL gloss, in order): {' '.join(signs)}\n"
                f"Tone: {tone} (warm = upbeat, question = ask it as a question, concerned = gentle)\n"
                f"Talking to: {context.get('contact_name')} ({'family/friend, casual' if context.get('casual') else 'business, polite'})\n"
                f"Caller just said: {caller_text!r}\n"
                f"Note facts you may use: {json.dumps([f['value'] for f in context.get('note_facts', [])])}\n"
                f"Facts from the signer's video you may use: {json.dumps(context.get('video_facts', []))}\n"
                "Example: signs YES SUNDAY COME, casual -> \"Yeah! I'll be there Sunday.\"",
                Reply, temperature=0.5, timeout=1.5, job="reply_writer", model=self.reply_model)
            return r.sentence.strip()
        except Exception as e:
            log.warning("reply writer fallback: %s", e)
            return rules_sentence(signs, casual=context.get("casual", False), tone=tone)

    async def write_typed_reply(self, hint: str, caller_text: str, context: dict, tone: Tone) -> str:
        """Expand shorthand into one editable sentence; never speak from this method."""
        try:
            r = await self._json(
                "Turn the user's shorthand into one concise, natural sentence they may approve for a phone call.\n"
                "Preserve every fact and the intended yes/no meaning. Do not add names, numbers, dates, prices, "
                "commitments, reasons, or personal details. If meaning is ambiguous, minimally tidy the exact words.\n"
                f"User shorthand: {hint!r}\n"
                f"Caller just said: {caller_text!r}\n"
                f"Talking to: {context.get('contact_name')} "
                f"({'family/friend, casual' if context.get('casual') else 'business, polite'})\n"
                f"Recent conversation: {json.dumps(context.get('recent', [])[-6:])}",
                Reply, temperature=0.2, timeout=2.0, job="typed_reply", model=self.reply_model)
            return r.sentence.strip()
        except Exception as e:
            log.warning("typed reply fallback: %s", e)
            return await self.fallback.write_typed_reply(hint, caller_text, context, tone)

    async def translate(self, text: str, target: str, source: str = "") -> Optional[str]:
        """One line, for a call in another language. The caller checks the result with
        translate.translation_guard before anything is spoken. None on failure."""
        from .translate import TRANSLATE_RULES
        if not text.strip():
            return ""
        try:
            r = await self._json(
                f"{TRANSLATE_RULES}\nFrom: {source or 'auto-detect'}\nTo: {target}\nText: {text!r}",
                Reply, temperature=0.1, timeout=2.5, job="translate")
            return r.sentence.strip()
        except Exception as e:
            log.warning("translate failed: %s", e)
            return None

    async def recap(self, transcript: list[dict]) -> list[str]:
        try:
            r = await self._json(
                "From this phone call transcript, give 2-3 short 'worth remembering' points (plans, times, "
                "prices, what was agreed). Only facts stated in the transcript.\n"
                + json.dumps(transcript), Recap, timeout=5.0, job="recap")
            return r.points[:3]
        except Exception as e:
            log.warning("recap fallback: %s", e)
            return await self.fallback.recap(transcript)


def make_brain():
    if settings.gemini_ready:
        return GeminiBrain()
    log.warning("Gemini not configured: using RulesBrain")
    return RulesBrain()


