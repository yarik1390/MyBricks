import { bvIDB } from '../utils.js';

// Official web-optimized Gemma 4 E2B vision model (LiteRT). Hugging Face gates
// Gemma behind a license click-through, so anonymous downloads return 401 —
// users either supply an access token or import a manually-downloaded file.
export const DEFAULT_MODEL_URL = 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.task';
export const MODEL_LICENSE_PAGE = 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm';
const CACHE_KEY = 'gemma3_model_blob';
const OPFS_MODEL_FILE = 'gemma2b.bin';
// Vision (image) prompts need tasks-genai >= 0.10.24 — 0.10.14 was text-only.
const MEDIAPIPE_VERSION = '0.10.27';

let FilesetResolver = null;
let LlmInference = null;
let activeInferenceInstance = null;

// Load MediaPipe dynamically to keep initial page speed fast
async function loadMediaPipe() {
  if (FilesetResolver && LlmInference) return;
  const module = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@${MEDIAPIPE_VERSION}`);
  FilesetResolver = module.FilesetResolver;
  LlmInference = module.LlmInference;
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
  } catch (e) {
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

/** Check if the local vision model is already cached in OPFS */
export async function checkGemma3Downloaded() {
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(OPFS_MODEL_FILE);
    const file = await fileHandle.getFile();
    return file.size > 10_000_000; // must be at least 10MB to be valid
  } catch {
    return false;
  }
}

// Stream a ReadableStream into the OPFS model file, with progress + cleanup.
// On any failure the partial write is aborted and the file removed — otherwise
// a half-written file would pass the >10MB "is downloaded" check and break
// inference.
async function streamToOpfs(stream, totalBytes, onProgress) {
  const root = await navigator.storage.getDirectory();
  // Fail early with a clear message instead of a cryptic mid-stream QuotaExceededError.
  if (totalBytes && navigator.storage.estimate) {
    const est = await navigator.storage.estimate().catch(() => null);
    if (est && est.quota && (est.quota - (est.usage || 0)) < totalBytes) {
      throw new Error(`Not enough storage: the model needs ~${(totalBytes / 1e9).toFixed(1)}GB but only ${(((est.quota - (est.usage || 0))) / 1e9).toFixed(1)}GB is available to this site.`);
    }
  }
  const fileHandle = await root.getFileHandle(OPFS_MODEL_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  const reader = stream.getReader();
  let loadedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      loadedBytes += value.length;
      if (totalBytes && onProgress) onProgress(loadedBytes / totalBytes);
    }
    // Closing commits the file to OPFS — only do it on a complete write.
    await writable.close();
  } catch (err) {
    await writable.abort().catch(() => {});
    try {
      const r = await navigator.storage.getDirectory();
      await r.removeEntry(OPFS_MODEL_FILE);
    } catch {}
    throw err;
  }
}

function onModelReplaced() {
  // Clear any existing inference instance to force reload with the new model
  if (activeInferenceInstance) {
    activeInferenceInstance.close();
    activeInferenceInstance = null;
  }
  // Pre-OPFS versions stored the model blob in IndexedDB — free those gigabytes
  // for users upgrading from that build.
  bvIDB.del(CACHE_KEY).catch(() => {});
}

/** Download the model file with progress reporting and save directly to OPFS.
 *  `hfToken` (optional) authenticates against Hugging Face for license-gated
 *  models like the official Gemma weights. */
export async function downloadGemma3Model(modelUrl, onProgress, hfToken) {
  const url = modelUrl || DEFAULT_MODEL_URL;
  let hostname;
  try {
    hostname = new URL(url, location.href).hostname;
  } catch {
    throw new Error('Invalid model URL.');
  }
  const isHuggingFace = /(^|\.)(huggingface\.co|hf\.co)$/.test(hostname);
  const headers = {};
  if (hfToken && isHuggingFace) headers.Authorization = `Bearer ${hfToken}`;

  let response;
  try {
    response = await fetch(url, { headers });
  } catch (err) {
    // fetch() rejects with an opaque TypeError on CORS/CSP/network failures —
    // translate it into something the user can act on.
    throw new Error('Network or CORS error — the host may not allow browser downloads. Download the file manually and use "Import file" instead.');
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(isHuggingFace
        ? 'This model is license-gated (HTTP ' + response.status + '). Accept the Gemma license on huggingface.co, then paste a Hugging Face access token — or download the file manually and use "Import file".'
        : `Download rejected (HTTP ${response.status}).`);
    }
    if (response.status === 404) {
      throw new Error('Model URL not found (HTTP 404) — check the URL.');
    }
    throw new Error(`Failed to download model: HTTP ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  await streamToOpfs(response.body, totalBytes, onProgress);
  onModelReplaced();
  return true;
}

/** Import a model the user downloaded manually (file picker) into OPFS.
 *  Works regardless of license gating, CORS, or flaky mobile connections. */
export async function importGemma3ModelFile(file, onProgress) {
  if (!file) throw new Error('No file selected.');
  if (file.size < 10_000_000) {
    throw new Error('That file is too small to be a model — expected the multi-GB .task/.litertlm weights.');
  }
  await streamToOpfs(file.stream(), file.size, onProgress);
  onModelReplaced();
  return true;
}

/** Delete the downloaded model file from OPFS (and any legacy IDB blob) */
export async function deleteGemma3Model() {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OPFS_MODEL_FILE);
  } catch {}
  bvIDB.del(CACHE_KEY).catch(() => {});
  if (activeInferenceInstance) {
    activeInferenceInstance.close();
    activeInferenceInstance = null;
  }
}

/** Load the cached model from OPFS and initialize the MediaPipe LlmInference task */
async function getInferenceInstance() {
  if (activeInferenceInstance) return activeInferenceInstance;

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
      baseOptions: {
        modelAssetPath: modelUrl
      },
      maxNumImages: 1, // Enable multimodal image input
      maxTokens: 512
    });
  } finally {
    // Revoke the Blob URL immediately after creation to free memory
    URL.revokeObjectURL(modelUrl);
  }
  
  return activeInferenceInstance;
}

/**
 * Identify LEGO set from image bitmap/canvas using Gemma 3
 * @param {HTMLCanvasElement|HTMLImageElement|ImageBitmap} imageElement
 * @param {function} onStatus - callback for status updates
 */
export async function runLocalVisionScan(imageElement, onStatus) {
  if (onStatus) onStatus('Initializing local engine...');
  const llm = await getInferenceInstance();
  
  if (onStatus) onStatus('Analyzing image locally...');
  // tasks-genai multimodal prompt format: an array of string / {imageSource} parts.
  const prompt = [
    'You are a LEGO product-identification expert. Identify the LEGO set in this image. Look for any visible set numbers (usually 5 digits, e.g., 75192 or 10300) or distinctive box art/mini-figure details. Return ONLY raw JSON in this format: { "set_num": "...", "name": "...", "confidence": "high|medium|low|none", "reasoning": "..." }',
    { imageSource: imageElement }
  ];

  const response = await llm.generateResponse(prompt);
  
  // Clean up any extra markdown code block wrapping (e.g. ```json ... ```)
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
  } catch (err) {
    // Attempt regex extract if JSON parse fails
    const numMatch = cleanText.match(/\b\d{4,6}-?\d?\b/);
    if (numMatch) {
      return {
        identified: true,
        set_num: numMatch[0],
        name: 'Identified Set',
        confidence: 'medium',
        reasoning: 'Extracted set number locally.'
      };
    }
    throw new Error(`Failed to parse local AI response: ${response}`);
  }
}
