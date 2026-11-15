"""A clean reimplementation of SignBart (Nguyen et al., 2025, arXiv:2506.21592) for inference.

Written for Sign2Speak from the paper and a read of the authors' code at
github.com/TinhNguyen2312/SignBart @ 1b7d3d1 (no code copied or executed from it).
It loads the published weights from Hugging Face `tinh2312/SignBart-ASL-2730`
(ASL Citizen, 2,730 signs) with strict key and shape checks, then exports ONNX.

Architecture: x coordinates and y coordinates of 48 joints are projected separately to
d_model. x goes through a BART-style encoder (self-attention), y through a decoder
(causal self-attention + cross-attention to the x encoding). The last frame's decoder
state is classified.

Batch size 1 and no padding at inference, so the attention masks reduce to the causal mask.

    python model/signbart_model.py            # export model/signbart/signbart.onnx + labels.json
"""
from __future__ import annotations

import json
import math
import os

import torch
from torch import nn

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "signbart")
JOINT_IDX = list(range(11, 17)) + list(range(33, 75))   # body 11-16, left hand 33-53, right hand 54-74


class Attention(nn.Module):
    def __init__(self, d: int, heads: int, causal: bool = False) -> None:
        super().__init__()
        self.h, self.dh, self.causal = heads, d // heads, causal
        self.q_proj, self.k_proj = nn.Linear(d, d), nn.Linear(d, d)
        self.v_proj, self.out_proj = nn.Linear(d, d), nn.Linear(d, d)

    def forward(self, x: torch.Tensor, kv: torch.Tensor | None = None) -> torch.Tensor:
        kv = x if kv is None else kv
        b, t, d = x.shape
        s = kv.shape[1]
        q = (self.q_proj(x) * self.dh ** -0.5).view(b, t, self.h, self.dh).transpose(1, 2)
        k = self.k_proj(kv).view(b, s, self.h, self.dh).transpose(1, 2)
        v = self.v_proj(kv).view(b, s, self.h, self.dh).transpose(1, 2)
        w = q @ k.transpose(-1, -2)
        if self.causal:
            tril = torch.tril(torch.ones(t, s, dtype=x.dtype))
            # The authors' mask adds +1 on allowed positions; a constant per row doesn't change softmax,
            # but keep it so logits match the original exactly.
            w = w.masked_fill(tril == 0, float("-inf")) + tril
        w = torch.softmax(w, dim=-1)
        return self.out_proj((w @ v).transpose(1, 2).reshape(b, t, d))


class Block(nn.Module):
    def __init__(self, d: int, heads: int, ffn: int, decoder: bool) -> None:
        super().__init__()
        self.decoder = decoder
        self.self_attn = Attention(d, heads, causal=decoder)
        self.self_attn_layer_norm = nn.LayerNorm(d)
        if decoder:
            self.encoder_attn = Attention(d, heads)
            self.encoder_attn_layer_norm = nn.LayerNorm(d)
        self.fc1, self.fc2 = nn.Linear(d, ffn), nn.Linear(ffn, d)
        self.final_layer_norm = nn.LayerNorm(d)

    def forward(self, h: torch.Tensor, enc: torch.Tensor | None = None) -> torch.Tensor:
        h = self.self_attn_layer_norm(h + self.self_attn(h))
        if self.decoder:
            h = self.encoder_attn_layer_norm(h + self.encoder_attn(h, enc))
        return self.final_layer_norm(h + self.fc2(nn.functional.gelu(self.fc1(h))))


