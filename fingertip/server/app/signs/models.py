"""Pretrained isolated-sign models and their exact input preprocessing.

Both models read MediaPipe Holistic landmarks, which the browser produces. Frames come in as
{"pose": [[x,y,z]*33] | None, "lh": [[x,y,z]*21] | None, "rh": [[x,y,z]*21] | None,
 "face": [[x,y,z]*468] | None}, with x, y normalized to the video frame (0..1).

SignBart-ASL-2730 (primary): HF tinh2312/SignBart-ASL-2730, 2,730 ASL Citizen signs.
  Preprocessing copied from the authors' dataset.py: [T, 75, 2] = pose 33 + hand 21 + hand 21
  (in SignBart's order, which is MediaPipe's right hand first; see signbart_input), x/y only, missing = 0, clipped to [0, 1], T > 64 -> 64 frames by uniform
  linspace, then each part (body 11-16, left hand 33-53, right hand 54-74) rescaled to its own
  padded square bounding box.

ISLR 1st place (second opinion): HF sign/kaggle-asl-signs-1st-place, 250 signs (Kaggle
  "Google - Isolated Sign Language Recognition"). Input [T, 543, 3] = face 468, left hand 21,
  pose 33, right hand 21 (the competition's order), missing = NaN. The model does its own
  normalization inside the TFLite graph.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Optional

import numpy as np

log = logging.getLogger("signs")

MODEL_DIR = os.environ.get("SIGN_MODEL_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "..", "model"))

BODY = list(range(11, 17))
LEFT = list(range(33, 54))
RIGHT = list(range(54, 75))


def _arr(frames: list[dict], key: str, n: int, dims: int, fill: float) -> np.ndarray:
    out = np.full((len(frames), n, dims), fill, dtype=np.float32)
    for i, f in enumerate(frames):
        pts = f.get(key)
        if pts:
            a = np.asarray(pts, dtype=np.float32)[:n, :dims]
            out[i, : a.shape[0], : a.shape[1]] = a
    return out


# ------------------------------------------------------------------ SignBart preprocessing

def _normalize_part(kp: np.ndarray) -> np.ndarray:
    """Exactly SignBart's Datasets._normalize_part, for one frame's part [K, 2]."""
    xs, ys = kp[:, 0], kp[:, 1]
    min_x, min_y, max_x, max_y = xs.min(), ys.min(), xs.max(), ys.max()
    w, h = max_x - min_x, max_y - min_y
    if w > h:
        dx = 0.05 * w
        dy = dx + (w - h) / 2
    else:
        dy = 0.05 * h
        dx = dy + (h - w) / 2
    sx, sy = max(0.0, min(min_x - dx, 1.0)), max(0.0, min(min_y - dy, 1.0))
    ex, ey = max(0.0, min(max_x + dx, 1.0)), max(0.0, min(max_y + dy, 1.0))
    kp = kp.copy()
    if ex - sx != 0.0:
        kp[:, 0] = (kp[:, 0] - sx) / (ex - sx)
    if ey - sy:
        kp[:, 1] = (kp[:, 1] - sy) / (ey - sy)
    return kp


def signbart_input(frames: list[dict]) -> np.ndarray:
    # SignBart's training data labels the hands the other way round from MediaPipe Holistic:
    # its "left hand" slot holds what MediaPipe calls the right hand. Measured on 120 real ASL
    # Citizen clips: top-1 29% as-is vs 64% swapped (mirroring x instead: 19%). See eval/model_check.md.
    kp = np.concatenate([_arr(frames, "pose", 33, 2, 0.0), _arr(frames, "rh", 21, 2, 0.0),
                         _arr(frames, "lh", 21, 2, 0.0)], axis=1)
    kp = np.nan_to_num(kp, nan=0.0)
    kp = np.clip(kp, 0, 1)
    if kp.shape[0] > 64:
        idx = np.clip(np.linspace(0, kp.shape[0] - 1, 64).astype(int), 0, kp.shape[0] - 1)
        kp = kp[idx]
    for t in range(kp.shape[0]):
        for part in (BODY, LEFT, RIGHT):
            kp[t, part] = _normalize_part(kp[t, part])
    return kp[None].astype(np.float32)


def islr_input(frames: list[dict]) -> np.ndarray:
    return np.concatenate([_arr(frames, "face", 468, 3, np.nan), _arr(frames, "lh", 21, 3, np.nan),
                           _arr(frames, "pose", 33, 3, np.nan), _arr(frames, "rh", 21, 3, np.nan)], axis=1)


# ------------------------------------------------------------------ labels -> our glosses

def gloss_of(label: str) -> str:
    """'THANK YOU' / 'thankyou' / 'FINE2' / 'want1' -> 'THANK-YOU', 'FINE', 'WANT'."""
    g = re.sub(r"\d+$", "", label.strip()).strip()
    g = re.sub(r"[\s_]+", "-", g).upper()
    return {"THANKYOU": "THANK-YOU", "PICKUP": "PICK-UP", "HOWMUCH": "HOW-MUCH"}.get(g.replace("-", ""), g)


@dataclass
class Guess:
    sign: str
    p: float


def _softmax(z: np.ndarray) -> np.ndarray:
    z = z - z.max()
    e = np.exp(z)
    return e / e.sum()


def _merge(labels: list[str], probs: np.ndarray, k: int) -> list[Guess]:
    """Variants of one sign (FINE1, FINE2) add up."""
    agg: dict[str, float] = {}
    for i in np.argsort(-probs)[: max(k * 4, 20)]:
        g = gloss_of(labels[i])
        agg[g] = agg.get(g, 0.0) + float(probs[i])
    return [Guess(s, p) for s, p in sorted(agg.items(), key=lambda x: -x[1])[:k]]


class SignBartModel:
    name = "signbart-asl-citizen-2730"
    needs_face = False

    def __init__(self, model_dir: str = MODEL_DIR) -> None:
        import onnxruntime as ort

        d = os.path.join(model_dir, "signbart")
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = int(os.environ.get("SIGN_THREADS", "2"))
        self.sess = ort.InferenceSession(os.path.join(d, "signbart.onnx"), opts, providers=["CPUExecutionProvider"])
        self.labels = json.load(open(os.path.join(d, "labels.json")))

    def predict(self, frames: list[dict], k: int = 5, allowed: Optional[set[str]] = None) -> list[Guess]:
        logits = self.sess.run(None, {"keypoints": signbart_input(frames)})[0][0]
        if allowed:
            mask = np.array([gloss_of(l) in allowed for l in self.labels])
            logits = np.where(mask, logits, -1e9)
        return _merge(self.labels, _softmax(logits), k)


class IslrModel:
    name = "islr-1st-place-250"
    needs_face = True

    def __init__(self, model_dir: str = MODEL_DIR) -> None:
        from ai_edge_litert.interpreter import Interpreter

        d = os.path.join(model_dir, "islr")
        self.interp = Interpreter(model_path=os.path.join(d, "model.tflite"))
        self.runner = self.interp.get_signature_runner("serving_default")
        m = json.load(open(os.path.join(d, "sign_to_prediction_index_map.json")))
        self.labels = [w for w, _ in sorted(m.items(), key=lambda x: x[1])]
        self.in_name = list(self.runner.get_input_details())[0]
        self.out_name = list(self.runner.get_output_details())[0]

    def predict(self, frames: list[dict], k: int = 5, allowed: Optional[set[str]] = None) -> list[Guess]:
        out = self.runner(**{self.in_name: islr_input(frames)})[self.out_name]
        logits = np.asarray(out, dtype=np.float32).reshape(-1)
        if allowed:
            mask = np.array([gloss_of(l) in allowed for l in self.labels])
            logits = np.where(mask, logits, -1e9)
        return _merge(self.labels, _softmax(logits), k)


def timed(model, frames: list[dict], **kw) -> tuple[list[Guess], float]:
    t0 = time.perf_counter()
    g = model.predict(frames, **kw)
    return g, (time.perf_counter() - t0) * 1000


