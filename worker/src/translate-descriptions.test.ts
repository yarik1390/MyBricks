/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { runTranslateDescriptions, translateBatchOpen, TRANSLATE_BATCH_UNTIL } from './jobs/translate-descriptions';
import { acceptableTranslation, hashSource, getCachedDescription } from './lib/describe-i18n';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
const EN = 'Build the iconic starship with opening hangar doors, 4 minifigures and a display stand. Measures over 30 cm long.';
const NOW = Date.parse('2026-11-26T12:00:00Z');

function fakeAi(reply: (prompt: string) => string | Error) {
  const calls: string[] = [];
  return {
    calls,
    run: async (_model: string, input: any) => {
      const prompt = input.messages[0].content as string;
      calls.push(prompt);
      const r = reply(prompt);
      if (r instanceof Error) throw r;
      return { choices: [{ message: { content: r } }] };
    },
  };
}

const langOf = (prompt: string) => /into ([A-Za-z ]+)\./.exec(prompt)![1];

describe('translate-descriptions batch', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'user_collection', 'set_description_i18n']);
    for (const [n, d] of [['10001-1', EN], ['10002-1', `${EN} Second.`], ['10003-1', '']]) {
      await db.prepare('INSERT INTO lego_sets (set_num, name, year, brickset_description) VALUES (?, ?, 2025, ?)').bind(n, n, d).run();
    }
  });

  it('fills all eight languages with the hash the set page checks', async () => {
    const ai = fakeAi((p) => `[${langOf(p)}] ${EN}`);
    const res = await runTranslateDescriptions({ ...(env as any), AI: ai }, { now: NOW });
    expect(res).toMatchObject({ sets: 2, translated: 16, rejected: 0, failed: 0, remainingSets: 0 });
    // The set with an empty description is never sent.
    expect(ai.calls.length).toBe(16);
    const cached = await getCachedDescription(env as any, '10001-1', 'ja', hashSource(EN));
    expect(cached).toBe(`[Japanese] ${EN}`);

    // Nothing left: a second run makes no calls.
    const again = await runTranslateDescriptions({ ...(env as any), AI: ai }, { now: NOW });
    expect(again).toMatchObject({ sets: 0, translated: 0 });
    expect(ai.calls.length).toBe(16);
  });

  it('skips echoes and errors, leaving them for a later run', async () => {
    const ai = fakeAi((p) => (langOf(p) === 'German' ? p.split('\n\n').pop()! : langOf(p) === 'Hindi' ? new Error('busy') : `ok ${EN}`));
    const res = await runTranslateDescriptions({ ...(env as any), AI: ai }, { now: NOW });
    // A few refused replies don't mark the run failed; they are retried later.
    expect(res).toMatchObject({ translated: 12, rejected: 4, failed: 0, remainingSets: 2 });
    const de = await db.prepare(`SELECT count(*) n FROM set_description_i18n WHERE lang = 'de'`).first<{ n: number }>();
    expect(de!.n).toBe(0);
  });

  it('marks the run failed only when nothing got through', async () => {
    const ai = fakeAi(() => new Error('down'));
    const res = await runTranslateDescriptions({ ...(env as any), AI: ai }, { now: NOW });
    // Stops after a dozen errors instead of spending the batch, and says why.
    expect(res).toMatchObject({ translated: 0, reason: 'down' });
    const r = res as { rejected: number; failed: number };
    expect(r.rejected).toBeGreaterThanOrEqual(12);
    expect(r.failed).toBe(r.rejected);
  });

  it('does nothing after the credit window closes', async () => {
    const ai = fakeAi(() => `x ${EN}`);
    expect(translateBatchOpen(TRANSLATE_BATCH_UNTIL)).toBe(false);
    expect(await runTranslateDescriptions({ ...(env as any), AI: ai }, { now: TRANSLATE_BATCH_UNTIL + 1 }))
      .toEqual({ skipped: 'past the Workers AI credit window' });
    expect(ai.calls.length).toBe(0);
  });

  it('refuses replies that are far off the source length', () => {
    expect(acceptableTranslation(EN, 'Hallo', 'de')).toBe(false);
    expect(acceptableTranslation(EN, '建造标志性星舰，带有可开启的机库门、4个人仔和展示架。长度超过30厘米。', 'zh')).toBe(true);
    expect(acceptableTranslation(EN, EN.repeat(4), 'fr')).toBe(false);
  });
});
