/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { runEmbedSets } from './jobs/embed-sets';
import { setEmbeddingText, wantsSimilarSets } from './lib/set-embeddings';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

function fakes() {
  const embedded: string[][] = [];
  const upserted: string[] = [];
  return {
    embedded, upserted,
    env: {
      ...(env as any),
      AI: { run: async (_m: string, input: any) => { embedded.push(input.text); return { data: input.text.map(() => Array(1024).fill(0.1)) }; } },
      SETS_INDEX: { upsert: async (v: { id: string }[]) => { upserted.push(...v.map(x => x.id)); return { count: v.length }; } },
    },
  };
}

describe('embed-sets', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'set_embeddings']);
    for (let i = 0; i < 7; i++) {
      await db.prepare('INSERT INTO lego_sets (set_num, name, theme, year, pieces) VALUES (?, ?, ?, 2024, 100)')
        .bind(`E${i}-1`, `Set ${i}`, 'City').run();
    }
  });

  it('embeds every set once, in batches, and records progress', async () => {
    const f = fakes();
    expect(await runEmbedSets(f.env, { batch: 3 })).toMatchObject({ picked: 7, embedded: 7, failedBatches: 0 });
    expect(f.embedded.map(b => b.length)).toEqual([3, 3, 1]);
    expect(f.upserted.sort()).toEqual(['E0-1', 'E1-1', 'E2-1', 'E3-1', 'E4-1', 'E5-1', 'E6-1']);
    const n = await db.prepare('SELECT count(*) n FROM set_embeddings').first<{ n: number }>();
    expect(n!.n).toBe(7);

    // Caught up: nothing is embedded again.
    const g = fakes();
    expect(await runEmbedSets(g.env)).toMatchObject({ picked: 0, embedded: 0 });
    expect(g.embedded).toEqual([]);
  });

  it('re-embeds a month-old entry only if its text changed', async () => {
    await runEmbedSets(fakes().env);
    await db.prepare(`UPDATE set_embeddings SET embedded_at = datetime('now', '-40 days')`).run();
    await db.prepare(`UPDATE lego_sets SET name = 'Renamed' WHERE set_num = 'E3-1'`).run();
    const f = fakes();
    expect(await runEmbedSets(f.env)).toMatchObject({ picked: 7, embedded: 1, unchanged: 6 });
    expect(f.upserted).toEqual(['E3-1']);
  });

  it('skips cleanly without the index binding', async () => {
    expect(await runEmbedSets({ ...(env as any), SETS_INDEX: undefined })).toEqual({ skipped: 'no AI binding or SETS_INDEX' });
  });

  it('builds the text from name, theme, year, size and description', () => {
    expect(setEmbeddingText({ set_num: 'x', name: 'Barracuda Bay', theme: 'Ideas', subtheme: 'Pirates', year: 2020, pieces: 2545, brickset_description: '  A  pirate island.  ' }))
      .toBe('Barracuda Bay. Theme: Ideas / Pirates. 2020. 2545 pieces. A pirate island.');
  });

  it('asks for smart matches only for descriptive queries that came up short', () => {
    expect(wantsSimilarSets('10497', 0, 24)).toBe(false);
    expect(wantsSimilarSets('75192-1', 0, 24)).toBe(false);
    expect(wantsSimilarSets('ufo', 0, 24)).toBe(true);
    expect(wantsSimilarSets('pirate ship with shark', 2, 24)).toBe(true);
    expect(wantsSimilarSets('millennium falcon', 20, 24)).toBe(false);
    expect(wantsSimilarSets('falcon', 3, 24)).toBe(false);
  });
});
