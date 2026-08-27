# CLIP visual set-ID index (Slice 2)

Photo in → MobileCLIP-S2 embedding → Cloudflare Vectorize nearest-neighbor →
ranked `set_num`. This sits **after OCR** and **before Brickognize** on
`POST /api/scan/identify`. Shelf Snap is unchanged.

Workers AI has **no CLIP / image-embedding models** (text embeddings + VLMs
only). Do not call `@cf/openai/clip` or BGE on images. Gemini Embedding 2 is
not the long-term index — it would lock vectors to Google.

## Query path

```
OCR (printed set number)
  → CLIP embed + Vectorize   (this slice)
    → Brickognize
      → paid VLM cascade
```

A unique high-confidence CLIP hit returns `identified: true` with
`model: "clip/mobileclip-s2"` and `diag.timings.provider = "clip"`. Ambiguous /
low score / embed failure / unbound embedder fall through.

Accept/margin gates match `worker/src/lib/brickognize.ts`:

| Gate | Value | Meaning |
|---|---|---|
| `CLIP_SCORE_MIN` | **0.75** | Vectorize cosine similarity (L2-normalized MobileCLIP-S2) |
| `CLIP_MARGIN_MIN` | **0.10** | Gap vs the next *set*, after collapse-by-`set_num` |

Calibration: official pack-shot vs official pack-shot of the **same** set
typically sits 0.85–0.98; distinct sets cluster lower. **Built-set photos
without the box will often score 0.55–0.75 against official pack shots and
therefore fall through to Brickognize** until user-confirmed photos are indexed
in a later slice. The 0.75 bar is a conservative Brickognize-equivalent gate,
not Brickognize-level recall on assembled models.

## What is indexed

**Only official catalog images already in D1:**

1. `lego_sets.image_url` when it is a Rebrickable set shot (`cdn.rebrickable.com`, not `/media/mocs/`)
2. Up to two additional URLs from `lego_sets.brickset_image_urls` when they are `images.brickset.com`

That's 1–3 views per set (box / official). The indexer prefers the R2 image
cache (`PHOTO_BUCKET` keys from `imageR2Key`) and only fetches origin if the
object is missing. ~27k sets; do **not** download the catalog in CI.

**Never indexed:** BrickLink images, MOCs, user collection photos, contribution
gallery pixels. Embeddings + existing catalog URLs only — pixels are not
republished.

Rebrickable allows caching Set/Part/Minifig images on external apps; credit
them. Brickset additional shots already stored in D1 are official pack
photography (the app already attributes Brickset on the gallery).

## Bindings

### Vectorize (in `worker/wrangler.toml`)

```toml
[[vectorize]]
binding = "SET_CLIP"
index_name = "brickvault-set-clip"
```

Create once before the first production deploy of this binding:

```bash
cd worker
npx wrangler vectorize create brickvault-set-clip --dimensions=512 --metric=cosine
```

### Production embedder (the one remaining bind)

The Worker talks to an owned encoder over:

| Binding | How |
|---|---|
| `CLIP_EMBED` | Fetcher (Cloudflare Container or service binding) `POST https://clip-embed/embed` |
| `CLIP_EMBED_URL` | Worker secret, HTTP origin of the same `/embed` API |

`CLIP_ENABLED=0` emergency-skips the step. If neither embedder is bound, CLIP
is skipped with no timing row (same as Brickognize disabled).

Container source: `containers/clip-embed/` (MobileCLIP-S2 ONNX, `standard-2`).
Container bindings are **commented out** in `wrangler.toml` because CI/dry-run
has no published image; wiring them before the image exists would fail
`wrangler deploy`. After the image is published:

```toml
[[containers]]
class_name = "ClipEmbedContainer"
image = "../containers/clip-embed/Dockerfile"
instance_type = "standard-2"
max_instances = 1
```

plus a Durable Object export from the Worker (see Cloudflare Containers docs).
Until then, run the container anywhere reachable and set `CLIP_EMBED_URL`.

Query embeddings are cached in KV as `scan:clip:v1:{sha256(bytes)}` (30d), like
Brickognize's per-image cache. Vectorize is still queried so an updated index
is visible.

## Indexing

Incremental Worker job (no-op until the embedder is bound):

- cron `30 17 * * *` → `runClipIndex` (40 sets/run)
- admin `POST /api/admin/jobs/clip-index?limit=`

Bootstrap the catalog **locally** (ONNX or a running embedder), not in CI:

```bash
# 1. Dump candidate URLs from D1 (operator machine / one-off)
# 2. Embed with the container or local ONNX
# 3. Upsert JSONL into Vectorize
node scripts/clip-index.mjs --help
```

Progress lives in D1 `set_clip_index` (`vector_id`, `set_num`, `view`,
`image_url`, `model`, `dim`). Vectors themselves live only in Vectorize.

## Cost (10k scans/month)

| Piece | Steady-state |
|---|---|
| Vectorize query | included in Workers Paid at this volume (10k queries/mo is well under paid quotas) |
| KV embedding cache | pennies; repeats of the same photo are free after the first embed |
| Container `standard-2` | ~$0–5/mo if it sleeps between scans (`sleepAfter`); cold starts fall through to Brickognize rather than blocking the 14s budget |
| Brickognize / VLM | unchanged for CLIP misses; CLIP hits skip both |

Indexing 27k official JPEGs is a one-off: local ONNX is $0; a Container
backfill is a few hours of `standard-2`. No Gemini Embedding 2, no Workers AI
CLIP (it does not exist).

Quotas / Turnstile / idempotency / the 20-unit free daily cap are unchanged.

## Accuracy caveat

Official-image CLIP will identify **box / catalog photography** well and
**assembled models / messy table shots** poorly compared with Brickognize
(which trained on user photos). That is expected for this slice. A later
index of user-confirmed scan photos is what closes that gap.
