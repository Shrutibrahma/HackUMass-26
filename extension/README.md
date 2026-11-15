# Fingertip Meeting Captions (Chrome extension)

An AI accessibility layer over the meeting tools people already use. A Deaf or nonspeaking person signs or types
in **Google Meet** or **Zoom Web** in Chrome, and everyone else sees the result **inside their camera video**.
Nobody else installs anything.

## What it does
- **Captions in your camera.** Approved text (Exact Words, AI Assist, or recognized signs) is drawn into your
  outgoing camera frames, so every participant can read it.
- **AI Assist.** "yes friday 3" becomes "Yeah, Friday at 3.". You review and edit before anything is shown.
- **Signing.** "Open signing camera" opens the Fingertip signing window (on-device sign recognition, limited
  vocabulary). Live partial signs show in your camera as you sign; the final sentence comes back for review.
- **Show & explain (Alt+E).** Hold something up to the camera. The AI outlines the important parts and pins a
  tooltip label to each, drawn into your video for everyone. Add a question ("which light is the problem?") to
  focus it, or turn on **live** to keep labelling as you move it. Only that one still frame is sent to the server.
- **Optional:** post to Meet chat (best effort), or voice the line into your mic (experimental).

## Install
1. Run the Fingertip server and have its HTTPS URL ready (the cloudflared tunnel URL; see ../../DEMO.md).
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick this `extension` folder.
3. Open the extension's **Options**, paste the server URL, and save (allow the permission prompt).
4. Install **before** joining the meeting, or turn your camera off and on once, so the extension can add captions.

## How it works
`inject.js` runs in the page's main world at `document_start` and wraps `getUserMedia`. Each camera frame passes
through a Chrome insertable-streams transform (with a canvas fallback) that draws the caption and the labels.
The meeting sends that processed track.

## Tests
- `node validate.mjs`: manifest and files.
- `python test_extension.py`: real Chromium with a fake camera. Checks that the caption is in the sent and
  received video, AI Assist, and the signing-window hand-off.
- `python test_explain.py`: the fake camera shows a router scene. Checks that Alt+E draws labels into the sent
  video (makes a live Gemini call).

## Limits (honest)
- Chrome only, and only Meet and Zoom **web**. Not Zoom Desktop, Teams desktop, or FaceTime.
- Meet shows your own self-view mirrored, so your captions look mirrored **to you only**. Everyone else sees
  them the right way round.
- Sign recognition covers a limited vocabulary, not full ASL translation.
- Not yet run on a real Meet or Zoom call: tested on a stand-in meeting page in real Chromium.
