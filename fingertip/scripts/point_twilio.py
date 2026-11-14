"""Point the Twilio number's incoming-call webhooks at PUBLIC_URL (run after every new tunnel URL).

    python scripts/point_twilio.py          # show current config, change nothing
    python scripts/point_twilio.py --apply  # set Voice URL + status callback to PUBLIC_URL
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from app.config import settings  # noqa: E402
from twilio.rest import Client  # noqa: E402

client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
nums = client.incoming_phone_numbers.list(phone_number=settings.twilio_number)
if not nums:
    sys.exit(f"{settings.twilio_number} is not on this Twilio account")
n = nums[0]
want = {"voice_url": f"{settings.public_url}/twilio/voice", "status_callback": f"{settings.public_url}/twilio/status"}
print("now:   ", n.voice_url, n.voice_method, "| status:", n.status_callback)
print("wanted:", want["voice_url"], "POST | status:", want["status_callback"])
if "--apply" in sys.argv:
    n.update(voice_url=want["voice_url"], voice_method="POST",
             status_callback=want["status_callback"], status_callback_method="POST")
    print("updated.")
