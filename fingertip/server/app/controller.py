"""Deterministic call controller.

States: RINGING -> CONNECTED -> LISTENING <-> CALLER_TALKING -> YOUR_TURN -> DRAFT_READY
        -> SPEAKING -> LISTENING, plus CONFIRMING, ON_HOLD, ENDED.

The controller decides what is said and when. The AI only writes and
classifies. Every outgoing line goes through `_speak`, which is the single
place that talks to Twilio.
"""
from __future__ import annotations

import asyncio
import itertools
import logging
import secrets
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Awaitable, Callable, Optional

from . import guards, relay, translate
from .ai import TurnAnalysis
from .latency import latency

log = logging.getLogger("controller")

RINGING, CONNECTED, LISTENING, CALLER_TALKING = "RINGING", "CONNECTED", "LISTENING", "CALLER_TALKING"
YOUR_TURN, DRAFT_READY, SPEAKING, CONFIRMING = "YOUR_TURN", "DRAFT_READY", "SPEAKING", "CONFIRMING"
ON_HOLD, ENDED = "ON_HOLD", "ENDED"

AUTO, QUICK, CONFIRM = "auto", "quick", "confirm"

# The heads-up depends on how the signer describes themself (Settings); see translate.intro().
INTRO = translate.intro(None, "deaf")
INTRO_ORDER = translate.intro(None, "deaf", order=True)
FILLERS_1 = ["Mm, one sec...", "Mm, just a sec...", "Okay, one sec..."]
FILLERS_2 = ["Sorry, just a moment...", "Sorry, one more second..."]
PRESENCE = ["Yeah, still here!", "Yep, I'm here! One sec."]
FILLER_1_AFTER_S = 2.0
FILLER_2_AFTER_S = 8.0
MAX_FILLERS_PER_TURN = 2

_ids = itertools.count(1)


def _nid(prefix: str) -> str:
    return f"{prefix}{next(_ids)}"


@dataclass
class Contact:
    id: str = ""
    name: str = "Unknown"
    number: str = ""
    knows_sign: bool = False
    kind: str = "person"          # person | business
    style: str = ""               # casual | polite ("" = casual for people who know I sign)
    language: str = ""            # BCP-47 the other person speaks ("" = English); see translate.py

    @property
    def casual(self) -> bool:
        if self.style:
            return self.style == "casual"
        return self.kind == "person" and self.knows_sign


@dataclass
class Line:
    id: str
    who: str                      # caller | me
    text: str
    status: str = "final"         # caller: partial|final ; me: speaking|spoken|interrupted
    level: str = ""
    kind: str = ""                # intro | filler | presence | repeat | fact | reply
    unclear: bool = False
    heard: str = ""               # when cut off: the part the caller heard
    original: str = ""            # other-language calls: the caller's own words (text is the English)
    spoken: str = ""              # other-language calls: what the caller actually heard
    ts: float = field(default_factory=time.time)


@dataclass
class Draft:
    id: str
    text: str
    source: str                   # signs | chip | typed | fact
    signs: list[str] = field(default_factory=list)
    level: str = QUICK
    confirm_summary: str = ""
    problems: list[str] = field(default_factory=list)
    blocked: bool = False
    tone: str = "neutral"
    hash: str = ""                # approval is bound to this (exact text + current terms)


Emit = Callable[[dict], Awaitable[None]]


