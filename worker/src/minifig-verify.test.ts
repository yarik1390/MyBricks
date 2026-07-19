/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runMinifigVerify } from './jobs/minifig-verify';
import { fetchMinifigPricing } from './lib/bricklink';
import { applyTestTables } from './test-schema';

vi.mock('./lib/bricklink', () => ({ fetchMinifigPricing: vi.fn() }));
const mockPricing = vi.mocked(fetchMinifigPricing);

const db = (env as any).DB as D1Database;

describe('runMinifigVerify (price-agreement identity queue)', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['minifigs', 'user_minifigs', 'minifig_bl_candidates', 'api_quota']);
    mockPricing.mockReset();
  });

  const seedFig = (figNum: string, value: number | null) =>
    db.prepare(`INSERT INTO minifigs (fig_num, name, current_value) VALUES (?, ?, ?)`).bind(figNum, figNum, value);
  const seedCandidate = (figNum: string, blId: string) =>
    db.prepare(`INSERT INTO minifig_bl_candidates (fig_num, bl_id) VALUES (?, ?)`).bind(figNum, blId);

  it('verifies the single price-agreeing candidate and stamps minifigs.bl_id', async () => {
    await db.batch([
      seedFig('fig-1', 100),
      seedCandidate('fig-1', 'sw001a'), // agrees (110)
      seedCandidate('fig-1', 'sw001b'), // disagrees (900 = 9x)
    ]);
    mockPricing.mockImplementation(async (blId: string) =>
      blId === 'sw001a' ? ({ value: 110, lots: 8 } as any) : ({ value: 900, lots: 3 } as any));

    const r = await runMinifigVerify(env as any);

    expect(r.verified).toBe(1);
    const fig = await db.prepare(`SELECT bl_id FROM minifigs WHERE fig_num='fig-1'`).first<{ bl_id: string | null }>();
    expect(fig!.bl_id).toBe('sw001a');
    const rows = await db.prepare(`SELECT bl_id, status FROM minifig_bl_candidates WHERE fig_num='fig-1' ORDER BY bl_id`).all<{ bl_id: string; status: string }>();
    expect(rows.results.map((x) => `${x.bl_id}:${x.status}`)).toEqual(['sw001a:verified', 'sw001b:rejected']);
  });

  it('no prior value: verifies the only candidate with market presence', async () => {
    await db.batch([
      seedFig('fig-2', null),
      seedCandidate('fig-2', 'cty100a'),
      seedCandidate('fig-2', 'cty100b'),
    ]);
    mockPricing.mockImplementation(async (blId: string) =>
      blId === 'cty100a' ? ({ value: 12, lots: 5 } as any) : ({ value: null, lots: 0 } as any));

    const r = await runMinifigVerify(env as any);
    expect(r.verified).toBe(1);
    const fig = await db.prepare(`SELECT bl_id FROM minifigs WHERE fig_num='fig-2'`).first<{ bl_id: string | null }>();
    expect(fig!.bl_id).toBe('cty100a');
  });

  it('ambiguity that price cannot settle stays pending, checked_at stamped', async () => {
    await db.batch([
      seedFig('fig-3', 50),
      seedCandidate('fig-3', 'a'),
      seedCandidate('fig-3', 'b'),
    ]);
    mockPricing.mockResolvedValue({ value: 55, lots: 4 } as any); // BOTH agree

    const r = await runMinifigVerify(env as any);
    expect(r.verified).toBe(0);
    const rows = await db.prepare(`SELECT status, checked_at FROM minifig_bl_candidates WHERE fig_num='fig-3'`).all<{ status: string; checked_at: string | null }>();
    expect(rows.results.every((x) => x.status === 'pending' && x.checked_at)).toBe(true);
    const fig = await db.prepare(`SELECT bl_id FROM minifigs WHERE fig_num='fig-3'`).first<{ bl_id: string | null }>();
    expect(fig!.bl_id).toBeNull();
  });
});
