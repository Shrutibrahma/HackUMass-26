"""Held-out signer evaluation from the team's own recordings (Signs lab: /#signs-lab).

Single-sign top-1 accuracy per sign, and complete-phrase success (every sign right).
Report only the held-out signer's numbers.

    python eval/sign_eval.py --signer "<held-out teammate>" [--hand right|left|auto]
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "server"))
from app.signs.service import DATA_DIR, SignService  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--signer", required=True)
    ap.add_argument("--hand", default="right")
    ap.add_argument("--out", default=os.path.join(ROOT, "eval", "sign_results.md"))
    a = ap.parse_args()
    path = os.path.join(DATA_DIR, "recordings.jsonl")
    if not os.path.exists(path):
        print("No recordings yet. Record in the app at /#signs-lab first.")
        return 1
    recs = [json.loads(l) for l in open(path)]
    recs = [r for r in recs if r["signer"].lower() == a.signer.lower()]
    svc = SignService()
    per = collections.defaultdict(lambda: [0, 0])
    phrases = collections.defaultdict(lambda: [0, 0])
    unsure_ok = 0
    for r in recs:
        if r["kind"] == "sign":
            res = svc.classify(r["segments"][0], a.hand)
            per[r["label"]][1] += 1
            per[r["label"]][0] += res.get("sign") == r["label"]
        else:
            want = r["label"].split()
            got = [svc.classify(s, a.hand) for s in r["segments"]]
            signs = [g.get("sign") for g in got]
            ok = signs == want
            # A phrase also counts if exactly one sign was unsure and the right one was among the two offered.
            if not ok and len(got) == len(want):
                wrong = [i for i, (g, w) in enumerate(zip(got, want)) if g.get("sign") != w]
                if len(wrong) == 1 and got[wrong[0]].get("unsure") and want[wrong[0]] in got[wrong[0]].get("options", []):
                    ok, unsure_ok = True, unsure_ok + 1
            phrases[r["label"]][1] += 1
            phrases[r["label"]][0] += ok
    n1 = sum(v[1] for v in per.values())
    k1 = sum(v[0] for v in per.values())
    n2 = sum(v[1] for v in phrases.values())
    k2 = sum(v[0] for v in phrases.values())
    lines = [f"# Held-out signer results: {a.signer}", "",
             f"Model: {svc.config()['model']} · hand setting: {a.hand} · active vocabulary: {len(svc.active)} signs", "",
             f"- Single signs: **{k1}/{n1}** top-1" + (f" ({100 * k1 / n1:.0f}%)" if n1 else ""),
             f"- Complete phrases: **{k2}/{n2}**" + (f" ({100 * k2 / n2:.0f}%)" if n2 else "")
             + (f", {unsure_ok} of them after one tap on an unsure sign" if unsure_ok else ""), "",
             "| Sign | Right | Tries |", "|---|---|---|"]
    lines += [f"| {s} | {v[0]} | {v[1]} |" for s, v in sorted(per.items())]
    lines += ["", "| Phrase | Right | Tries |", "|---|---|---|"]
    lines += [f"| {s} | {v[0]} | {v[1]} |" for s, v in sorted(phrases.items())]
    open(a.out, "w").write("\n".join(lines) + "\n")
    print("\n".join(lines[:7]))
    return 0


if __name__ == "__main__":
    sys.exit(main())


