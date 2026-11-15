# What I need from you to get Fingertip running

Everything that can be built and tested without accounts is done (`docs/STATUS.md`). This is the
complete list of what only you can provide, in the order that unblocks the most.

**Never paste keys or passwords into the chat.** Put them in the `.env` file at the project root
(it's ignored by git), save it, and tell me "keys are in". I'll check them with `/api/health`
without printing them.

---

## Tonight: a real phone call (about 30 minutes of your time)

This laptop already has `cloudflared` installed, so we don't have to wait for a server or a domain
name: I can give the app a temporary public `https://` address straight from this laptop.

| # | What | Where | Then |
|---|---|---|---|
| 1 | **Twilio account, upgraded** (add a payment method; trial accounts only call verified numbers and play a trial notice) | [console.twilio.com](https://console.twilio.com) → Account → Upgrade | Put **Account SID** and **Auth Token** in `.env` as `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` |
| 2 | **A Twilio phone number** with Voice (any US number, about $1.15/month) | Console → Phone Numbers → Buy a number | Put it in `.env` as `TWILIO_NUMBER=+1...` |
| 3 | **Accept the AI/ML addendum** (needed for the voice features we use) | Console → Voice → Settings → "Predictive and Generative AI/ML Features Addendum" | One click |
| 4 | **Gemini API key** (smart replies, recaps, calls in other languages, meeting voice) | [aistudio.google.com](https://aistudio.google.com) → Get API key | Put it in `.env` as `GEMINI_API_KEY` |
| 5 | **One teammate's phone number** who agreed to be called, and is next to you | Them | Tell me in chat, or type it in the app |
| 6 | **Your OK for me to start the tunnel** on this laptop | Chat | I run it, set the Twilio webhook URLs and make the first call |

Then I'll run the real call test (`scripts/live_check.py`): their phone rings, they hear a typed
sentence, they reply, the captions appear, then 5+ turns, an interruption and a hang-up. The
results go in `eval/live_calls.md`.

The tunnel address changes every time it restarts, and the call only works while this laptop is on.
That's fine for testing; for judging, use the server below.

---

## For the demo: the real server (Vultr is a sponsor)

| # | What | Where | Then |
|---|---|---|---|
| 7 | **A Vultr server**: Cloud Compute, Ubuntu 24.04, 2 vCPU / 4 GB | [my.vultr.com](https://my.vultr.com) → Deploy | While creating it, add this laptop's SSH key (I'll print the public key for you). Send me the **IP address** |
| 8 | **A domain name**, or a subdomain of one you own, with an **A record** pointing at the server's IP | Your registrar (Namecheap, Cloudflare, ...) or the hackathon's domain sponsor | Tell me the name. Caddy gets the HTTPS certificate on its own |

With those two I'll deploy (`docker compose up -d --build`), copy the `.env` over, and point
Twilio at the server.

---

## To verify the rest (people and devices)

| # | What | Why | When |
|---|---|---|---|
| 9 | **A teammate who signs ASL, 15 minutes**, at the demo laptop with its camera | Measure real sign accuracy on someone the model has never seen (`/#signs-lab`). If possible, a fluent signer to check the sign forms | After the first call works |
| 10 | **A second person on a second device in Google Meet**, and Chrome on this laptop | Test the Meet extension for real: chat posting and the voice in the meeting | After 9 |
| 11 | **VB-CABLE installed on this laptop** (free, from vb-audio.com; a driver install, so please do it yourself) | Zoom and Teams voice through the desktop bridge | Only if we demo Zoom or Teams |
| 12 | **A Spanish (or French or Portuguese) speaker** for one short call | Verify calls in other languages | Optional |
| 12b | **Three or four real 15-second clips** of real problems (a blinking router, a dripping tap, a cracked screen, a parcel label) | Measure Show it's accuracy, box placement and wait time with real Gemini before we demo it | As soon as the Gemini key is in |
| 13 | **ElevenLabs API key** | Only to use ElevenLabs instead of Gemini speech for the *meeting* voice. Phone calls don't need it | Optional |
| 14 | **Someone Deaf, hard of hearing or nonspeaking** willing to try it for 10 minutes | The spec asks us to validate with real users and use their words | Before the pitch, if at all possible |

---

## One decision only you can make

| # | What |
|---|---|
| 15 | **HackUMass rules on pre-existing work.** Most of this code was written outside the hacking window or by an AI agent. Ask the organizers whether it can be used, and disclose it as the rules require. Don't rewrite git history. |

---

## What I'll do the moment each item arrives

- **1–4 in `.env`:** restart the server, confirm `/api/health` shows `twilio: true` and `gemini.model_ok: true`, run `python eval/bench.py --live` (safety bench against real Gemini).
- **5 + 6:** start the tunnel, point Twilio at it, make the first real call, fix whatever breaks, and log it.
- **7 + 8:** deploy to Vultr, move Twilio to the permanent address, and re-run the call test there.
- **9:** run the signing session, tune the "unsure" threshold, and write the measured accuracy into `docs/STATUS.md`.
- **10–12:** test Meet, Zoom/Teams and another language, then update the status table with what actually worked.
- Finally: rehearse the demo script, record the backup video of the real system, and fill in the blanks in `docs/SUBMISSION.md`.


