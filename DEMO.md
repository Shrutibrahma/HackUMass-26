# Sign2Speak / Fingertip — demo runbook (rescue branch)

## Run it (Windows, from `C:\Users\shrut\dev\sign2speak`)

```bash
cd fingertip/app && npm ci && npm run build            # builds the phone UI into app/dist
cd ../server && python -m uvicorn app.main:app --port 8000
cloudflared tunnel --url http://127.0.0.1:8000        # copy the https://....trycloudflare.com URL
```
Put the tunnel URL in `PUBLIC_URL` in `fingertip/.env` (gitignored; copied from tokens.env), restart uvicorn, then:
```bash
python fingertip/scripts/point_twilio.py --apply      # points the Twilio number's webhooks at PUBLIC_URL
```
Optional `fingertip/.env` lines: `KNOWN_CALLERS=+1YOURCELL=Mom` (shows "Mom" when you call in),
`VOICE_ENGINE=grok` + `XAI_API_KEY=...` (Grok realtime voice; untested live).

## Why incoming calls showed "busy"
Twilio's debugger (error 11200) shows the number's webhook got **HTTP 404 on /twilio/voice**: the tunnel was
serving the old root `server/main.py`, which has no incoming route. The Fingertip server (`fingertip/server`) has it.
A quick tunnel gets a new URL each restart, so re-run `point_twilio.py --apply` every time.

## Demo script
1. Open the tunnel URL on a laptop (Chrome). Pick a voice.
2. **Incoming:** call the Twilio number from your phone. The app rings with "Mom"; swipe or tap Accept.
3. **AI Assist:** Mom asks "When will you be home?" Type `yes home 6`, then approve the preview ("Yes, Mom, I'll be home around six.").
4. **Exact Words:** switch the mode, type a sentence, and it is spoken word for word.
5. **Sign Language:** switch the mode, allow the camera, and sign supported words (59-sign vocabulary, SignBart + MediaPipe, on-device). Recognized words become a draft.
6. **Captions Only:** text appears in the transcript and nothing is spoken.
7. **Business:** call a teammate set up as a business contact, then `order damaged refund`.
8. **Video:** Home → "Video call with captions" opens the host page. Copy the invite link to a phone browser, then type captions; they overlay your video on their screen.
9. **Extension:** chrome://extensions → Load unpacked → `fingertip/extension`, then open a Google Meet. Captions are local; chat posting is best effort.

`python fingertip/scripts/simulate_incoming.py` rings the UI **(SIMULATED: no audio, can't be answered)**.

## Honest limits
- Not FaceTime, not a native iOS app, not full ASL translation (limited sign vocabulary).
- Extension captions are only visible to you; remote attendees don't see them unless they're posted to Meet chat.
- The Grok voice bridge is written against xAI docs and tested against a fake server only.
