"""MobileCLIP-S2 image embedder.

POST /embed with raw image bytes (image/jpeg|png|webp) → 512-d vector.
The ONNX weights are NOT in git; mount them at CLIP_ONNX_PATH.
"""
from __future__ import annotations

import io
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from PIL import Image

DIM = 512
MODEL_NAME = "mobileclip-s2"
ONNX_PATH = os.environ.get("CLIP_ONNX_PATH", "/models/mobileclip-s2.onnx")
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
SIZE = 256

_session = None


def load_session():
    global _session
    if _session is not None:
        return _session
    if not os.path.isfile(ONNX_PATH):
        return None
    import onnxruntime as ort

    _session = ort.InferenceSession(ONNX_PATH, providers=["CPUExecutionProvider"])
    return _session


def preprocess(raw: bytes) -> np.ndarray:
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    image.thumbnail((SIZE, SIZE), Image.Resampling.BICUBIC)
    canvas = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))
    canvas.paste(image, ((SIZE - image.width) // 2, (SIZE - image.height) // 2))
    arr = np.asarray(canvas).astype(np.float32) / 255.0
    arr = (arr - MEAN) / STD
    # NCHW
    return np.transpose(arr, (2, 0, 1))[None, ...]


def embed(raw: bytes) -> list[float]:
    session = load_session()
    if session is None:
        raise FileNotFoundError(f"ONNX model missing at {ONNX_PATH}")
    inp = session.get_inputs()[0].name
    out = session.run(None, {inp: preprocess(raw)})[0].reshape(-1).astype(np.float32)
    if out.size != DIM:
        raise ValueError(f"expected {DIM}-d output, got {out.size}")
    mag = float(np.linalg.norm(out))
    if mag > 1e-12:
        out = out / mag
    return out.tolist()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        print(f"[clip-embed] {self.address_string()} {fmt % args}")

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?")[0] != "/health":
            return self._json(404, {"error": "not found"})
        ok = load_session() is not None
        self._json(200 if ok else 503, {"ok": ok, "model": MODEL_NAME, "dim": DIM})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?")[0] != "/embed":
            return self._json(404, {"error": "not found"})
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > 1_500_000:
            return self._json(413, {"error": "image too large"})
        raw = self.rfile.read(length)
        try:
            vector = embed(raw)
        except FileNotFoundError as exc:
            return self._json(503, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001 — surface preprocess/ONNX errors
            return self._json(400, {"error": str(exc)})
        self._json(200, {"vector": vector, "dim": DIM, "model": MODEL_NAME})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
