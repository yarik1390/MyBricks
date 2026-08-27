# MobileCLIP-S2 embedder (Cloudflare Container)

HTTP image → 512-d L2-normalized MobileCLIP-S2 vector.

Workers AI cannot run this model. This container is the owned encoder the
Worker calls via `CLIP_EMBED` (Fetcher) or `CLIP_EMBED_URL`.

## API

- `GET /health` → `{ ok, model: "mobileclip-s2", dim: 512 }` (503 if the ONNX file is missing)
- `POST /embed` with `Content-Type: image/jpeg|png|webp` and raw bytes
  → `{ vector: number[512], dim: 512, model: "mobileclip-s2" }`

## Run locally

Place a MobileCLIP-S2 **image-encoder** ONNX at `models/mobileclip-s2.onnx`
(512-d output, 256×256 CLIP-normalized input). Export from
[apple/ml-mobileclip](https://github.com/apple/ml-mobileclip) (`s2`). Do not
commit weights.

```bash
docker build -t brickvault-clip-embed containers/clip-embed
docker run --rm -p 8080:8080 -v $PWD/containers/clip-embed/models:/models brickvault-clip-embed
# Worker secret: CLIP_EMBED_URL=http://<host>:8080
```

`instance_type = standard-2` is enough. Keep `max_instances` at 1 until scan
volume justifies more; cold starts fail open to Brickognize inside the 14s
budget.
