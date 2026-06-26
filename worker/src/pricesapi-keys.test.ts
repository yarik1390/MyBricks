/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  configuredKeys,
  hashKey,
  pickKey,
  recordKeyCall,
  getKeyPoolStatus,
} from './lib/pricesapi-keys';

const db = (env as any).DB as D1Database;

async function freshSchema() {
  await db.prepare('DROP TABLE IF EXISTS pricesapi_keys').run();
  await db.prepare(`CREATE TABLE pricesapi_keys (
    key_hash TEXT PRIMARY KEY,
    used INTEGER NOT NULL DEFAULT 0,
    cap INTEGER NOT NULL DEFAULT 1000,
    period_month TEXT,
    exhausted_at TEXT,
    last_used_at TEXT,
    updated_at TEXT
  )`).run();
}

function withKeys(keys: string[]): any {
  return { ...env, PRICESAPI_API_KEYS: keys.join(','), PRICESAPI_API_KEY: undefined };
}

describe('pricesapi key pool', () => {
  beforeEach(freshSchema);

  it('parses and de-duplicates configured keys', () => {
    const e: any = { PRICESAPI_API_KEY: 'a', PRICESAPI_API_KEYS: 'b, a , c,' };
    expect(configuredKeys(e)).toEqual(['a', 'b', 'c']);
  });

  it('returns null when no keys are configured', async () => {
    expect(await pickKey({ ...env, PRICESAPI_API_KEY: undefined, PRICESAPI_API_KEYS: undefined } as any)).toBeNull();
  });

  it('rotates to the key with the most remaining budget', async () => {
    const e = withKeys(['k1', 'k2']);
    // Spend k1 once; k2 should now be preferred (lower used).
    const first = await pickKey(e);
    expect(first).not.toBeNull();
    await recordKeyCall(e, first!);
    const second = await pickKey(e);
    expect(second!.key).not.toBe(first!.key);
  });

  it('marks a key exhausted on a 403 and stops picking it', async () => {
    const e = withKeys(['only']);
    const picked = await pickKey(e);
    await recordKeyCall(e, picked!, { exhausted: true });
    expect(await pickKey(e)).toBeNull();

    const status = await getKeyPoolStatus(e);
    expect(status.keys_configured).toBe(1);
    expect(status.keys_live).toBe(0);
    expect(status.entries[0].exhausted).toBe(true);
  });

  it('drains a key when used reaches the cap', async () => {
    const e = withKeys(['cap-test']);
    const hash = await hashKey('cap-test');
    await db.prepare(
      `INSERT INTO pricesapi_keys (key_hash, used, cap, period_month) VALUES (?1, 1000, 1000, ?2)`,
    ).bind(hash, new Date().toISOString().slice(0, 7)).run();
    expect(await pickKey(e)).toBeNull();
    const status = await getKeyPoolStatus(e);
    expect(status.pooled_remaining).toBe(0);
  });

  it('resets the budget when the stored period_month is stale', async () => {
    const e = withKeys(['rollover']);
    const hash = await hashKey('rollover');
    // Last month, fully drained + flagged exhausted.
    await db.prepare(
      `INSERT INTO pricesapi_keys (key_hash, used, cap, period_month, exhausted_at)
       VALUES (?1, 1000, 1000, '2000-01', datetime('now'))`,
    ).bind(hash).run();
    const picked = await pickKey(e);
    expect(picked).not.toBeNull(); // stale month => fresh budget
    const status = await getKeyPoolStatus(e);
    expect(status.entries[0].used).toBe(0);
    expect(status.entries[0].exhausted).toBe(false);
  });

  it('reports a pooled remaining budget across multiple keys', async () => {
    const e = withKeys(['p1', 'p2', 'p3']);
    const status = await getKeyPoolStatus(e);
    expect(status.keys_configured).toBe(3);
    expect(status.pooled_remaining).toBe(3000); // 3 × 1000 default cap
  });
});
