"""Real-Chromium test of Show & explain: the fake camera shows a router scene (test-artifacts/scene.y4m),
the user asks "which light is the problem", and the extension must draw labelled boxes into the camera video
the meeting sends (live Gemini call through the local server).

    python extension/test_explain.py [http://127.0.0.1:8000]
"""
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

EXT = Path(__file__).resolve().parent
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
OUT = EXT / "test-artifacts"
SCENE = OUT / "scene.y4m"

COUNT = """() => { const v = document.getElementById('sent'); const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight; const x = c.getContext('2d'); x.drawImage(v, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0;
  const pal = [[255,216,77],[94,224,255],[255,138,216],[141,255,158],[255,179,92],[185,166,255]];
  for (let i = 0; i < d.length; i += 4) for (const [r,g,b] of pal)
    if (Math.abs(d[i]-r) < 28 && Math.abs(d[i+1]-g) < 28 && Math.abs(d[i+2]-b) < 28) { n++; break }
  return n }"""   # outline / badge / bubble-stripe colours of the labels

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        tempfile.mkdtemp(prefix="ft-exp-"), channel="chromium", headless=True,
        args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}", "--use-fake-device-for-media-stream",
              "--use-fake-ui-for-media-stream", f"--use-file-for-fake-video-capture={SCENE}"],
        viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    page.goto(f"{BASE}/ext-test")
    page.wait_for_function("document.getElementById('sent').videoWidth > 0", timeout=20000)
    time.sleep(1)
    before = page.evaluate(COUNT)
    host = page.locator("#fingertip-meeting-assistant")
    host.locator("#ft-more").click()
    host.locator("#ft-ask").fill("which light is the problem")
    host.locator("#ft-more").click()
    t0 = time.time()
    page.keyboard.press("Alt+e")
    page.wait_for_function("""() => /^Labelled|^Nothing clear|^Explain/.test(document.getElementById('fingertip-meeting-assistant')
        .shadowRoot.getElementById('ft-toast').textContent)""", timeout=30000)
    took = (time.time() - t0) * 1000
    status = host.locator("#ft-toast").inner_text()
    time.sleep(0.8)
    after = page.evaluate(COUNT)
    page.screenshot(path=str(OUT / "meeting-explain.png"))
    print(f"status: {status}  ({took:.0f} ms from Alt+E)")
    print(f"label-colour pixels in sent video: before={before} after={after}")
    ok = status.startswith("Labelled") and after > before + 300
    print("RESULT:", "PASS - labelled tooltips are inside the outgoing video" if ok else "FAIL")
    ctx.close()
    sys.exit(0 if ok else 1)
