"""Check the sign pipeline on real signers: ASL Citizen poses (HF SorensenAI/asl-citizen-poses).

Converts each .pose file (MediaPipe Holistic, pixel coordinates) into the same per-frame dicts
the browser sends, runs both models, and reports top-1 / top-5 per sign.

Caveat: these clips may overlap SignBart's training data (it was trained on ASL Citizen), so
this checks the preprocessing and the model port end to end. It is NOT held-out accuracy.
Held-out numbers come from our own signer (eval/sign_eval.py).

    pip install pose-format
    python model/validate_aslcitizen.py /path/to/pose/files [--out eval/model_check.md]
"""
from __future__ import annotations

import argparse
import collections
import glob
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
from app.signs.models import IslrModel, SignBartModel, gloss_of, timed  # noqa: E402


def frames_from_pose(path: str) -> list[dict]:
    from pose_format import Pose

    p = Pose.read(open(path, "rb").read())
    w, h = p.header.dimensions.width, p.header.dimensions.height
    data = p.body.data[:, 0]                       # [T, 576, 3], masked where missing
    mask = np.ma.getmaskarray(data)[..., 0]
    arr = np.asarray(data.filled(np.nan), dtype=np.float32)
    arr[..., 0] /= w
    arr[..., 1] /= h
    arr[..., 2] /= w
    spans = {"pose": (0, 33), "face": (33, 501), "lh": (501, 522), "rh": (522, 543)}
    out = []
    for t in range(arr.shape[0]):
        f = {}
        for k, (a, b) in spans.items():
            f[k] = None if mask[t, a:b].all() else arr[t, a:b].tolist()
        out.append(f)
    return out


def swap(frames: list[dict]) -> list[dict]:
    return [{**f, "lh": f["rh"], "rh": f["lh"]} for f in frames]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "eval", "model_check.md"))
    ap.add_argument("--vocab", default=os.path.join(os.path.dirname(__file__), "vocab.json"))
    args = ap.parse_args()
    files = sorted(glob.glob(os.path.join(args.dir, "*.pose")))
    sb, islr = SignBartModel(), IslrModel()
    islr_vocab = {gloss_of(l) for l in islr.labels}
    want_of = lambda f: gloss_of(os.path.basename(f).rsplit("-", 1)[-1][:-5].replace("_", " "))  # noqa: E731
    ours = {want_of(f) for f in files}
    keys = ["n", "r1", "r5", "rv", "l1", "best1", "bestv", "auto1", "autov", "is_n", "is1"]
    rows = collections.defaultdict(lambda: dict.fromkeys(keys, 0))
    ms_sb, ms_is = [], []
    for f in files:
        want, frames = want_of(f), frames_from_pose(f)
        right, ms = timed(sb, frames)
        left = sb.predict(swap(frames), k=5)
        rv = sb.predict(frames, k=1, allowed=ours)[0]
        lv = sb.predict(swap(frames), k=1, allowed=ours)[0]
        ms_sb.append(ms)
        r = rows[want]
        r["n"] += 1
        r["r1"] += right[0].sign == want
        r["r5"] += want in [x.sign for x in right]
        r["rv"] += rv.sign == want
        r["l1"] += left[0].sign == want
        r["best1"] += right[0].sign == want or left[0].sign == want      # hand setting matches the signer
        r["bestv"] += rv.sign == want or lv.sign == want
        r["auto1"] += (right if right[0].p >= left[0].p else left)[0].sign == want
        r["autov"] += (rv if rv.p >= lv.p else lv).sign == want
        if want in islr_vocab:
            g2, ms2 = timed(islr, frames)
            ms_is.append(ms2)
            r["is_n"] += 1
            r["is1"] += g2[0].sign == want
    tot = {k: sum(r[k] for r in rows.values()) for k in keys}
    n = tot["n"]
    pct = lambda a, b: f"{a}/{b} ({100 * a / max(b, 1):.0f}%)"  # noqa: E731
    active = sorted(s for s, r in rows.items() if r["n"] >= 2 and r["bestv"] / r["n"] >= 0.8)
    lines = [
        "# Sign model check on real signers (ASL Citizen poses)", "",
        f"{n} clips of {len(rows)} of our signs, from HF `SorensenAI/asl-citizen-poses` (MediaPipe Holistic landmarks).",
        "", "**Not held-out accuracy.** SignBart was trained on ASL Citizen and these clips may be in its training set.",
        "This checks the landmark format, preprocessing and model port end to end on real signers.",
        "Held-out numbers come from our own signer (`eval/sign_eval.py`).", "",
        "## SignBart ASL-Citizen-2730 (primary)", "",
        "| Setting | Top-1 of all 2,730 signs | Top-1 within our signs |", "|---|---|---|",
        f"| Right-handed order only | {pct(tot['r1'], n)} | {pct(tot['rv'], n)} |",
        f"| **Hand setting matches the signer** (app setting) | **{pct(tot['best1'], n)}** | **{pct(tot['bestv'], n)}** |",
        f"| Automatic (more confident of both orders) | {pct(tot['auto1'], n)} | {pct(tot['autov'], n)} |",
        "", f"Top-5 (right-handed order): {pct(tot['r5'], n)}. Median CPU time per sign: {np.median(ms_sb):.0f} ms.",
        "", "## ISLR 1st place (250 signs, second opinion)", "",
        f"Top-1 on the {tot['is_n']} clips of signs it knows: {pct(tot['is1'], tot['is_n'])}. "
        f"Median CPU time: {np.median(ms_is) if ms_is else 0:.0f} ms. It needs 468 face points per frame, so it isn't in the live path.",
        "", "## Per sign", "",
        "| Sign | Clips | Right-hand top-1 | Hand-matched top-1 | Hand-matched, within ours | ISLR top-1 | Active |",
        "|---|---|---|---|---|---|---|"]
    for s in sorted(rows):
        r = rows[s]
        isl = f"{r['is1']}/{r['is_n']}" if r["is_n"] else "-"
        lines.append(f"| {s} | {r['n']} | {r['r1']} | {r['best1']} | {r['bestv']} | {isl} | {'yes' if s in active else ''} |")
    lines += ["", f"**Active vocabulary ({len(active)} signs, hand-matched within-ours top-1 >= 80% on 2+ clips):** "
              + ", ".join(active)]
    open(args.out, "w").write("\n".join(lines) + "\n")
    import json
    json.dump({"active": active, "source": "model/validate_aslcitizen.py on ASL Citizen poses",
               "measured": {s: {k: rows[s][k] for k in ("n", "r1", "best1", "bestv")} for s in sorted(rows)}},
              open(args.vocab, "w"), indent=1)
    print("\n".join(lines[8:17]))
    print(f"active vocabulary: {len(active)} signs; wrote", args.out, "and", args.vocab)


if __name__ == "__main__":
    main()


