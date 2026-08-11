/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  configuredKeys,
  hashKey,
  pickKey,
  recordKeyCall,
  getKeyPoolStatus,
  isBrightDataExhaustion,
} from './lib/brightdata-keys';

const db = (env as any).DB as D1Database;

async function freshSchema() {
  await db.prepare('DROP TABLE IF EXISTS brightdata_keys').run();
  await db.prepare(`CREATE TABLE brightdata_keys (
    key_hash TEXT PRIMARY KEY,
    used INTEGER NOT NULL DEFAULT 0,
    cap INTEGER NOT NULL DEFAULT 5000,
    period_month TEXT,
    exhausted_at TEXT,
    last_used_at TEXT,
    updated_at TEXT
  )`).run();
}

function withKeys(keys: string[]): any {
  return { ...env, BRIGHTDATA_API_TOKENS: keys.join(','), BRIGHTDATA_API_TOKEN: undefined };
}

describe('bright data key pool', () => {
  beforeEach(freshSchema);

  it('parses and de-duplicates configured tokens', () => {
    const e: any = { BRIGHTDATA_API_TOKEN: 'a', BRIGHTDATA_API_TOKENS: 'b, a , c,' };
    expect(configuredKeys(e)).toEqual(['a', 'b', 'c']);
  });

  it('returns null when no tokens are configured', async () => {
    expect(await pickKey({ ...env, BRIGHTDATA_API_TOKEN: undefined, BRIGHTDATA_API_TOKENS: undefined } as any)).toBeNull();
  });

  it('rotates to the token with the most remaining budget', async () => {
    const e = withKeys(['k1', 'k2']);
    const first = await pickKey(e);
    expect(first).not.toBeNull();
    await recordKeyCall(e, first!);
    const second = await pickKey(e);
    expect(second!.key).not.toBe(first!.key);
  });

  it('marks a token exhausted on a 403 and stops picking it', async () => {
    const e = withKeys(['only']);
    const picked = await pickKey(e);
    await recordKeyCall(e, picked!, { exhausted: true });
    expect(await pickKey(e)).toBeNull();

    const status = await getKeyPoolStatus(e);
    expect(status.keys_configured).toBe(1);
    expect(status.keys_live).toBe(0);
    expect(status.entries[0].exhausted).toBe(true);
  });

  it('drains a token at the 4900 safety-margin cap even if the stored row cap is higher', async () => {
    const e = withKeys(['cap-test']);
    const hash = await hashKey('cap-test');
    // Stored cap is 5000, but the code enforces DEFAULT_KEY_CAP (4900), so a key
    // at 4900 used is already exhausted — the hard margin against concurrency overshoot.
    await db.prepare(
      `INSERT INTO brightdata_keys (key_hash, used, cap, period_month) VALUES (?1, 4900, 5000, ?2)`,
    ).bind(hash, new Date().toISOString().slice(0, 7)).run();
    expect(await pickKey(e)).toBeNull();
    const status = await getKeyPoolStatus(e);
    expect(status.pooled_remaining).toBe(0);
    expect(status.entries[0].cap).toBe(4900);
    expect(status.entries[0].exhausted).toBe(true);
  });

  it('reports a pooled remaining budget across multiple tokens', async () => {
    const e = withKeys(['p1', 'p2', 'p3']);
    const status = await getKeyPoolStatus(e);
    expect(status.keys_configured).toBe(3);
    expect(status.pooled_remaining).toBe(14700); // 3 × 4900 cap (safety margin under the 5000 free tier)
  });
});

describe('isBrightDataExhaustion', () => {
  it('treats the auth/payment statuses as a drained key', () => {
    expect(isBrightDataExhaustion(401, '')).toBe(true);
    expect(isBrightDataExhaustion(402, '')).toBe(true);
    expect(isBrightDataExhaustion(403, '')).toBe(true);
  });

  it('catches the HTTP 400 "Customer is not active" a drained account returns', () => {
    // The whole point. pickKey drains IN ORDER, so a spent key that is never
    // latched sits at the head of the pool and is handed out on every call —
    // the other tokens never get a turn however much budget they have left.
    expect(isBrightDataExhaustion(400, 'Customer is not active')).toBe(true);
  });

  it('matches the other ways a drained account phrases it', () => {
    expect(isBrightDataExhaustion(400, '{"error":"Not enough credits"}')).toBe(true);
    expect(isBrightDataExhaustion(400, 'insufficient balance')).toBe(true);
    expect(isBrightDataExhaustion(400, 'quota exceeded')).toBe(true);
  });

  it('does NOT retire a healthy key on an ordinary 400', () => {
    // A malformed request is also a 400. Latching on the status alone would
    // retire good tokens for our own bugs — worse than the problem being fixed.
    expect(isBrightDataExhaustion(400, 'Invalid input format')).toBe(false);
    expect(isBrightDataExhaustion(400, 'bad zone name')).toBe(false);
  });

  it('does NOT treat a target-side or server failure as a drained key', () => {
    expect(isBrightDataExhaustion(500, 'upstream exploded')).toBe(false);
    expect(isBrightDataExhaustion(502, 'target refused')).toBe(false);
    expect(isBrightDataExhaustion(429, 'slow down')).toBe(false);
  });
});
