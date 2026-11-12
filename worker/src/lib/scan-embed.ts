import type { Env } from '../types';

/**
 * Image embeddings for the scan image index (Workers AI multimodal embedding).
 *
 * The same model embeds catalog images (index side) and scan photos (query
 * side), so a photo can be matched to the nearest catalog set by cosine
 * similarity. Non-fatal by design: every failure returns null and the scan
 * falls through to the normal chain.
 */
export const SCAN_EMBED_MODEL = '@cf/qwen/qwen3-vl-embedding-2b';

/** Input shapes the model may accept; the probe endpoint reports which works. */
export type EmbedShape = 'image_b64' | 'image_dataurl' | 'image_bytes' | 'messages' | 'input_image';

export const EMBED_SHAPES: EmbedShape[] = ['image_dataurl', 'image_b64', 'image_bytes', 'messages', 'input_image'];

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function buildEmbedInput(shape: EmbedShape, bytes: Uint8Array, mime: string): unknown {
  const b64 = bytesToBase64(bytes);
  const dataUrl = `data:${mime};base64,${b64}`;
  switch (shape) {
    case 'image_b64': return { image: b64 };
    case 'image_dataurl': return { image: dataUrl };
    case 'image_bytes': return { image: [...bytes] };
    case 'messages': return { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }] }] };
    case 'input_image': return { input: [{ image: dataUrl }] };
  }
}

/** Pull the first embedding vector out of whatever shape the model returns. */
export function extractVector(raw: unknown): number[] | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const cands: unknown[] = [
    (r.data as unknown[] | undefined)?.[0],
    (r.embeddings as unknown[] | undefined)?.[0],
    r.embedding,
    ((r.data as Array<{ embedding?: unknown }> | undefined)?.[0])?.embedding,
    ((r.result as Record<string, unknown> | undefined)?.data as unknown[] | undefined)?.[0],
  ];
  for (const c of cands) {
    if (Array.isArray(c) && c.length > 16 && c.every((x) => typeof x === 'number')) return c as number[];
  }
  return null;
}

export function l2normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

/** Embed one image. Returns a unit-length vector, or null with a reason. */
export async function embedImage(
  env: Env,
  bytes: Uint8Array,
  mime: string,
  opts: { shape?: EmbedShape; model?: string; timeoutMs?: number } = {},
): Promise<{ vector: number[] | null; error?: string; ms: number }> {
  const t0 = Date.now();
  if (!env.AI) return { vector: null, error: 'no AI binding', ms: 0 };
  const model = opts.model || SCAN_EMBED_MODEL;
  if (!/^@cf\//.test(model)) return { vector: null, error: 'only free @cf/ models', ms: 0 };
  const input = buildEmbedInput(opts.shape || 'image_dataurl', bytes, mime);
  const run = (env.AI as unknown as { run: (m: string, i: unknown) => Promise<unknown> }).run(model, input);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      run,
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('embed timeout')), opts.timeoutMs ?? 15_000); }),
    ]);
    const v = extractVector(raw);
    if (!v) return { vector: null, error: `no vector in reply: ${JSON.stringify(raw).slice(0, 200)}`, ms: Date.now() - t0 };
    return { vector: l2normalize(v), ms: Date.now() - t0 };
  } catch (e) {
    return { vector: null, error: String((e as Error)?.message || e).slice(0, 300), ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}
