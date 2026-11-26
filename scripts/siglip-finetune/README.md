# SigLIP fine-tune (Google Colab)

Open in Colab: https://colab.research.google.com/github/yarik1390/MyBricks/blob/main/scripts/siglip-finetune/siglip_finetune.ipynb

Fine-tunes the SigLIP image model behind the photo scanner's second opinion
(`siglip/`, `worker/src/lib/siglip.ts`) on catalog set images made to look
like real photos (random backgrounds, angles, crops, lighting), with training
batches full of look-alike sets. It measures the current model and the
fine-tuned one on the 78 real test photos (`scripts/scan-eval/test-photos.json`,
never trained on), using Brickognize's saved answers for those photos
(`scripts/scan-eval/brickognize-top5.json`) and the app's exact decision rule
(Brickognize gate 0.60/0.10, fused accept margin 0.20).

Run: Runtime → Change runtime type → A100 GPU, then Runtime → Run all (about
1 to 1.5 h). Results and the exported model go to `MyDrive/bricksvault-siglip/output/`:
`results.md`, `results.json`, `siglip-bricksvault.zip` (transformers.js layout:
`config.json`, `preprocessor_config.json`, `onnx/vision_model.onnx`, checked
against PyTorch and against transformers.js 3.7.5).

The model is only switched into the scanner service if it gives more right
answers with no extra wrong ones. Switching also means re-embedding the
catalog (`siglip_embeddings` reset) because old and new vectors don't mix.
The weights are trained on catalog images: keep them private.

Smoke test without a GPU: `SIGLIP_QUICK=1 SIGLIP_RAW=$PWD/scripts/scan-eval`
plus the code cells run as a script (300 sets, 12 photos, 1 epoch).
