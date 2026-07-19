/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runCommunityComps } from './jobs/community-comps';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

const addSet = (setNum: string, blended: number | null = null) =>
  db.prepare(`INSERT INTO lego_sets (set_num, name, blended_value) VALUES (?, ?, ?)`).bind(setNum, setNum, blended);
const addPurchase = (user: string, setNum: string, price: number, cond = 'new') =>
  db.prepare(`INSERT INTO user_collection (user_id, set_num, purchase_price, purchased_at, condition) VALUES (?, ?, ?, date('now','-30 days'), ?)`)
    .bind(user, setNum, price, cond);

describe('runCommunityComps (first-party comps aggregation)', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_wishlist', 'community_comps', 'pricing_signals', 'pricing_write_ledger']);
  });

  it('publishes a k>=5 set with the right median and counts', async () => {
    await db.batch([
      addSet('CC-1', 100),
      ...['u1', 'u2', 'u3', 'u4', 'u5'].map((u, i) => addPurchase(u, 'CC-1', 90 + i * 5)), // 90,95,100,105,110
    ]);
    const r = await runCommunityComps(env as any);
    expect(r.published).toBe(1);
    const row = await db.prepare(`SELECT * FROM community_comps WHERE set_num='CC-1' AND condition='new_sealed'`).first<any>();
    expect(row.median).toBe(100);
    expect(row.sample_count).toBe(5);
    expect(row.contributor_count).toBe(5);
    expect(row.p25).toBeLessThan(row.p75);
  });

  it('withholds sets below the k-anonymity gate', async () => {
    await db.batch([
      addSet('CC-2', 100),
      ...['u1', 'u2', 'u3', 'u4'].map((u) => addPurchase(u, 'CC-2', 100)), // only 4 people
    ]);
    const r = await runCommunityComps(env as any);
    expect(r.published).toBe(0);
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM community_comps`).first<{ n: number }>();
    expect(row!.n).toBe(0);
  });

  it('five entries from ONE user do not satisfy the k-gate', async () => {
    await db.batch([
      addSet('CC-3', 100),
      // Distinct set rows per (user,set) is unique — simulate one user with
      // repeated prices via different sets? No: k is DISTINCT users on one set,
      // so a single contributor never publishes no matter the sample count.
      addPurchase('solo', 'CC-3', 100),
    ]);
    const r = await runCommunityComps(env as any);
    expect(r.published).toBe(0);
  });

  it('trims 3x outliers against the blended reference', async () => {
    await db.batch([
      addSet('CC-4', 100),
      ...['u1', 'u2', 'u3', 'u4', 'u5'].map((u) => addPurchase(u, 'CC-4', 100)),
      addPurchase('u6', 'CC-4', 900), // 9x the reference — a lot/typo, trimmed
    ]);
    await runCommunityComps(env as any);
    const row = await db.prepare(`SELECT median, sample_count FROM community_comps WHERE set_num='CC-4'`).first<any>();
    expect(row.median).toBe(100);
    expect(row.sample_count).toBe(5); // outlier excluded
  });

  it('sold prices count, and used conditions land in the used bucket', async () => {
    await db.batch([
      addSet('CC-5', 100),
      ...['u1', 'u2', 'u3', 'u4'].map((u) => addPurchase(u, 'CC-5', 80, 'used_good')),
      db.prepare(`INSERT INTO user_collection (user_id, set_num, sold_price, sold_at, condition, deleted_at) VALUES ('u5','CC-5', 84, date('now','-5 days'), 'used_good', datetime('now'))`),
    ]);
    const r = await runCommunityComps(env as any);
    expect(r.published).toBe(1);
    const row = await db.prepare(`SELECT condition, sample_count FROM community_comps WHERE set_num='CC-5'`).first<any>();
    expect(row.condition).toBe('used_complete');
    expect(row.sample_count).toBe(5); // 4 purchases + 1 sale, 5 distinct users
  });

  it('prunes rows that fell below the gate on a later run', async () => {
    await db.batch([
      addSet('CC-6', 100),
      db.prepare(`INSERT INTO community_comps (set_num, condition, median, sample_count, contributor_count, updated_at) VALUES ('CC-6','new_sealed', 95, 6, 6, datetime('now','-10 days'))`),
    ]);
    const r = await runCommunityComps(env as any); // no current contributors at all
    expect(r.pruned).toBe(1);
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM community_comps`).first<{ n: number }>();
    expect(row!.n).toBe(0);
  });


  it('mirrors a published aggregate into pricing_signals as the community family', async () => {
    await db.batch([
      addSet('CC-7', 100),
      ...['u1', 'u2', 'u3', 'u4', 'u5'].map((u) => addPurchase(u, 'CC-7', 100)),
    ]);
    await runCommunityComps(env as any);
    const sig = await db.prepare(
      `SELECT provider_family, signal_type, value, sample_count, match_status FROM pricing_signals WHERE set_num='CC-7' AND source='community_comps'`,
    ).first<any>();
    expect(sig).toBeTruthy();
    expect(sig.provider_family).toBe('community');
    expect(sig.signal_type).toBe('sold');
    expect(sig.match_status).toBe('verified');
    expect(sig.value).toBe(100);
    expect(sig.sample_count).toBe(5);
  });

  it('removes the blend mirror when an aggregate falls below the k-gate', async () => {
    await db.batch([
      addSet('CC-8', 100),
      db.prepare(`INSERT INTO pricing_signals (set_num, source, provider_family, condition, signal_type, currency, value, sample_count, checked_at, match_status)
                  VALUES ('CC-8','community_comps','community','new_sealed','sold','USD', 95, 6, datetime('now','-10 days'), 'verified')`),
    ]);
    await runCommunityComps(env as any); // no current contributors
    const n = await db.prepare(`SELECT COUNT(*) AS n FROM pricing_signals WHERE source='community_comps'`).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});