class Controller:
    def __init__(self, session_id: str, contact: Contact, brain, *, direction: str, note: str = "",
                 voice_id: Optional[str] = None, emit: Optional[Emit] = None, time_scale: float = 1.0,
                 intro_style: str = "deaf") -> None:
        self.intro_style = intro_style if intro_style in translate.INTRO_STYLES else "deaf"
        self.id = session_id
        self.contact = contact
        self.brain = brain
        self.direction = direction
        self.note = note
        self.voice_id = voice_id
        self.emit_fn = emit
        self.ts = time_scale          # tests run timers faster
        self.lang = translate.lang_for(contact.language)   # None = English call

        self.state = RINGING
        self.call_sid = ""
        self.lines: list[Line] = []
        self.caption: Optional[Line] = None
        self.draft: Optional[Draft] = None
        self.analysis: Optional[TurnAnalysis] = None
        self.note_facts: list[dict] = []
        self.note_confirm: list[str] = []
        self.video_facts: list[dict] = []      # Show it: facts from the signer's clip (never auto-spoken)
        self.video_id = ""
        self.order_given = False
        self.intro_done = contact.knows_sign
        self.started_at: Optional[float] = None
        self.ended_reason = ""
        self.recap: list[str] = []
        self.mode = "ai_assist"

        self._relay_send: Optional[Callable[[str], Awaitable[None]]] = None
        self._queue: list[tuple] = []      # (text, level, kind, bypass_dup, draft, tone, spoken)
        self._speaking: Optional[Line] = None
        self._speaking_draft: Optional[Draft] = None
        self._speak_task: Optional[asyncio.Task] = None
        self._filler_task: Optional[asyncio.Task] = None
        self._fillers_this_turn = 0
        self._last_filler = ""
        self._last_caller_text = ""
        self._turn_seq = 0
        self._sent_this_turn = False
        self._awaiting_reply = False     # caller said something that wants an answer
        self.dup = guards.DuplicateGuard(10.0, clock=lambda: time.monotonic() / self.ts)
        self.spoken_log: list[tuple[float, str, str]] = []      # (t, kind, text) for tests

    # ------------------------------------------------------------ plumbing

    async def emit(self, msg: dict) -> None:
        msg.setdefault("sid", self.id)
        if self.emit_fn:
            try:
                await self.emit_fn(msg)
            except Exception:  # an app socket problem must never break the call
                log.exception("emit failed")

    async def _set_state(self, s: str) -> None:
        if self.state != s:
            self.state = s
            await self.emit({"type": "state", "state": s})

    @property
    def _intro_order(self) -> bool:
        return any(f["key"] == "order" for f in self.note_facts)

    @property
    def intro_text(self) -> str:
        return translate.intro(None, self.intro_style, self._intro_order)

    @property
    def default_tone(self) -> str:
        """MVP tone: from the contact's talk style (or what the signer picks)."""
        return "warm" if self.contact.casual else "neutral"

    def _seal(self, d: Draft) -> Draft:
        d.hash = guards.approval_hash(d.text, self._last_caller_text)
        return d

    def _fresh(self, d: Draft) -> bool:
        return bool(d.hash) and d.hash == guards.approval_hash(d.text, self._last_caller_text)

    def context(self) -> dict:
        return {
            "contact_name": self.contact.name,
            "casual": self.contact.casual,
            "note_facts": self.note_facts,
            "video_facts": [f["say"] for f in self.video_facts],
            "order_given": self.order_given,
            "recent": [{"who": l.who, "text": l.text} for l in self.lines[-8:]],
        }

    def snapshot(self) -> dict:
        return {
            "type": "snapshot",
            "sid": self.id,
            "state": self.state,
            "direction": self.direction,
            "contact": asdict(self.contact),
            "started_at": self.started_at,
            "lines": [asdict(l) for l in self.lines],
            "caption": asdict(self.caption) if self.caption else None,
            "draft": asdict(self.draft) if self.draft else None,
            "analysis": self.analysis.model_dump() if self.analysis else None,
            "recap": self.recap,
            "ended_reason": self.ended_reason,
            "mode": self.mode,
        }

    async def _line(self, line: Line, new: bool = True) -> None:
        if new:
            self.lines.append(line)
        await self.emit({"type": "line", "line": asdict(line)})

    # ------------------------------------------------------------ setup

    async def load_note(self) -> None:
        if not self.note.strip():
            return
        parsed = await self.brain.parse_note(self.note)
        self.note_facts = [f.model_dump() for f in parsed.auto_facts]
        self.note_confirm = list(parsed.needs_confirmation)

    async def attach_relay(self, send: Callable[[str], Awaitable[None]], setup: dict) -> None:
        reconnect = self._relay_send is not None or self.state not in (RINGING, CONNECTED)
        self._relay_send = send
        self.call_sid = setup.get("callSid", self.call_sid)
        if reconnect:
            log.info("%s relay reattached", self.id)
            return
        self.started_at = self.started_at or time.time()
        await self._set_state(CONNECTED)
        if self.direction == "incoming":
            if not self.intro_done:
                await self._auto(self.intro_text, "intro")
                self.intro_done = True
            elif self.contact.casual:
                await self._auto("Hey!", "greeting")
        if self.state == CONNECTED:
            await self._set_state(LISTENING)

    def detach_relay(self) -> None:
        self._relay_send = None

    # ------------------------------------------------------------ caller side

    async def on_prompt(self, text: str, last: bool) -> None:
        if self.state == ENDED or not text:
            return
        if not last:
            self._cancel_fillers()
            if self.caption is None:
                self.caption = Line(id=_nid("c"), who="caller", text=text, status="partial")
            else:
                self.caption.text = text
            await self.emit({"type": "caption", "line": asdict(self.caption)})
            if self.state not in (SPEAKING, CONFIRMING, ON_HOLD):
                await self._set_state(CALLER_TALKING)
            return

        t0 = time.perf_counter()
        line = self.caption or Line(id=_nid("c"), who="caller", text=text)
        self.caption = None
        self._turn_seq += 1
        turn = self._turn_seq
        if self.lang:
            # Everything downstream (captions, analyzer, guards, approvals) works on English.
            line.original = text
            en = await self.brain.translate(text, "English", self.lang.english_name)
            if en:
                text = en
            else:
                await self.emit({"type": "notice", "kind": "translate",
                                 "text": "Couldn't translate that. Showing their own words."})
            if turn != self._turn_seq or self.state == ENDED:
                line.text, line.status = text, "final"    # a newer turn owns the screen; still caption this
                await self._line(line)
                return
        line.text, line.status = text, "final"
        self._last_caller_text = text
        self._fillers_this_turn = 0
        self._sent_this_turn = False
        self._awaiting_reply = True
        await self._line(line)
        latency.record("caption_emit_ms", (time.perf_counter() - t0) * 1000)

        # Outgoing calls: first thing they say gets the intro.
        if not self.intro_done:
            self.intro_done = True
            await self._auto(self.intro_text, "intro")

        a = await self.brain.analyze_turn(text, self.context())
        if turn != self._turn_seq or self.state == ENDED:
            return          # caller kept talking; a newer turn owns the screen
        a.chips = self._safe_chips(a.chips, text)
        self.analysis = a
        if a.unclear:
            line.unclear = True
            await self._line(line, new=False)

        qt = a.question_type
        if self.state == ON_HOLD and qt != "hold":
            await self._set_state(LISTENING)
        if qt in ("hold", "closing"):
            self._awaiting_reply = qt == "closing"
        if qt == "hold":
            await self._set_state(ON_HOLD)
            await self.emit({"type": "turn", "analysis": a.model_dump()})
            return
        if qt == "repeat_request":
            last_me = next((l for l in reversed(self.lines) if l.who == "me" and l.kind != "filler"), None)
            if last_me:
                await self._auto(last_me.text, "repeat", bypass_dup=True, spoken=last_me.spoken or None)
                return
            await self._auto("Sorry, one sec...", "filler")
            return
        if qt == "presence_check":
            await self._auto(self._pick(PRESENCE, ""), "presence")
            self._schedule_fillers(turn)
            await self._your_turn(a)
            return
        if a.note_fact_key:
            fact = next((f for f in self.note_facts if f["key"] == a.note_fact_key), None)
            if fact:
                needs, summary = guards.commitment_guard(fact["say"], text)
                if fact["key"] == "order":
                    self.order_given = True
                if not needs:
                    # A new question from the caller always gets its answer, even if we said the
                    # same words a few seconds ago (the duplicate guard is for accidental repeats).
                    await self._auto(fact["say"], "fact", bypass_dup=True)
                    return
                self.draft = self._seal(Draft(id=_nid("d"), text=fact["say"], source="fact", level=CONFIRM,
                                              confirm_summary=summary))
                await self._open_confirm()
                return
        if qt == "emergency":
            await self.emit({"type": "notice", "kind": "emergency",
                             "text": "This app can't handle emergencies. Text 911 if you need help."})
        await self._your_turn(a)
        if qt not in ("closing",):
            self._schedule_fillers(turn)

    def _idle_state(self) -> str:
        if self.draft and not self.draft.blocked:
            return DRAFT_READY
        return YOUR_TURN if self._awaiting_reply else LISTENING

    async def _your_turn(self, a: TurnAnalysis) -> None:
        if self.state in (SPEAKING, CONFIRMING):
            await self.emit({"type": "turn", "analysis": a.model_dump()})
            return
        await self._set_state(self._idle_state())
        await self.emit({"type": "turn", "analysis": a.model_dump()})

    @property
    def _video_text(self) -> str:
        return " ".join(f["say"] for f in self.video_facts)

    async def attach_video(self, facts: list[dict], summary: str, show_id: str) -> dict:
        """Show it: the signer's clip becomes approvable replies and allowed facts. Nothing is said here."""
        if self.state == ENDED:
            return {"ok": False, "reason": "The call has ended."}
        self.video_facts = [f for f in facts if f.get("say")]
        self.video_id = show_id
        await self.emit({"type": "video_facts", "show_id": show_id, "facts": self.video_facts, "summary": summary})
        if summary:
            self.draft = self._check_draft(summary, [], source="video", tone=self.default_tone)
            await self.emit({"type": "draft", "draft": asdict(self.draft)})
            if self.state in (LISTENING, YOUR_TURN):       # never jump past ringing / connecting
                await self._set_state(DRAFT_READY)
        return {"ok": True, "facts": len(self.video_facts), "draft": asdict(self.draft) if summary and self.draft else None}

    async def add_video_fact(self, fact: dict) -> None:
        """An answer found in the clip during the call: offered like the other facts, never auto-spoken."""
        self.video_facts = [f for f in self.video_facts if f["id"] != fact["id"]] + [fact]
        await self.emit({"type": "video_facts", "show_id": self.video_id, "facts": self.video_facts,
                         "summary": "", "answer": fact})

    def _safe_chips(self, chips: list[str], caller_text: str) -> list[str]:
        """Chips are AI-written: drop any that invent a fact."""
        sources = [caller_text, self.note, " ".join(f["value"] for f in self.note_facts), self._video_text]
        out = [c for c in chips if guards.fact_guard(c, sources).ok]
        if not out:
            out = ["Could you say that again?"]
        return out[:4]

    async def on_interrupt(self, utterance: str = "") -> None:
        """Caller talked over us: stop, keep the draft, go back to listening."""
        if self._speak_task:
            self._speak_task.cancel()
            self._speak_task = None
        # A reply the signer approved may be waiting behind another line (a filler, the greeting).
        # Interrupting must not lose it: it comes back as the draft below.
        queued_reply = next((q for q in self._queue if q[2] == "reply"), None)
        self._queue.clear()
        if self._speaking:
            sp = self._speaking
            sp.status = "interrupted"
            heard = (utterance or "").strip()
            if heard and (sp.spoken or sp.text).startswith(heard):
                sp.heard = heard
            await self._line(sp, new=False)
            if self._speaking_draft or sp.kind == "reply":
                # Other-language calls: what was heard is in their language, so keep the whole English line.
                rest = sp.text[len(sp.heard):].strip(" ,.") if sp.heard and not sp.spoken else sp.text
                # Keep the unsaid part as the draft: the signer can say the rest or drop it.
                self.draft = Draft(id=_nid("d"), text=rest[:1].upper() + rest[1:] if rest else sp.text,
                                   source="rest", level=QUICK)
                if self._speaking_draft:
                    self.draft.tone = self._speaking_draft.tone
                self._seal(self.draft)
                self.dup._recent.pop(guards.normalize_line(self.draft.text), None)
                self.dup._recent.pop(guards.normalize_line(sp.text), None)
                await self.emit({"type": "draft", "draft": asdict(self.draft)})
        if queued_reply and not (self._speaking_draft or (self._speaking and self._speaking.kind == "reply")):
            text_q, _lvl, _kind, _byp, draft_q, tone_q, _spoken = queued_reply
            self.draft = Draft(id=_nid("d"), text=text_q, source="rest", level=QUICK)
            if draft_q:
                self.draft.tone = draft_q.tone
            else:
                self.draft.tone = tone_q
            self._seal(self.draft)
            self.dup._recent.pop(guards.normalize_line(text_q), None)
            await self.emit({"type": "draft", "draft": asdict(self.draft)})
        self._speaking = None
        self._speaking_draft = None
        self._cancel_fillers()
        await self._set_state(CALLER_TALKING)

    # ------------------------------------------------------------ signer side

    async def draft_from_signs(self, signs: list[str], tone: str = "", signs_end_t: Optional[float] = None
                               ) -> Draft:
        """Called as signs arrive, so the draft is ready (and sealed) before the signer taps Send."""
        t0 = signs_end_t or time.perf_counter()
        tone = tone or self.default_tone
        caller = self._last_caller_text
        sentence = await self.brain.write_reply(signs, caller, self.context(), tone)
        d = self._check_draft(sentence, signs, source="signs", tone=tone)
        if d.blocked and getattr(self.brain, "fallback", None):
            alt = await self.brain.fallback.write_reply(signs, caller, self.context(), tone)
            d2 = self._check_draft(alt, signs, source="signs", tone=tone)
            if not d2.blocked:
                d = d2
        self.draft = d
        latency.record("draft_ms", (time.perf_counter() - t0) * 1000)
        if self.state not in (SPEAKING, CONFIRMING, ENDED):
            await self._set_state(DRAFT_READY)
        await self.emit({"type": "draft", "draft": asdict(d)})
        return d

    async def set_mode(self, mode: str) -> None:
        self.mode = mode
        await self.emit({"type": "mode", "mode": mode})

    async def draft_from_text(self, text: str, mode: str = "ai_assist", tone: str = "") -> Draft:
        """Create an editable, sealed preview. This method never sends audio."""
        hint = (text or "").strip()
        tone = tone or self.default_tone
        if mode == "ai_assist":
            sentence = await self.brain.write_typed_reply(hint, self._last_caller_text, self.context(), tone)
            source, evidence = "ai", hint.split()
        else:
            sentence, source, evidence = hint, "typed", []
        d = self._check_draft(sentence, evidence, source=source, tone=tone)
        self.draft = d
        if self.state not in (SPEAKING, CONFIRMING, ENDED):
            await self._set_state(DRAFT_READY)
        await self.emit({"type": "draft", "draft": asdict(d), "mode": mode})
        return d

    async def caption_only(self, text: str, source: str = "typed") -> dict:
        """Publish the signer's words to captions without sending anything to TTS."""
        if self.state == ENDED:
            return {"ok": False, "reason": "The call has ended.", "spoken": False}
        exact = (text or "").strip()
        if not exact:
            return {"ok": False, "reason": "Nothing to caption.", "spoken": False}
        line = Line(id=_nid("m"), who="me", text=exact, status="caption", level=QUICK, kind="caption")
        await self._line(line)
        await self.emit({"type": "local_caption", "text": exact, "source": source})
        return {"ok": True, "spoken": False, "caption": exact}

    def _check_draft(self, sentence: str, signs: list[str], *, source: str, tone: str = "neutral") -> Draft:
        d = Draft(id=_nid("d"), text=sentence, source=source, signs=list(signs), tone=tone)
        caller = self._last_caller_text
        chips = " ".join(self.analysis.chips) if self.analysis else ""
        if source in {"signs", "ai"}:
            fg = guards.fact_guard(sentence, [guards.gloss_text(signs), caller, self.contact.name,
                                               self.note, chips, self._video_text])
            ng = guards.negation_guard(sentence, signs)
            hg = guards.hedge_guard(sentence, signs)
            d.problems = fg.problems + ng.problems + hg.problems
            d.blocked = bool(d.problems)
        elif source == "video":
            # The opening summary is model-written: every number, day and name must be in the facts.
            fg = guards.fact_guard(sentence, [self._video_text, self.note, caller])
            d.problems = fg.problems
            d.blocked = bool(d.problems)
        flag = bool(self.analysis and self.analysis.involves_commitment)
        needs, summary = guards.commitment_guard(sentence, caller, flag)
        if not needs and self.analysis and self.analysis.question_type == "info_request" and source != "fact":
            new_facts = guards.fact_guard(sentence, [caller, self.note, self._video_text]).unsupported
            if new_facts:
                needs, summary = True, "This shares something that isn't in your note"
        if needs:
            d.level, d.confirm_summary = CONFIRM, summary
        return self._seal(d)

    async def send(self, text: str, source: str = "typed", signs: Optional[list[str]] = None,
                   draft_id: Optional[str] = None, force: bool = False, hash: Optional[str] = None,
                   tone: str = "") -> dict:
        """Signer tapped Send. Typed text and chips already are the reply: no model call, just guards.
        A signed draft must present the hash it was shown with."""
        if self.state == ENDED:
            return {"ok": False, "reason": "The call has ended."}
        text = (text or "").strip()
        if not text:
            return {"ok": False, "reason": "Nothing to send."}
        if source == "draft":
            d = self.draft
            if not d or d.text != text or not hash or hash != d.hash or not self._fresh(d):
                if d:
                    d = self._check_draft(d.text, d.signs, source="signs" if d.signs else d.source, tone=d.tone)
                    self.draft = d
                    await self.emit({"type": "draft", "draft": asdict(d)})
                return {"ok": False, "stale": True, "reason": "That reply changed. Check it and send again."}
        else:
            d = self._check_draft(text, [], source=source, tone=tone or self.default_tone)
        if d.blocked and not force:
            self.draft = d
            await self.emit({"type": "draft", "draft": asdict(d)})
            return {"ok": False, "reason": d.problems[0] if d.problems else "Blocked"}
        if not force and not self.dup.check(d.text):
            return {"ok": False, "reason": "You just said that."}
        self.draft = d
        if d.level == CONFIRM:
            await self._open_confirm()
            return {"ok": True, "confirm": True}
        if not await self._speak_draft(d):
            return {"ok": False, "reason": d.problems[0] if d.problems else "Not sent."}
        return {"ok": True}

    async def _open_confirm(self) -> None:
        d = self.draft
        assert d
        await self._set_state(CONFIRMING)
        await self.emit({"type": "confirm", "draft": asdict(d), "hash": d.hash,
                         "summary": d.confirm_summary, "sentence": d.text})

    async def confirm(self, decision: str, hash: Optional[str] = None) -> dict:
        if self.state != CONFIRMING or not self.draft:
            return {"ok": False, "reason": "Nothing to confirm."}
        d = self.draft
        if decision == "yes" and (not hash or hash != d.hash or not self._fresh(d)):
            # The words or the terms changed since the sheet opened: show it again with the new terms.
            self.draft = self._check_draft(d.text, d.signs, source="signs" if d.signs else d.source, tone=d.tone)
            if self.draft.level != CONFIRM:
                self.draft.level = CONFIRM
                self.draft.confirm_summary = d.confirm_summary
            await self._open_confirm()
            return {"ok": False, "stale": True, "reason": "The details changed. Check again."}
        await self.emit({"type": "confirm_closed"})
        if decision == "yes":
            if not await self._speak_draft(d):
                return {"ok": False, "reason": d.problems[0] if d.problems else "Not sent."}
            return {"ok": True}
        # "change" and "not yet": keep the draft, say nothing.
        await self._set_state(DRAFT_READY)
        await self.emit({"type": "draft", "draft": asdict(d), "edit": decision == "change"})
        return {"ok": True}

    async def clear_draft(self) -> None:
        self.draft = None
        await self.emit({"type": "draft", "draft": None})
        if self.state == DRAFT_READY:
            await self._set_state(self._idle_state())

    async def _speak_draft(self, d: Draft) -> bool:
        spoken = None
        if self.lang:
            spoken, problem = await self._localize(d.text)
            if problem:
                # Nothing is said. The approved English stays as the draft; the signer can retry or edit.
                d.problems = [problem]
                self.draft = d
                await self.emit({"type": "notice", "kind": "translate", "text": problem})
                await self.emit({"type": "draft", "draft": asdict(d)})
                if self.state != ENDED:
                    await self._set_state(DRAFT_READY)
                return False
        self._sent_this_turn = True
        self._awaiting_reply = False
        self._cancel_fillers()
        self.draft = None
        await self.emit({"type": "draft", "draft": None})
        await self._speak(d.text, d.level, "reply", draft=d, tone=d.tone, spoken=spoken)
        return True

    # ------------------------------------------------------------ speaking

    async def _localize(self, text: str) -> tuple[Optional[str], str]:
        """English line -> (what the caller will hear, problem). English calls: (None, "")."""
        if not self.lang:
            return None, ""
        fixed = (translate.intro(self.lang, self.intro_style, self._intro_order) if text == self.intro_text
                 else translate.fixed_line(self.lang, text))
        if fixed:
            return fixed, ""
        t0 = time.perf_counter()
        out = await self.brain.translate(text, self.lang.english_name, "English")
        latency.record("translate_out_ms", (time.perf_counter() - t0) * 1000)
        if not out:
            return None, "Couldn't translate that, so nothing was said."
        g = translate.translation_guard(text, out, self.lang)
        if not g.ok:
            log.warning("translation blocked (%s): %r -> %r", g.problems, text, out)
            return None, f"Not said: {g.problems[0]}."
        return out, ""

    async def _auto(self, text: str, kind: str, bypass_dup: bool = False, spoken: Optional[str] = None) -> None:
        if self.lang and spoken is None:
            spoken, problem = await self._localize(text)
            if problem:
                await self.emit({"type": "notice", "kind": "translate", "text": problem})
                return
        if kind in ("fact", "repeat"):
            self._awaiting_reply = False
        if kind not in ("filler",):
            self._sent_this_turn = True
            self._cancel_fillers()
        await self._speak(text, AUTO, kind, bypass_dup=bypass_dup, spoken=spoken)

    async def _speak(self, text: str, level: str, kind: str, *, bypass_dup: bool = False,
                     draft: Optional[Draft] = None, tone: str = "neutral", spoken: Optional[str] = None) -> bool:
        """`text` is always the English line; `spoken` is what the caller hears on other-language calls."""
        if self.state == ENDED:
            return False
        if self.lang and spoken is None:
            # Only fixed lines (fillers) get here without a translation; they're pre-written.
            spoken = translate.fixed_line(self.lang, text)
            if spoken is None:
                log.warning("no translation for %r; not spoken", text)
                return False
        if not bypass_dup and not self.dup.check(text):
            log.info("duplicate blocked: %s", text)
            return False
        if self._speaking is not None:
            # One outgoing line at a time. A new reply replaces a queued reply.
            if kind == "reply":
                self._queue = [q for q in self._queue if q[2] != "reply"]
            if kind == "filler":
                return False
            self.dup.mark(text)
            self._queue.append((text, level, kind, bypass_dup, draft, tone, spoken))
            return True
        t0 = time.perf_counter()
        line = Line(id=_nid("m"), who="me", text=text, status="speaking", level=level, kind=kind,
                    spoken=spoken or "")
        self.dup.mark(text)
        self.spoken_log.append((time.monotonic() / self.ts, kind, text))
        if self._relay_send:
            try:
                await self._relay_send(relay.text_message(relay.spoken_token(spoken or text, tone)))
            except Exception:
                log.exception("relay send failed")
                await self.emit({"type": "error", "message": "Couldn't reach the call. Trying again..."})
        latency.record("send_dispatch_ms", (time.perf_counter() - t0) * 1000)
        self._speaking = line
        self._speaking_draft = draft
        await self._line(line)
        await self._set_state(SPEAKING)
        self._speak_task = asyncio.create_task(self._finish_speaking(line, spoken or text))
        return True

    async def _finish_speaking(self, line: Line, text: str) -> None:
        # ConversationRelay doesn't report when playback ends, so estimate it.
        words = max(1, len(text.split()))
        await asyncio.sleep((0.35 + words / 2.8) * self.ts)
        if self._speaking is not line:
            return
        line.status = "spoken"
        self._speaking = None
        self._speaking_draft = None
        self._speak_task = None
        await self._line(line, new=False)
        if self._queue:
            text2, level2, kind2, byp, d2, tone2, spoken2 = self._queue.pop(0)
            await self._speak(text2, level2, kind2, bypass_dup=True, draft=d2, tone=tone2, spoken=spoken2)
            return
        if self.state == SPEAKING:
            await self._set_state(self._idle_state())

    async def stop_speaking(self) -> None:
        """Signer tapped Stop. Lines are sent preemptible, so a near-silent line cuts the current one."""
        self._queue.clear()
        if not self._speaking:
            return
        if self._relay_send:
            try:
                await self._relay_send(relay.text_message("..."))
            except Exception:
                log.exception("stop failed")
        await self.on_interrupt("")

    # ------------------------------------------------------------ fillers

    def _schedule_fillers(self, turn: int) -> None:
        self._cancel_fillers()
        self._filler_task = asyncio.create_task(self._filler_loop(turn))

    def _cancel_fillers(self) -> None:
        if self._filler_task and self._filler_task is not asyncio.current_task():
            self._filler_task.cancel()
        self._filler_task = None

    async def _filler_loop(self, turn: int) -> None:
        try:
            start = time.monotonic()
            for after, bank in ((FILLER_1_AFTER_S, FILLERS_1), (FILLER_2_AFTER_S, FILLERS_2)):
                wait = after * self.ts - (time.monotonic() - start)
                if wait > 0:
                    await asyncio.sleep(wait)
                if turn != self._turn_seq or self._sent_this_turn:
                    return
                if self.state in (CALLER_TALKING, ON_HOLD, ENDED, LISTENING) or self.caption is not None:
                    return
                while self._speaking is not None:      # wait for the intro etc. to finish
                    await asyncio.sleep(0.1 * self.ts)
                    if turn != self._turn_seq or self._sent_this_turn:
                        return
                if self._fillers_this_turn >= MAX_FILLERS_PER_TURN:
                    return
                text = self._pick(bank, self._last_filler)
                self._last_filler = text
                self._fillers_this_turn += 1
                await self._speak(text, AUTO, "filler")
        except asyncio.CancelledError:
            pass

    @staticmethod
    def _pick(bank: list[str], avoid: str) -> str:
        choices = [b for b in bank if b != avoid] or bank
        return secrets.choice(choices)

    # ------------------------------------------------------------ end

    async def end(self, reason: str = "hangup") -> None:
        if self.state == ENDED:
            return
        self._cancel_fillers()
        if self._speak_task:
            self._speak_task.cancel()
        self._queue.clear()
        self.ended_reason = reason
        await self._set_state(ENDED)
        transcript = [{"who": l.who, "name": self.contact.name if l.who == "caller" else "You", "text": l.text}
                      for l in self.lines if l.kind not in ("filler",)]
        try:
            self.recap = await self.brain.recap(transcript) if transcript else []
        except Exception:
            self.recap = []
        await self.emit({"type": "ended", "reason": reason, "recap": self.recap,
                         "lines": [asdict(l) for l in self.lines if l.kind != "filler"]})