class Stack(nn.Module):
    def __init__(self, cfg: dict, decoder: bool) -> None:
        super().__init__()
        d = cfg["d_model"]
        pre = "decoder" if decoder else "encoder"
        self.embed_positions = nn.Embedding(cfg["max_position_embeddings"] + 2, d)   # BART offset of 2
        self.layernorm_embedding = nn.LayerNorm(d)
        self.layers = nn.ModuleList(
            Block(d, cfg[f"{pre}_attention_heads"], cfg[f"{pre}_ffn_dim"], decoder) for _ in range(cfg[f"{pre}_layers"]))

    def forward(self, x: torch.Tensor, enc: torch.Tensor | None = None) -> torch.Tensor:
        pos = torch.arange(x.shape[1]) + 2
        h = self.layernorm_embedding(x + self.embed_positions(pos)[None])
        for layer in self.layers:
            h = layer(h, enc)
        return h


class Projection(nn.Module):
    def __init__(self, joints: int, d: int) -> None:
        super().__init__()
        self.proj_x1, self.proj_y1 = nn.Linear(joints, d), nn.Linear(joints, d)


class Head(nn.Module):
    def __init__(self, d: int, n: int) -> None:
        super().__init__()
        self.out_proj = nn.Linear(d, n)


class SignBart(nn.Module):
    def __init__(self, cfg: dict, num_labels: int) -> None:
        super().__init__()
        self.joint_idx = list(cfg["joint_idx"])
        self.projection = Projection(len(self.joint_idx), cfg["d_model"])
        self.encoder = Stack(cfg, decoder=False)
        self.decoder = Stack(cfg, decoder=True)
        self.classification_head = Head(cfg["d_model"], num_labels)

    def forward(self, keypoints: torch.Tensor) -> torch.Tensor:
        """keypoints [1, T, 75, 2], already normalized per part -> logits [1, num_labels]."""
        kp = keypoints[:, :, self.joint_idx, :]
        x = self.projection.proj_x1(kp[..., 0])
        y = self.projection.proj_y1(kp[..., 1])
        enc = self.encoder(x)
        dec = self.decoder(y, enc)
        return self.classification_head.out_proj(dec[:, -1, :])


def load() -> tuple[SignBart, list[str]]:
    from safetensors.torch import load_file

    cfg = json.load(open(os.path.join(OUT, "config.json")))
    assert list(cfg["joint_idx"]) == JOINT_IDX, "unexpected joint layout"
    labels = [cfg["id2label"][str(i)] for i in range(len(cfg["id2label"]))]
    model = SignBart(cfg, len(labels))
    sd = load_file(os.path.join(OUT, "model.safetensors"))
    sd = {k: v for k, v in sd.items() if not k.endswith("embed_tokens.weight")}   # unused BART leftover
    own = model.state_dict()
    missing = sorted(set(own) - set(sd))
    unexpected = sorted(set(sd) - set(own))
    shapes = [k for k in own if k in sd and own[k].shape != sd[k].shape]
    assert not missing and not unexpected and not shapes, (missing, unexpected, shapes)
    model.load_state_dict(sd, strict=True)
    return model.eval(), labels


def export() -> None:
    import numpy as np
    import onnxruntime as ort

    model, labels = load()
    n = sum(p.numel() for p in model.parameters())
    print(f"loaded {len(labels)} labels, {n / 1e6:.2f}M parameters, every weight matched")
    path = os.path.join(OUT, "signbart.onnx")
    torch.onnx.export(model, (torch.rand(1, 40, 75, 2),), path, input_names=["keypoints"], output_names=["logits"],
                      dynamic_axes={"keypoints": {1: "T"}}, opset_version=17, dynamo=False)
    sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    for t in (8, 33, 64):
        kp = torch.rand(1, t, 75, 2)
        with torch.no_grad():
            ref = model(kp).numpy()
        got = sess.run(None, {"keypoints": kp.numpy()})[0]
        err = float(np.abs(ref - got).max())
        print(f"T={t}: max |torch - onnx| = {err:.1e}, same top-1: {bool(ref.argmax() == got.argmax())}")
        assert err < 1e-3
    json.dump(labels, open(os.path.join(OUT, "labels.json"), "w"))
    print(f"wrote {path} ({os.path.getsize(path) // 1024} KB) and labels.json")


if __name__ == "__main__":
    export()


