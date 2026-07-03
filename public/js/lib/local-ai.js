import { bvIDB } from '../utils.js';
import { resolveDownloadResume } from './pure.js';

// Official web-optimized Gemma 4 E2B vision model (LiteRT). Hugging Face gates
// Gemma behind a license click-through, so anonymous downloads return 401 —
// users either supply an access token or import a manually-downloaded file.
export const DEFAULT_MODEL_URL = 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.task';
export const MODEL_LICENSE_PAGE = 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm';
const CACHE_KEY = 'gemma3_model_blob';
const OPFS_MODEL_FILE = 'gemma2b.bin';
const DOWNLOAD_META_KEY = 'bv_gemma_dl';
// Vision (image) prompts need tasks-genai >= 0.10.24 — 0.10.14 was text-only.
const MEDIAPIPE_VERSION = '0.10.27';
// Close + reopen the OPFS writable every 256MB so progress survives a crash.
const CHECKPOINT_INTERVAL = 256 * 1024 * 1024;

let FilesetResolver = null;
let LlmInference = null;
let activeInferenceInstance = null;

// --- Download metadata helpers (localStorage, sync) ---
function getDlMeta() {
  try { return JSON.parse(localStorage.getItem(DOWNLOAD_META_KEY) || 'null'); } catch { return null; }
}
function setDlMeta(m) {
  try { localStorage.setItem(DOWNLOAD_META_KEY, JSON.stringify(m)); } catch {}
}
function clearDlMeta() {
  try { localStorage.removeItem(DOWNLOAD_META_KEY); } catch {}
}

/** Return the current partial-download metadata (url, loadedBytes, totalBytes, complete). */
export function getDownloadMetadata() {
  return getDlMeta();
}

/** Return whether the browser has granted persistent storage (true/false/null if unsupported). */
export async function checkStoragePersisted() {
  try { return await navigator.storage.persisted(); } catch { return null; }
}

// Load MediaPipe dynamically to keep initial page speed fast.
async function loadMediaPipe() {
  if (FilesetResolver && LlmInference) return;
  const module = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@${MEDIAPIPE_VERSION}`);
  FilesetResolver = module.FilesetResolver;
  LlmInference = module.LlmInference;
}

/** Load MediaPipe JS + wasm into the SW cache while online, so scanning
 *  works even after the device goes offline. Safe to call speculatively. */
export function prewarmMediaPipeCache() {
  loadMediaPipe().then(() => {
    if (FilesetResolver) {
      return FilesetResolver.forGenAiTasks(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@${MEDIAPIPE_VERSION}/wasm`
      );
    }
  }).catch(() => {});
}

// Chrome has shipped the Prompt API under three namespaces over time:
// the current global `LanguageModel`, and the legacy `self.ai.languageModel`
// / `self.ai.assistant`. Support all three.
function getPromptApi() {
  if (typeof self === 'undefined') return null;
  if ('LanguageModel' in self) return self.LanguageModel;
  if ('ai' in self && self.ai) return self.ai.languageModel || self.ai.assistant || null;
  return null;
}

/** Check if Chrome's Built-in AI Prompt API is supported in the browser */
export function isLocalAiSupported() {
  return getPromptApi() !== null;
}

/** On-device Gemma vision/LLM runs on MediaPipe, which requires WebGPU.
 *  iOS Safari and many desktop browsers lack it, so the scan path gates on
 *  this and falls back to the cloud when it's missing. */
export function isWebGpuAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

/** Availability of Chrome's Built-in AI, normalized to the legacy values
 *  'readily' | 'after-download' | 'no' that the UI checks against.
 *  (Current Chrome returns 'available'/'downloadable'/'downloading'/'unavailable';
 *  older builds expose capabilities().available instead of availability().) */
export async function getLocalAiAvailability() {
  const api = getPromptApi();
  if (!api) return 'no';
  try {
    let v;
    if (typeof api.availability === 'function') v = await api.availability();
    else if (typeof api.capabilities === 'function') v = (await api.capabilities())?.available;
    if (v === 'available' || v === 'readily') return 'readily';
    if (v === 'downloadable' || v === 'downloading' || v === 'after-download') return 'after-download';
    return 'no';
  } catch {
    return 'no';
  }
}

/** Create an on-device text chat session using Chrome's Prompt API */
export async function createLocalAiSession(systemPrompt) {
  const api = getPromptApi();
  if (!api) throw new Error('Built-in AI is not supported on this browser.');
  // The current API takes initialPrompts; legacy namespaces take systemPrompt.
  if (typeof self !== 'undefined' && 'LanguageModel' in self) {
    return await api.create({ initialPrompts: [{ role: 'system', content: systemPrompt }] });
  }
  return await api.create({ systemPrompt });
}

