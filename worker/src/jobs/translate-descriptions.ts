import type { Env } from '../types';
import {
  TRANSLATABLE_LANGS, hashSource, translateDescriptionWorkersAi, isPlaceholderDescription,
} from '../lib/describe-i18n';

/**
 * One-off batch: pre-translate every Brickset set description into the eight
 * app languages on Workers AI, so set pages open translated instead of waiting
 * for an on-view Gemini call (lib/describe-i18n.ts).
 *
 * Why now: Cloudflare startup credits cover Workers AI only until 1 Dec 2026
 * (welcome email, 2026-11-25). After TRANSLATE_BATCH_UNTIL the dispatcher stops
 * calling this job, so nothing is ever billed to the card. Whatever is left is
 * still translated on view, as before.
 *
 * Rows land in set_description_i18n with the same source_hash the on-view path
 * checks, so the set page serves them with no other change.
 */
export const TRANSLATE_BATCH_UNTIL = Date.parse('2026-11-30T22:00:00Z');

export function translateBatchOpen(now = Date.now()): boolean {
  return now < TRANSLATE_BATCH_UNTIL;
}

interface Options {
  /** Sets picked per run (each needs up to 8 calls). */
  limit?: number;
  /** Parallel Workers AI calls. */
  concurrency?: number;
  /** Stop starting new calls after this long; in-flight calls finish. */
  budgetMs?: number;
  now?: number;
}

export interface TranslateBatchResult {
  sets: number;
  translated: number;
  /** Replies refused (echo, wrong length) or errored; retried by a later run. */
  rejected: number;
  /** Non-zero only when nothing at all got through (Workers AI down), so the
   *  admin console doesn't flag every run for a few refused replies. */
  failed: number;
  remainingSets: number;
  stoppedEarly: boolean;
  /** First failure message, shown in the admin console when every item fails. */
  reason?: string;
}

export async function runTranslateDescriptions(env: Env, opts: Options = {}): Promise<TranslateBatchResult | { skipped: string }> {
  const now = opts.now ?? Date.now();
  if (!translateBatchOpen(now)) return { skipped: 'past the Workers AI credit window' };
  if (!env.AI) return { skipped: 'no AI binding' };
  const limit = opts.limit ?? 40;
  const concurrency = opts.concurrency ?? 10;
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? 200_000);
  const stillOpen = () => translateBatchOpen(now + (Date.now() - started));
  const langCount = TRANSLATABLE_LANGS.length;

  // Sets that still miss at least one language. Owned sets first (what users
  // open), then a random slice, so a set whose translation keeps failing can't
  // hold the batch on the same 40 sets every run.
  const { results: sets } = await env.DB.prepare(
    `SELECT s.set_num, s.brickset_description AS description,
            (SELECT group_concat(t.lang) FROM set_description_i18n t WHERE t.set_num = s.set_num) AS done
       FROM lego_sets s
      WHERE s.brickset_description IS NOT NULL AND length(trim(s.brickset_description)) >= 20
        AND (SELECT count(*) FROM set_description_i18n t WHERE t.set_num = s.set_num) < ?1
      ORDER BY EXISTS (SELECT 1 FROM user_collection c WHERE c.set_num = s.set_num AND c.deleted_at IS NULL) DESC,
               random()
      LIMIT ?2`,
  ).bind(langCount, limit).all<{ set_num: string; description: string; done: string | null }>();

  const tasks: { setNum: string; english: string; lang: string; hash: string }[] = [];
  for (const s of sets) {
    if (isPlaceholderDescription(s.description)) continue; // "N/A" etc.: nothing to translate
    const done = new Set((s.done || '').split(',').filter(Boolean));
    const hash = hashSource(s.description);
    for (const lang of TRANSLATABLE_LANGS) {
      if (!done.has(lang)) tasks.push({ setNum: s.set_num, english: s.description, lang, hash });
    }
  }

  let translated = 0;
  let rejected = 0;
  let next = 0;
  let stoppedEarly = false;
  let reason: string | undefined;
  let thrown = 0;
  const worker = async () => {
    while (next < tasks.length) {
      if (Date.now() > deadline || !stillOpen()) { stoppedEarly = true; return; }
      // Workers AI itself is refusing (quota, outage, retired model): stop
      // after a handful instead of spending the whole batch on errors.
      if (translated === 0 && thrown >= 12) { stoppedEarly = true; return; }
      const t = tasks[next++];
      const out = await translateDescriptionWorkersAi(env, t.english, t.lang, {
        onFail: (r, threw) => { reason ??= r; if (threw) thrown++; },
      });
      if (!out) { rejected++; continue; }
      await env.DB.prepare(
        `INSERT INTO set_description_i18n (set_num, lang, description, source_hash)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(set_num, lang) DO NOTHING`,
      ).bind(t.setNum, t.lang, out, t.hash).run();
      translated++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));

  const left = await env.DB.prepare(
    `SELECT count(*) AS n FROM lego_sets s
      WHERE s.brickset_description IS NOT NULL AND length(trim(s.brickset_description)) >= 20
        AND (SELECT count(*) FROM set_description_i18n t WHERE t.set_num = s.set_num) < ?`,
  ).bind(langCount).first<{ n: number }>();

  const failed = translated === 0 ? rejected : 0;
  return { sets: sets.length, translated, rejected, failed, remainingSets: left?.n ?? 0, stoppedEarly, ...(failed && reason ? { reason } : {}) };
}
