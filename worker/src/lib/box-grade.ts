import OpenAI from 'openai';
import type { Env } from '../types';
import { MODELS, geminiUrl, openAIServerBaseURL, gatewayHeaders } from './llm';
import { recordIntegrationAttempt } from './integration-health';

// Box condition grading from a photo (routes/grade.ts). One vision call returns
// a grade on a five-step scale plus what drove it; the screen shows the usual
// price of a box in that condition relative to a mint one.

export const BOX_GRADES = ['mint', 'near_mint', 'good', 'fair', 'poor'] as const;
export type BoxGrade = typeof BOX_GRADES[number];

/** Rough share of a mint sealed box's price that a box in each grade fetches. */
export const GRADE_PRICE_SHARE: Record<BoxGrade, number> = {
  mint: 1, near_mint: 0.95, good: 0.85, fair: 0.7, poor: 0.55,
};

export interface BoxGradeResult {
  grade: BoxGrade | null;
  is_box: boolean;
  seal_intact: boolean | null;
  issues: string[];
  summary: string;
}

export function boxGradePrompt(setLabel: string): string {
  return `You grade the condition of LEGO set boxes for collectors. The photo should show the box of ${setLabel}.
Return JSON only: {"is_box": boolean, "grade": "mint"|"near_mint"|"good"|"fair"|"poor"|null, "seal_intact": boolean|null, "issues": string[], "summary": string}.
Scale: mint = no visible flaws; near_mint = one or two tiny marks or corner rubs; good = small dents, creases or shelf wear; fair = clear dents, crushed corners, fading or tears; poor = heavy damage, water damage or large tears.
issues: up to 5 short phrases naming what you see (e.g. "small dent on top left corner"). seal_intact: true if the factory seals or tape are visibly unbroken, false if cut or missing, null if not visible.
summary: one plain sentence. If the photo is not a LEGO box, set is_box to false and grade to null. Judge only what is visible; do not guess hidden sides.`;
}

/** Validate a model reply; null when it isn't usable. */
export function parseBoxGrade(text: string | null | undefined): BoxGradeResult | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1').trim()) as Record<string, unknown>;
    const isBox = raw.is_box !== false;
    const grade = BOX_GRADES.includes(raw.grade as BoxGrade) ? raw.grade as BoxGrade : null;
    if (isBox && !grade) return null;
    const issues = Array.isArray(raw.issues)
      ? raw.issues.filter((i): i is string => typeof i === 'string' && !!i.trim()).slice(0, 5).map((i) => i.trim().slice(0, 120))
      : [];
    return {
      grade: isBox ? grade : null,
      is_box: isBox,
      seal_intact: typeof raw.seal_intact === 'boolean' ? raw.seal_intact : null,
      issues,
      summary: typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 300) : '',
    };
  } catch { return null; }
}

function splitDataUrl(image: string): { mime: string; data: string } {
  const m = image.match(/^data:([^;]+);base64,(.*)$/);
  return m ? { mime: m[1], data: m[2] } : { mime: 'image/jpeg', data: image };
}

async function viaGemini(env: Env, key: string, image: string, prompt: string, server: boolean): Promise<string | null> {
  const { mime, data } = splitDataUrl(image);
  const resp = await fetch(geminiUrl(MODELS.scan, { env, routeThroughGateway: server }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, ...(server ? gatewayHeaders(env) : {}) },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data } }] }],
      generationConfig: { maxOutputTokens: 500, temperature: 0, responseMimeType: 'application/json' },
    }),
  });
  if (!resp.ok) throw new Error(`Gemini ${resp.status}`);
  const body = await resp.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

async function viaOpenAI(env: Env, key: string, image: string, prompt: string, server: boolean): Promise<string | null> {
  const openai = new OpenAI({
    apiKey: key,
    baseURL: server ? openAIServerBaseURL(env) : undefined,
    defaultHeaders: server ? gatewayHeaders(env) : undefined,
  });
  const r = await openai.chat.completions.create({
    model: MODELS.openaiFallback,
    max_tokens: 500,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }] }],
  }, { timeout: 20_000 });
  return r.choices[0]?.message?.content ?? null;
}

/**
 * Grade the box in `image` (a data URL). BYOK keys are used directly and only
 * them; otherwise the server Gemini key, then the server OpenAI key.
 */
export async function gradeBox(
  env: Env,
  image: string,
  setLabel: string,
  keys: { gemini?: string | null; openai?: string | null },
): Promise<BoxGradeResult | null> {
  const prompt = boxGradePrompt(setLabel);
  const steps: Array<['gemini' | 'openai', () => Promise<string | null>]> = [];
  if (keys.gemini) steps.push(['gemini', () => viaGemini(env, keys.gemini as string, image, prompt, false)]);
  if (keys.openai) steps.push(['openai', () => viaOpenAI(env, keys.openai as string, image, prompt, false)]);
  if (!steps.length) {
    if (env.GEMINI_API_KEY) steps.push(['gemini', () => viaGemini(env, env.GEMINI_API_KEY as string, image, prompt, true)]);
    if (env.OPENAI_API_KEY) steps.push(['openai', () => viaOpenAI(env, env.OPENAI_API_KEY as string, image, prompt, true)]);
  }
  for (const [provider, run] of steps) {
    try {
      const parsed = parseBoxGrade(await run());
      if (parsed) {
        await recordIntegrationAttempt(env, provider, true).catch(() => {});
        return parsed;
      }
    } catch (e) {
      await recordIntegrationAttempt(env, provider, false, e).catch(() => {});
    }
  }
  return null;
}