/** Check if the local vision model is already cached and complete in OPFS. */
export async function checkGemma3Downloaded() {
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(OPFS_MODEL_FILE);
    const file = await fileHandle.getFile();
    if (file.size < 10_000_000) return false;
    const meta = getDlMeta();
    // If we have metadata, require the complete flag and a reasonable size match.
    // Fall back to size-only for models imported before metadata was introduced.
    if (meta && meta.url) {
      if (!meta.complete) return false;
      if (meta.totalBytes && Math.abs(file.size - meta.totalBytes) > 1_000_000) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Stream `stream` into the OPFS model file starting at `startOffset`.
// Checkpoints every CHECKPOINT_INTERVAL bytes by closing + reopening the
// writable so bytes are committed to disk — if the browser crashes or the
// fetch is aborted, progress up to the last checkpoint survives.
// Calls `onCheckpoint(committedBytes)` after each checkpoint (use to persist metadata).
// On error throws with `err.committedBytes` = how much is safely on disk.
async function streamToOpfs(stream, totalBytes, startOffset, onProgress, onCheckpoint, signal) {
  const root = await navigator.storage.getDirectory();
  const remaining = totalBytes ? totalBytes - startOffset : 0;
  if (remaining > 0 && navigator.storage.estimate) {
    const est = await navigator.storage.estimate().catch(() => null);
    if (est?.quota) {
      const free = est.quota - (est.usage || 0);
      if (free < remaining) {
        throw new Error(
          `Not enough storage: need ~${(remaining / 1e9).toFixed(1)}GB but only ${(free / 1e9).toFixed(1)}GB is free on this site.`
        );
      }
    }
  }

  let committedOffset = startOffset;
  let fileHandle = await root.getFileHandle(OPFS_MODEL_FILE, { create: true });
  let writable = await fileHandle.createWritable({ keepExistingData: startOffset > 0 });
  if (startOffset > 0) await writable.seek(startOffset);

  const STALL_MS = 60_000;
  const reader = stream.getReader();
  let sessionBytes = 0;

  // One abort-promise shared across all chunk races; avoids per-chunk listener churn.
  let abortReject;
  const abortPromise = new Promise((_, rej) => { abortReject = rej; });
  const abortHandler = () => abortReject(new Error('Download cancelled.'));
  signal?.addEventListener('abort', abortHandler, { once: true });

  try {
    while (true) {
      // Race each chunk read against a stall timer (dead TCP) and abort signal.
      let stallTimer;
      const { done, value } = await Promise.race([
        reader.read(),
        abortPromise,
        new Promise((_, rej) => {
          stallTimer = setTimeout(
            () => rej(new Error('Download stalled — connection may be idle. Tap Resume to continue.')),
            STALL_MS
          );
        }),
      ]);
      clearTimeout(stallTimer);
      if (done) break;
      await writable.write(value);
      sessionBytes += value.length;
      if (totalBytes && onProgress) onProgress(Math.min(1, (committedOffset + sessionBytes) / totalBytes));

      // Checkpoint: close (commits to disk) then reopen to continue.
      if (sessionBytes >= CHECKPOINT_INTERVAL) {
        await writable.close();
        committedOffset += sessionBytes;
        sessionBytes = 0;
        if (onCheckpoint) onCheckpoint(committedOffset);
        fileHandle = await root.getFileHandle(OPFS_MODEL_FILE);
        writable = await fileHandle.createWritable({ keepExistingData: true });
        await writable.seek(committedOffset);
      }
    }
    await writable.close();
    if (onCheckpoint) onCheckpoint(committedOffset + sessionBytes);
  } catch (err) {
    signal?.removeEventListener('abort', abortHandler);
    // Abort discards bytes since last checkpoint; file has committedOffset bytes.
    await reader.cancel().catch(() => {});
    await writable.abort().catch(() => {});
    const e = new Error(err?.message || String(err));
    e.committedBytes = committedOffset;
    throw e;
  }
  signal?.removeEventListener('abort', abortHandler);
}

function onModelReplaced() {
  if (activeInferenceInstance) {
    activeInferenceInstance.close();
    activeInferenceInstance = null;
  }
  // Pre-OPFS versions stored the model blob in IndexedDB — free those gigabytes.
  bvIDB.del(CACHE_KEY).catch(() => {});
  // Request persistent storage so the OS won't evict the multi-GB model file.
  navigator.storage?.persist?.().catch(() => {});
  // Prewarm MediaPipe CDN assets into the SW cache while still online.
  prewarmMediaPipeCache();
}

/** Download the model with progress reporting and resumable checkpointing.
 *  `hfToken` (optional) authenticates HuggingFace for license-gated models.
 *  Saves partial progress to localStorage so a tap on Download resumes. */
export async function downloadGemma3Model(modelUrl, onProgress, hfToken, signal) {
  const url = modelUrl || DEFAULT_MODEL_URL;
  let hostname;
  try { hostname = new URL(url, location.href).hostname; } catch {
    throw new Error('Invalid model URL.');
  }
  const isHuggingFace = /(^|\.)(huggingface\.co|hf\.co)$/.test(hostname);

  // Check for a partial download to resume.
  const existingMeta = getDlMeta();
  const canResume = !!(existingMeta && existingMeta.url === url &&
                       existingMeta.loadedBytes > 0 && !existingMeta.complete);

  const headers = {};
  if (hfToken && isHuggingFace) headers.Authorization = `Bearer ${hfToken}`;
  if (canResume) {
    headers['Range'] = `bytes=${existingMeta.loadedBytes}-`;
    if (existingMeta.etag) headers['If-Range'] = existingMeta.etag;
  }

  let response;
  try {
    response = await fetch(url, { headers, ...(signal && { signal }) });
  } catch {
    throw new Error(
      'Network or CORS error — the host may not allow browser downloads. Download the file manually and use "Import file" instead.'
    );
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(isHuggingFace
        ? `This model is license-gated (HTTP ${response.status}). Accept the Gemma license on huggingface.co, paste a Hugging Face access token — or download the file manually and use "Import file".`
        : `Download rejected (HTTP ${response.status}).`);
    }
    if (response.status === 404) throw new Error('Model URL not found (HTTP 404) — check the URL.');
    throw new Error(`Failed to download model: HTTP ${response.status} ${response.statusText}`);
  }

  const etag = response.headers.get('etag') || response.headers.get('last-modified') || '';
  const contentRange = response.headers.get('content-range'); // "bytes START-END/TOTAL"
  const contentLength = response.headers.get('content-length');

  // Determine start offset and total size.
  let startOffset = 0;
  let totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

  if (response.status === 206 && canResume) {
    startOffset = resolveDownloadResume(existingMeta, 206, etag);
    const rangeTotal = contentRange ? parseInt(contentRange.split('/')[1], 10) : 0;
    // Fall back to existingMeta.totalBytes when the server omits both
    // content-range and content-length (common with HuggingFace CDN redirects).
    totalBytes = rangeTotal
      || (startOffset + (parseInt(contentLength, 10) || 0))
      || existingMeta.totalBytes
      || 0;
  }

  // Persist metadata immediately so a crash mid-download preserves the URL/etag.
  setDlMeta({ url, etag, totalBytes, loadedBytes: startOffset, complete: false });

  try {
    await streamToOpfs(response.body, totalBytes, startOffset, onProgress, (committed) => {
      setDlMeta({ url, etag, totalBytes, loadedBytes: committed, complete: false });
    }, signal);
    setDlMeta({ url, etag, totalBytes, loadedBytes: totalBytes || 0, complete: true });
    onModelReplaced();
    return true;
  } catch (err) {
    const committed = err.committedBytes ?? startOffset;
    if (committed > 0) {
      setDlMeta({ url, etag, totalBytes, loadedBytes: committed, complete: false });
      const pct = totalBytes ? Math.round(committed / totalBytes * 100) : '?';
      throw new Error(`Download interrupted at ${pct}% — tap Download to resume from where it left off.`);
    }
    clearDlMeta();
    throw err;
  }
}

/** Import a model the user downloaded manually (file picker) into OPFS.
 *  Works regardless of license gating, CORS, or flaky mobile connections. */
export async function importGemma3ModelFile(file, onProgress) {
  if (!file) throw new Error('No file selected.');
  if (file.size < 10_000_000) {
    throw new Error('That file is too small to be a model — expected the multi-GB .task/.litertlm weights.');
  }
  const baseMeta = { url: 'imported', etag: '', totalBytes: file.size, loadedBytes: 0, complete: false };
  setDlMeta(baseMeta);
  try {
    await streamToOpfs(file.stream(), file.size, 0, onProgress, (committed) => {
      setDlMeta({ ...baseMeta, loadedBytes: committed });
    });
    setDlMeta({ ...baseMeta, loadedBytes: file.size, complete: true });
    onModelReplaced();
    return true;
  } catch (err) {
    const committed = err.committedBytes ?? 0;
    if (committed > 0) setDlMeta({ ...baseMeta, loadedBytes: committed });
    else clearDlMeta();
    throw err;
  }
}

/** Delete the downloaded model file from OPFS (and any legacy IDB blob). */
export async function deleteGemma3Model() {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OPFS_MODEL_FILE);
  } catch {}
  clearDlMeta();
  bvIDB.del(CACHE_KEY).catch(() => {});
  if (activeInferenceInstance) {
    activeInferenceInstance.close();
    activeInferenceInstance = null;
  }
}

