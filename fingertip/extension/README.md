# Fingertip Meeting Captions extension

This unpacked Manifest V3 extension adds an accessible, movable **local** caption overlay to Google Meet and
Zoom Web. It offers AI Assist, Exact Words, and Captions Only preparation modes. The existing Fingertip camera
pipeline opens in a separate panel so recognized text can be reviewed before it is shown or delivered.

## Load locally

1. Start the Fingertip server and app (the default origin is `http://localhost:8000`).
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select this `extension` folder.
4. Open the extension's **Options**, save the app's server origin, then reload the meeting tab.

Run `node validate.mjs` to validate the manifest and every file it declares. Run `node --check content.js`,
`node --check inject.js`, and `node --check options.js` for syntax checks.

## Behavior and limits

- Local captions are reliable and remain visible only in the current browser tab.
- Google Meet chat posting is opt-in and best-effort because Meet exposes no stable public DOM API for it.
- Meeting voice is opt-in and experimental. It requires the configured server's `/api/tts` endpoint and a tab
  reload before the meeting requests microphone access.
- Zoom Web gets the local overlay; automated Zoom chat delivery is disabled.
- The extension does not integrate with Zoom Desktop or native FaceTime and never claims that remote attendees
  received a caption unless a delivery attempt reports success.
