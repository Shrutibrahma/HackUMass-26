"""SIMULATED incoming call: posts a correctly signed Twilio-style webhook to the local server.

This only rings the app UI (no phone audio). Answering a simulated call fails at Twilio,
because there is no real call behind it. Use a real phone call to the Twilio number for the demo.

    python scripts/simulate_incoming.py [+1FROMNUMBER]
"""
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from app.config import settings  # noqa: E402
from twilio.request_validator import RequestValidator  # noqa: E402

frm = sys.argv[1] if len(sys.argv) > 1 else "+14135550123"
form = {"CallSid": "CAsimulated" + str(abs(hash(frm)))[:8], "From": frm, "To": settings.twilio_number,
        "CallStatus": "ringing"}
sig = RequestValidator(settings.twilio_auth_token).compute_signature(settings.public_url + "/twilio/voice", form)
req = urllib.request.Request("http://127.0.0.1:8000/twilio/voice", data=urllib.parse.urlencode(form).encode(),
                             headers={"X-Twilio-Signature": sig})
print(urllib.request.urlopen(req).read().decode())
