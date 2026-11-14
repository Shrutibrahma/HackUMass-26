"""Sign recognition through the real HTTP endpoint.

The real-signer test needs ASL Citizen pose files (see model/validate_aslcitizen.py); point
ASLC_DIR at them. Everything else runs anywhere.
"""
import glob
import os
import sys

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.signs.service import option_glosses

ASLC = os.environ.get("ASLC_DIR", "/tmp/claude-0/aslc/files")


def test_option_glosses():
    assert option_glosses(["six", "twelve"]) == {"SIX", "TWELVE"}
    assert option_glosses(["6"]) == {"SIX"}
    assert "SUNDAY" in option_glosses(["Sunday"])


def test_config_and_short_segment():
    with TestClient(app) as c:
        cfg = c.get("/api/signs/config").json()
        assert cfg["ready"] and "YES" in cfg["vocab"] and "HELLO" in cfg["vocab"]
        r = c.post("/api/signs/classify", json={"frames": [{}, {}]}).json()
        assert r["ok"] is False
        r = c.post("/api/signs/classify", json={"frames": [{"pose": None, "lh": None, "rh": None}] * 10}).json()
        assert r["ok"] and "_p" not in r            # no confidence numbers leave the server


@pytest.mark.skipif(not glob.glob(os.path.join(ASLC, "*.pose")), reason="ASL Citizen pose files not present")
def test_demo_phrase_signs_from_real_signers():
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "model"))
    from validate_aslcitizen import frames_from_pose

    def x_y(frames):   # what the browser sends: x, y only
        return [{k: (None if v is None else [p[:2] for p in v]) for k, v in f.items() if k != "face"} for f in frames]

    with TestClient(app) as c:
        hits = 0
        tried = 0
        for gloss in ["YES", "SUNDAY", "COME", "THANKYOU", "WANT", "SEVEN"]:
            for f in sorted(glob.glob(os.path.join(ASLC, f"*-{gloss}.pose")))[:2]:
                r = c.post("/api/signs/classify", json={"frames": x_y(frames_from_pose(f)), "hand": "auto"}).json()
                tried += 1
                hits += r["sign"].replace("-", "") == gloss
        assert tried >= 8 and hits / tried >= 0.75, (hits, tried)


