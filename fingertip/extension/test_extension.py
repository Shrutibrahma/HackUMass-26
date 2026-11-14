"""Real-Chromium test of the extension: loads it unpacked, uses Chrome's fake camera, opens the stand-in
meeting page (/ext-test on the local server), sends a caption, and checks the caption pixels are in the video
the page would send AND in the video a second WebRTC peer receives.

    python extension/test_extension.py [http://127.0.0.1:8000]
"""
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

EXT = str(Path(__file__).resolve().parent)
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
OUT = Path(__file__).resolve().parent / "test-artifacts"
OUT.mkdir(exist_ok=True)

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        tempfile.mkdtemp(prefix="ft-ext-"),
        channel="chromium",
        headless=True,
        args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}",
              "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
        viewport={"width": 1280, "height": 800},
    )
    page = ctx.new_page()
    page.goto(f"{BASE}/ext-test")
    page.wait_for_function("document.getElementById('remote').videoWidth > 0", timeout=20000)
    time.sleep(1.0)
    status = page.inner_text("#log")
    print("page:", status)
    panel = page.evaluate("!!document.getElementById('fingertip-meeting-assistant')")
    print("extension panel injected:", panel)
    before = {k: page.evaluate(f"band('{k}')") for k in ("sent", "remote")}
    print("before caption:", before)

    # Use the extension's own UI like a user: open panel, Exact Words, type, show caption.
    host = page.locator("#fingertip-meeting-assistant")
    host.locator("#ft-launcher").click()
    host.locator("#ft-mode").select_option("exact")
    host.locator("#ft-input").fill("Yes, Friday works for me.")
    host.locator("#ft-prepare").click()
    host.locator("#ft-share").click()
    time.sleep(1.5)
    after = {k: page.evaluate(f"band('{k}')") for k in ("sent", "remote")}
    print("after caption: ", after)
    print("panel status:", host.locator("#ft-status").inner_text())
    page.screenshot(path=str(OUT / "meeting-with-caption.png"))

    # AI Assist through the extension: shorthand -> natural sentence (server /api/expand, live model if configured).
    host.locator("#ft-mode").select_option("ai")
    host.locator("#ft-input").fill("yes friday 3")
    t0 = time.time()
    host.locator("#ft-prepare").click()
    page.wait_for_function("""() => { const h = document.getElementById('fingertip-meeting-assistant').shadowRoot;
        return h.getElementById('ft-draft').value.length > 0 }""", timeout=15000)
    ai = host.locator("#ft-draft").input_value()
    print(f"AI Assist draft: {ai!r} ({(time.time() - t0) * 1000:.0f} ms incl. UI)")
    # Must be a real rewrite, not the offline tidy-up ("Yes friday 3.").
    ai_ok = ai.strip(" .").lower() != "yes friday 3" and "friday" in ai.lower()

    # Signing window -> meeting: the extension's "Open signing camera" window posts recognized signs back.
    # (Real sign recognition needs a real signer; here the window posts what recognition would.)
    with ctx.expect_page() as pop_info:
        host.locator("#ft-sign").click()
    pop = pop_info.value
    pop.wait_for_load_state()
    print("signing window:", pop.url)
    pop.evaluate("""() => window.opener.postMessage({ source: 'sign2speak', type: 'partial', text: 'Hello Friday' }, '*')""")
    time.sleep(1.0)
    partial = page.evaluate("band('sent')")
    pop.evaluate("""() => window.opener.postMessage({ source: 'sign2speak', type: 'send', text: 'Hi everyone, Friday works.' }, '*')""")
    time.sleep(0.5)
    got = host.locator("#ft-draft").input_value()
    print("partial signs in camera:", partial, "| final text received for review:", repr(got))
    sign_ok = partial["dark"] > 0.15 and got == "Hi everyone, Friday works."
    page.screenshot(path=str(OUT / "meeting-signing.png"))

    ok = sign_ok and ai_ok and all(after[k]["dark"] > before[k]["dark"] + 0.15 and after[k]["white"] > 0.01 for k in after)
    print("RESULT:", "PASS - caption is inside the outgoing and received video" if ok else "FAIL")
    ctx.close()
    sys.exit(0 if ok else 1)
