/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  configuredKeys,
  hashKey,
  pickKey,
  recordKeyCall,
  getKeyPoolStatus,
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

  it('drains a token when used reaches the 5000 cap', async () => {
    const e = withKeys(['cap-test']);
    const hash = await hashKey('cap-test');
    await db.prepare(
      `INSERT INTO brightdata_keys (key_hash, used, cap, period_month) VALUES (?1, 5000, 5000, ?2)`,
    ).bind(hash, new Date().toISOString().slice(0, 7)).run();
    expect(await pickKey(e)).toBeNull();
    expect((await getKeyPoolStatus(e)).pooled_remaining).toBe(0);
  });

  it('reports a pooled remaining budget across multiple tokens', async () => {
    const e = withKeys(['p1', 'p2', 'p3']);
    const status = await getKeyPoolStatus(e);
    expect(status.keys_configured).toBe(3);
    expect(status.pooled_remaining).toBe(15000); // 3 × 5000 default cap
  });
});
