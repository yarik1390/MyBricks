import type { Env } from '../types';
import { fetchTracked } from './http';
import { MODELS, geminiUrl, gatewayHeaders } from './llm';

/**
 * Translate a set's marketing description on demand, and cache it forever.
 *
 * Descriptions are CATALOG DATA, not UI copy — a unique ~1,400-character
 * paragraph per set, 9,681 sets, 13.3M characters in total. Bulk pre-translation
 * into the eight supported languages would be ~106M characters of model output
 * for text that most sets will never have read, so nothing is translated until
 * someone actually opens that set in that language. A description only changes
 * if Brickset rewrites it, which source_hash detects.
 *
 * Failure is always silent: the caller falls back to the English text. A missing
 * translation is a cosmetic gap; a broken set page is not.
 */

// Matches public/js/lib/i18n.js SUPPORTED, minus English (the source).
const LANGS: Record<string, string> = {
  de: 'German', fr: 'French', es: 'Spanish', nl: 'Dutch',
  uk: 'Ukrainian', zh: 'Simplified Chinese', hi: 'Hindi', ja: 'Japanese',
};

export function isTranslatableLang(lang: string | undefined | null): boolean {
  return !!lang && Object.hasOwn(LANGS, lang);
}

/** Cheap, stable fingerprint so a rewritten source description re-translates. */
function hashSource(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

export async function getCachedDescription(
  env: Env, setNum: string, lang: string, sourceHash: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT description, source_hash FROM set_description_i18n WHERE set_num = ? AND lang = ?`,
  ).bind(setNum, lang).first<{ description: string; source_hash: string | null }>();
  if (!row) return null;
  // A changed source invalidates the cache rather than serving a stale paragraph.
  if (row.source_hash && row.source_hash !== sourceHash) return null;
  return row.description;
}

export async function translateDescription(
  env: Env, setNum: string, english: string, lang: string, apiKey: string,
  opts: { routeThroughGateway?: boolean } = {},
): Promise<string | null> {
  const language = LANGS[lang];
  if (!language || !english.trim()) return null;
  // Guard against a pathological source blowing up the request; descriptions
  // this long are truncated in the UI anyway.
  const source = english.length > 4000 ? `${english.slice(0, 4000)}…` : english;

  const body = {
    contents: [{
      parts: [{
        text: `Translate the following LEGO set description into ${language}.\n\n`
          + `Rules:\n`
          + `- Return ONLY the translation. No preamble, no quotes, no notes.\n`
          + `- Keep LEGO, set names, theme names and trademarks in their original form.\n`
          + `- Keep numbers, measurements and set numbers exactly as written.\n`
          + `- Preserve paragraph breaks. Plain text only — no HTML, no markdown.\n\n`
          + source,
      }],
    }],
    generationConfig: { temperature: 0.2 },
  };

  try {
    const resp = await fetchTracked(env, 'gemini',
      geminiUrl(MODELS.listing, { env, routeThroughGateway: opts.routeThroughGateway }),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          ...(opts.routeThroughGateway ? gatewayHeaders(env) : {}),
        },
        body: JSON.stringify(body),
      },
      { timeoutMs: 20000, retries: 1 },
    );
    if (!resp.ok) {
      console.warn('[describe-i18n] API error:', resp.status);
      return null;
    }
    const data = await resp.json<any>();
    const out = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    // A model that echoes the source has not translated anything; caching that
    // would permanently pin the English text for this language.
    if (!out || out === english.trim()) return null;
    return out;
  } catch (e) {
    console.warn('[describe-i18n] failed:', (e as Error)?.message);
    return null;
  }
}

export async function cacheDescription(
  env: Env, setNum: string, lang: string, description: string, sourceHash: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO set_description_i18n (set_num, lang, description, source_hash)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(set_num, lang) DO UPDATE SET description = excluded.description,
       source_hash = excluded.source_hash, created_at = CURRENT_TIMESTAMP`,
  ).bind(setNum, lang, description, sourceHash).run();
}

export { hashSource };
