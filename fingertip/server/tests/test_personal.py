"""Personal signs: teach a sign with a few examples, it is recognised; forget it, it is gone."""
import math

import numpy as np
import pytest

from app.signs.personal import PersonalSigns, shape_descriptor
from app.signs.service import SignService


def _pose():
    p = [[0.5, 0.5]] * 33
    p[0] = [0.5, 0.25]; p[11] = [0.62, 0.5]; p[12] = [0.38, 0.5]
    return p


def _hand(cx, cy, spread, angle=0.0):
    pts = [[cx, cy]]
    for f in range(5):
        a = angle + (f - 2) * 0.3
        for j in range(1, 5):
            r = 0.02 * j * spread
            pts.append([cx + r * math.sin(a), cy - r * math.cos(a)])
    return pts


def wave(n=24, jitter=0.0, seed=0):          # open hand moving side to side, high up
    rng = np.random.default_rng(seed)
    return [{"pose": _pose(), "rh": (np.array(_hand(0.4 + 0.1 * math.sin(i / 3), 0.3, 1.0)) + rng.normal(0, jitter, (21, 2))).tolist(), "lh": None}
            for i in range(n)]


def fist_drop(n=24, jitter=0.0, seed=0):     # closed hand moving down, low
    rng = np.random.default_rng(seed)
    return [{"pose": _pose(), "rh": (np.array(_hand(0.5, 0.45 + i * 0.008, 0.3, 1.2)) + rng.normal(0, jitter, (21, 2))).tolist(), "lh": None}
            for i in range(n)]


def test_shape_descriptor_mirrors_left_hand():
    fr = wave()
    left = [{**f, "lh": [[1 - x, y] for x, y in f["rh"]], "rh": None,
             "pose": [[1 - x, y] for x, y in f["pose"]]} for f in fr]
    assert float(shape_descriptor(fr, "right") @ shape_descriptor(left, "left")) > 0.99


def test_teach_recognise_forget(tmp_path):
    svc = SignService()
    if not svc.ready:
        pytest.skip("sign model not available")
    svc.personal = PersonalSigns(str(tmp_path / "personal.json"))
    for s in range(3):
        assert svc.teach("Grandma", wave(jitter=0.004, seed=s))["ok"]
        assert svc.teach("my dog", fist_drop(jitter=0.004, seed=s))["ok"]
    r = svc.classify(wave(jitter=0.004, seed=9))
    assert r["sign"] == "GRANDMA" and r["source"] == "personal" and not r["unsure"]
    r = svc.classify(fist_drop(jitter=0.004, seed=9))
    assert r["sign"] == "MY DOG" and r["source"] == "personal"
    assert svc.config()["personal"] == {"GRANDMA": 3, "MY DOG": 3}
    # persisted
    assert PersonalSigns(str(tmp_path / "personal.json")).labels() == {"GRANDMA": 3, "MY DOG": 3}
    svc.personal.remove("grandma")
    assert svc.classify(wave(jitter=0.004, seed=9)).get("sign") != "GRANDMA"


def test_conversation_vocab_is_active():
    svc = SignService()
    if not svc.ready:
        pytest.skip("sign model not available")
    assert len(svc.conversation) == 25
    assert set(svc.conversation) <= set(svc.active)
    for s in ("HELLO", "THANK-YOU", "YES", "NO", "WHERE", "MOM"):
        assert s in svc.conversation
