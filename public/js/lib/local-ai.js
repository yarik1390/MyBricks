import { bvIDB } from '../utils.js';

// Default model URL (a community mirror of the WebGPU-optimized quantized Gemma 2B model)
export const DEFAULT_MODEL_URL = 'https://huggingface.co/jardpound/gemma-2b-it-gpu-int4/resolve/main/gemma-2b-it-gpu-int4.bin';
const CACHE_KEY = 'gemma3_model_blob';

let FilesetResolver = null;
let LlmInference = null;
let activeInferenceInstance = null;

// Load MediaPipe dynamically to keep initial page speed fast
async function loadMediaPipe() {
  if (FilesetResolver && LlmInference) return;
  const module = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.14');
  FilesetResolver = module.FilesetResolver;
  LlmInference = module.LlmInference;
}

function getPromptApi() {
  if (typeof self === 'undefined' || !('ai' in self)) return null;
  return self.ai.languageModel || self.ai.assistant;
}

/** Check if Chrome's Built-in AI Prompt API is supported in the browser */
export function isLocalAiSupported() {
  return getPromptApi() !== null;
}

/** Get availability status of Chrome's Built-in AI */
export async function getLocalAiAvailability() {
  const api = getPromptApi();
  if (!api) return 'no';
  try {
    return await api.availability();
  } catch (e) {
    return 'no';
  }
}

/** Create an on-device text chat session using Chrome's Prompt API */
export async function createLocalAiSession(systemPrompt) {
  const api = getPromptApi();
  if (!api) throw new Error('Built-in AI is not supported on this browser.');
  const opts = {
    systemPrompt: systemPrompt
  };
  return await api.create(opts);
}

/** Check if the local vision model is already cached in OPFS */
export async function checkGemma3Downloaded() {
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle("gemma2b.bin");
    const file = await fileHandle.getFile();
    return file.size > 10_000_000; // must be at least 10MB to be valid
  } catch {
    return false;
  }
}

/** Download the model file with progress reporting and save directly to OPFS */
export async function downloadGemma3Model(modelUrl, onProgress) {
  const url = modelUrl || DEFAULT_MODEL_URL;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download model: ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle("gemma2b.bin", { create: true });
  const writable = await fileHandle.createWritable();

  const reader = response.body.getReader();
  let loadedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      loadedBytes += value.length;
      if (totalBytes && onProgress) {
        onProgress(loadedBytes / totalBytes);
      }
    }
  } finally {
    await writable.close();
  }
  
  // Clear any existing inference instance to force reload with the new model
  if (activeInferenceInstance) {
    activeInferenceInstance.close();
    activeInferenceInstance = null;
  }
  return true;
}

/** Delete the downloaded model file from OPFS */
export async function deleteGemma3Model() {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry("gemma2b.bin");
  } catch {}
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
  const fileHandle = await root.getFileHandle("gemma2b.bin");
  const file = await fileHandle.getFile();
  if (!file || file.size < 10_000_000) {
    throw new Error('Gemma model is not downloaded. Please download it in Settings.');
  }

  const modelUrl = URL.createObjectURL(file);
  
  try {
    const genai = await FilesetResolver.forGenAiTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.14/wasm'
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
  const prompt = {
    text: 'You are a LEGO product-identification expert. Identify the LEGO set in this image. Look for any visible set numbers (usually 5 digits, e.g., 75192 or 10300) or distinctive box art/mini-figure details. Return ONLY raw JSON in this format: { "set_num": "...", "name": "...", "confidence": "high|medium|low|none", "reasoning": "..." }',
    images: [imageElement]
  };

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