/** Load the cached model from OPFS and initialize the MediaPipe LlmInference task. */
async function getInferenceInstance() {
  if (activeInferenceInstance) return activeInferenceInstance;

  // Fail fast + clearly when the device can't run on-device inference, so the
  // scanner can fall back to the cloud instead of surfacing an opaque error.
  if (!isWebGpuAvailable()) {
    throw new Error('On-device AI requires WebGPU, which this browser/device does not support.');
  }

  await loadMediaPipe();

  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(OPFS_MODEL_FILE);
  const file = await fileHandle.getFile();
  if (!file || file.size < 10_000_000) {
    throw new Error('Gemma model is not downloaded. Please download it in Settings.');
  }

  const modelUrl = URL.createObjectURL(file);
  try {
    const genai = await FilesetResolver.forGenAiTasks(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@${MEDIAPIPE_VERSION}/wasm`
    );
    activeInferenceInstance = await LlmInference.createFromOptions(genai, {
      baseOptions: { modelAssetPath: modelUrl },
      maxNumImages: 1,
      maxTokens: 512
    });
  } catch (err) {
    // MediaPipe throws generic errors on OOM — translate them for the user.
    if (/memory|allocat|oom|out of/i.test(err?.message || '')) {
      throw new Error('Not enough memory to load the model. Try closing other apps or tabs.');
    }
    throw err;
  } finally {
    URL.revokeObjectURL(modelUrl);
  }
  return activeInferenceInstance;
}

/**
 * Run a text query through the Gemma model (no image).
 * `onPartial(text)` is called with the cumulative text so far during streaming.
 * Returns the final response string.
 */
export async function runLocalTextInference(textPrompt, onPartial) {
  const llm = await getInferenceInstance();
  if (onPartial) {
    return llm.generateResponse(textPrompt, (partial) => { onPartial(partial); });
  }
  return llm.generateResponse(textPrompt);
}

/**
 * Identify LEGO set from image bitmap/canvas using Gemma.
 * @param {HTMLCanvasElement|HTMLImageElement|ImageBitmap} imageElement
 * @param {function} onStatus - callback for status updates
 */
export async function runLocalVisionScan(imageElement, onStatus) {
  if (onStatus) onStatus('Initializing local engine...');
  const llm = await getInferenceInstance();

  if (onStatus) onStatus('Analyzing image locally...');
  // tasks-genai multimodal prompt: array of string / {imageSource} parts.
  // Keep the requested output TERSE: on-device latency is dominated by the number
  // of tokens generated, so we drop the free-text "reasoning" field (the biggest
  // token sink) and ask only for the set number, name and confidence.
  const prompt = [
    'You are a LEGO product-identification expert. Identify the LEGO set in this image. Look for any visible set number (usually 5 digits, e.g. 75192 or 10300) or distinctive box art. Return ONLY raw JSON, no prose, no explanation: { "set_num": "...", "name": "...", "confidence": "high|medium|low|none" }',
    { imageSource: imageElement }
  ];

  const response = await llm.generateResponse(prompt);

  let cleanText = response.trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```(json)?/, '').replace(/```$/, '').trim();
  }

  try {
    const parsed = JSON.parse(cleanText);
    return {
      identified: parsed.confidence !== 'none' && !!parsed.set_num,
      set_num: parsed.set_num,
      name: parsed.name,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning
    };
  } catch {
    const numMatch = cleanText.match(/\b\d{4,6}-?\d?\b/);
    if (numMatch) {
      return { identified: true, set_num: numMatch[0], name: 'Identified Set', confidence: 'medium', reasoning: 'Extracted set number locally.' };
    }
    throw new Error(`Failed to parse local AI response: ${response}`);
  }
}
