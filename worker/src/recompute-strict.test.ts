import { describe, expect, it, vi } from 'vitest';
import { recomputeBlendedValues } from './lib/market-sources';

describe('strict blend recomputation', () => {
  for (const stage of ['catalog', 'history', 'signals', 'headline', 'new-state', 'used-state']) {
    it(`propagates ${stage} failures instead of reporting successful partial work`, async () => {
      let batches = 0;
      const failure = new Error(`${stage} unavailable`);
      const db = {
        prepare: vi.fn((sql: string) => {
          const statement = {
            bind: (..._args: unknown[]) => statement,
            all: async () => {
              if ((stage === 'catalog' && sql.includes('SELECT ls.set_num'))
                || (stage === 'history' && sql.includes('set_value_history'))
                || (stage === 'signals' && sql.includes('FROM pricing_signals'))) throw failure;
              return { results: sql.includes('SELECT ls.set_num') ? [{ set_num: '10001-1', pieces: 100, year: 2020 }] : [] };
            },
            run: async () => ({ meta: { changes: 0 } }),
          };
          return statement;
        }),
        batch: async () => {
          batches++;
          if ((stage === 'headline' && batches === 1) || (stage === 'new-state' && batches === 2)
            || (stage === 'used-state' && batches === 3)) throw failure;
          return [{ meta: { changes: 1 } }];
        },
      } as unknown as D1Database;
      await expect(recomputeBlendedValues(db, ['10001-1'], { strict: true })).rejects.toThrow(failure.message);
    });
  }
  it('preserves the legacy fail-open default', async () => {
    const db = { prepare: () => { throw new Error('database unavailable'); } } as unknown as D1Database;
    await expect(recomputeBlendedValues(db, ['10001-1'])).resolves.toBe(0);
  });
});
