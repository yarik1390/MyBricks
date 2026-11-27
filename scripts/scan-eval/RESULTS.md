# Scan recognition test, 2026-11-12

78 real-world photos of 40 sets (`test-photos.json`: 56 built models, 15 boxes,
7 partial views).

## Image index (catalog image embeddings, nearest neighbour)

`@cf/qwen/qwen3-vl-embedding-2b` cannot be called from a Worker (error 5018,
"account is not allowed": the model is reserved for AI Search), so open image
models were run locally with onnxruntime against 2,934 catalog images (a tenth
of the real catalog, so real numbers would be lower).

| Model | Right set first | In top 5 |
| --- | --- | --- |
| SigLIP base patch16-224 (372 MB) | 73% | 99% |
| DINOv2 small (88 MB, 24 MB quantized) | 55% | 73-77% |
| CLIP ViT-B/32 (352 MB) | 47% | 67% |

## Brickognize (today's first photo step, its full catalog)

Right set first in 70 of 78 (90%), in top 5 for 75 of 78 (96%). Boxes 15/15,
built 51/56, partial 4/7. Median answer time about 0.8 s.

| Min score (margin 0.10) | Accepted | Right |
| --- | --- | --- |
| 0.75 (old rule) | 28 | 28 |
| 0.70 | 37 | 37 |
| 0.65 | 51 | 51 |
| 0.60 (new rule) | 55 | 55 |
| 0.55 | 60 | 59 |

Conclusion: an image index does not beat Brickognize, so it is not built. The
old acceptance rule threw away half of Brickognize's correct answers; the
score gate moved from 0.75 to 0.60.

Note: Brickognize rate-limits bursts (HTTP 429 after about 60 requests at 2
per second); space test requests a few seconds apart.

## 2026-11-27: fine-tuned SigLIP (Colab notebook, scripts/siglip-finetune)

L4 GPU, 18,516 catalog sets, 8 epochs, batch 128, catalog images with fake-photo
augmentation and look-alike batches. Same 78 photos, full catalog as gallery.

| Model | SigLIP top-1 | top-5 | Combined first answer | App right / wrong / to AI (margin 0.20) |
|---|---|---|---|---|
| Current (base) | 50/78 | 67/78 | 73/78 | 60 / 0 / 18 |
| Fine-tuned | 43/78 | 55/78 | 67/78 | 63 / 0 / 15 |

Not adopted: +3 app answers is within noise while the model's own ranking got
clearly worse and looser margins made more wrong guesses (0.05: 4 -> 6). Training
on dressed-up catalog images overfits the catalog style; a real gain needs real
photos to train on. The notebook verdict now reports such runs as MIXED.
