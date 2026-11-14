"""Twilio REST calls. A fake is used by tests and when Twilio isn't configured."""
from __future__ import annotations

import asyncio
import logging
from typing import Protocol

from .config import settings

log = logging.getLogger("telephony")


class Telephony(Protocol):
    async def dial(self, to: str, twiml: str, status_callback: str) -> str: ...
    async def update_twiml(self, call_sid: str, twiml: str) -> None: ...
    async def hangup(self, call_sid: str) -> None: ...


class TwilioTelephony:
    def __init__(self) -> None:
        from twilio.rest import Client

        self.client = Client(settings.twilio_account_sid, settings.twilio_auth_token)

    async def dial(self, to: str, twiml: str, status_callback: str) -> str:
        def _go() -> str:
            call = self.client.calls.create(
                to=to,
                from_=settings.twilio_number,
                twiml=twiml,
                status_callback=status_callback,
                status_callback_event=["initiated", "ringing", "answered", "completed"],
                timeout=30,
            )
            return call.sid

        return await asyncio.to_thread(_go)

    async def update_twiml(self, call_sid: str, twiml: str) -> None:
        await asyncio.to_thread(lambda: self.client.calls(call_sid).update(twiml=twiml))

    async def hangup(self, call_sid: str) -> None:
        def _go() -> None:
            try:
                self.client.calls(call_sid).update(status="completed")
            except Exception as e:  # already ended is fine
                log.info("hangup %s: %s", call_sid, e)

        await asyncio.to_thread(_go)


class FakeTelephony:
    """Records what would have been sent to Twilio."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []
        self._n = 0

    async def dial(self, to: str, twiml: str, status_callback: str) -> str:
        self._n += 1
        sid = f"CAFAKE{self._n:032d}"
        self.calls.append(("dial", to, twiml))
        return sid

    async def update_twiml(self, call_sid: str, twiml: str) -> None:
        self.calls.append(("update", call_sid, twiml))

    async def hangup(self, call_sid: str) -> None:
        self.calls.append(("hangup", call_sid))


def make_telephony() -> Telephony:
    if settings.twilio_ready:
        return TwilioTelephony()
    log.warning("Twilio not configured: using FakeTelephony (no real calls)")
    return FakeTelephony()


