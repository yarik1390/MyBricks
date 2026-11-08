/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { AI_TRIAL_DAYS, POST_TRIAL_SCAN_DAILY_LIMIT, aiAccess, hasByok, readAiTrial } from './lib/ai-access';

const db = (env as any).DB as D1Database;

async function setStart(userId: string, daysAgo: number) {
  await db.prepare(`INSERT INTO ai_trials (user_id, started_at) VALUES (?, datetime('now', ?))
    ON CONFLICT(user_id) DO UPDATE SET started_at=excluded.started_at`).bind(userId, `-${daysAgo} days`).run();
}

describe('BYOK-first AI access', () => {
  beforeEach(async () => {
    await db.prepare('DROP TABLE IF EXISTS ai_trials').run();
    await db.prepare('CREATE TABLE ai_trials (user_id TEXT PRIMARY KEY, started_at TEXT NOT NULL)').run();
  });

  it('starts the trial on first AI use and keeps the first start date', async () => {
    expect((await readAiTrial(env as any, 'u1')).started_at).toBeNull();
    const first = await aiAccess(env as any, 'u1', 'advisor', false);
    expect(first.mode).toBe('trial');
    const row = await db.prepare('SELECT started_at FROM ai_trials WHERE user_id=?').bind('u1').first<{ started_at: string }>();
    await aiAccess(env as any, 'u1', 'advisor', false);
    const again = await db.prepare('SELECT started_at FROM ai_trials WHERE user_id=?').bind('u1').first<{ started_at: string }>();
    expect(again?.started_at).toBe(row?.started_at);
    expect((await readAiTrial(env as any, 'u1')).days_left).toBe(AI_TRIAL_DAYS);
  });

  it('after the trial: photo scans go free-only with a small limit, everything else needs a key', async () => {
    await setStart('u2', AI_TRIAL_DAYS + 1);
    expect(await aiAccess(env as any, 'u2', 'scan', false)).toMatchObject({ mode: 'free', dailyLimit: POST_TRIAL_SCAN_DAILY_LIMIT });
    for (const f of ['shelf', 'advisor', 'listing', 'grade'] as const) {
      expect((await aiAccess(env as any, 'u2', f, false)).mode).toBe('blocked');
    }
  });

  it('own key always wins, inside or after the trial', async () => {
    await setStart('u3', AI_TRIAL_DAYS + 30);
    expect((await aiAccess(env as any, 'u3', 'advisor', true)).mode).toBe('byok');
  });

  it('fails open when the trial table is missing', async () => {
    await db.prepare('DROP TABLE ai_trials').run();
    expect((await aiAccess(env as any, 'u4', 'advisor', false)).mode).toBe('trial');
  });

  it('detects BYOK headers and ignores blank ones', () => {
    const h = (o: Record<string, string>) => (n: string) => o[n];
    expect(hasByok(h({ 'X-Gemini-Key': 'AIza' }))).toBe(true);
    expect(hasByok(h({ 'X-OpenAI-Key': ' ' }))).toBe(false);
  });
});
