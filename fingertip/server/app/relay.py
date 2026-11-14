"""Twilio ConversationRelay adapter: TwiML builders and WebSocket message shapes.

Everything protocol-specific lives here. Checked against Twilio's docs on 2026-11-14
(websocket-messages, twiml/connect/conversationrelay, voice-configuration, onboarding):
message shapes, attribute names, the v3/v4 voice format and audio tags all match. See D-028.

TwiML attribute names come from the official `twilio` Python SDK (9.13),
which generates them from Twilio's TwiML schema.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from twilio.twiml.voice_response import Connect, VoiceResponse

from .config import settings

# ---------------------------------------------------------------- TwiML


def relay_twiml(session_id: str, voice_id: str | None = None, language: str | None = None) -> str:
    """<Connect><ConversationRelay/></Connect> for a live call.

    `language` (BCP-47) sets both speech recognition and the voice for the whole call, for
    calls with someone who speaks another language (translate.py). ElevenLabs Flash v2.5 is
    multilingual, so the same voice ID speaks Spanish, French or Portuguese. Unverified live."""
    r = VoiceResponse()
    c = Connect(action=f"{settings.public_url}/twilio/relay-ended/{session_id}")
    c.conversation_relay(
        url=f"{settings.ws_base}/ws/relay/{session_id}",
        language=language or settings.language,
        tts_provider=settings.tts_provider,
        voice=settings.voice_string(voice_id),
        partial_prompts="true",          # defaults to false; we need live partial captions
        interruptible="any",             # caller can talk over our voice (Twilio default, set explicitly)
        echo_prompt_filtering="true",    # drop transcripts of our own TTS echo (best with ElevenLabs)
        ignoreBackchannel="true",        # "yeah" / "uh-huh" from the caller doesn't cut our sentence off
        dtmf_detection="true",
        application_reconnect="true",    # Twilio re-dials our socket if it drops
        elevenlabs_text_normalization="on",
    )
    r.append(c)
    return str(r)


def ringback_twiml(session_id: str) -> str:
    """What the caller hears while the signer's phone rings."""
    r = VoiceResponse()
    r.play(f"{settings.public_url}/static-audio/ringback.wav", loop=0)
    return str(r)


def goodbye_twiml(text: str) -> str:
    r = VoiceResponse()
    if text:
        r.say(text)
    r.hangup()
    return str(r)


# ---------------------------------------------------------------- WS messages


@dataclass
class RelayEvent:
    type: str
    raw: dict[str, Any]

    @property
    def text(self) -> str:
        return (self.raw.get("voicePrompt") or "").strip()

    @property
    def last(self) -> bool:
        return bool(self.raw.get("last", True))


def parse(message: str) -> RelayEvent:
    """Incoming types: setup, prompt, interrupt, dtmf, error (and others we ignore)."""
    data = json.loads(message)
    return RelayEvent(type=str(data.get("type", "")), raw=data)


TONE_TAGS = {"warm": "[warmly]", "concerned": "[gently]"}


def spoken_token(text: str, tone: str = "neutral") -> str:
    """With expressive ElevenLabs models, prefix a natural-language audio tag. Otherwise plain text."""
    tag = TONE_TAGS.get(tone, "") if settings.expressive_tts else ""
    return f"{tag} {text}" if tag else text


def text_message(text: str, *, interruptible: bool = True, preemptible: bool = True) -> str:
    """Send one complete line to be spoken. The controller only ever has one line playing,
    so preemptible lets a Stop (or the next line) cut it off."""
    return json.dumps({
        "type": "text",
        "token": text,
        "last": True,
        "interruptible": interruptible,
        "preemptible": preemptible,
    })


def end_message(reason: str = "hangup") -> str:
    return json.dumps({"type": "end", "handoffData": json.dumps({"reason": reason})})


