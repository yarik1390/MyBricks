import { describe, expect, it } from 'vitest';
import { adviseJob, serviceFor } from './lib/job-advice';

const failing = (name: string, error: string, extra: Record<string, unknown> = {}) =>
  adviseJob({ name, health: 'failing', error, consecutive_failures: 1, recent_errors: [error], ...extra });

describe('adviseJob', () => {
  it('says a SQL/code error needs a code fix and that Run now will not help (Nov 13 PriceCharting case)', () => {
    const a = failing('pricecharting-bulk-fetch', 'D1_ERROR: too many columns in result set: SQLITE_ERROR');
    expect(a).toMatchObject({ kind: 'code', retryHelps: false, service: 'pricecharting' });
  });

  it('names the secret to replace on a refused key', () => {
    const a = failing('valuate-ebay-ask', 'HTTP 401 Unauthorized');
    expect(a?.kind).toBe('key');
    expect(a?.title).toContain('eBay');
    expect(a?.steps.join(' ')).toContain('EBAY_APP_ID');
    expect(a?.steps.join(' ')).toContain('push_secrets');
  });

  it('asks for a top-up when credits ran out', () => {
    expect(failing('store-offers', 'Firecrawl HTTP 402: Insufficient credits')).toMatchObject({ kind: 'topup', service: 'firecrawl' });
  });

  it('says wait for a rate limit or daily cap', () => {
    expect(failing('pricecharting-enrich', 'HTTP 429 Too Many Requests').kind).toBe('quota');
  });

  it('treats a provider outage as wait, and escalates after a long streak', () => {
    expect(failing('valuate-minifigs', 'Provider offline (BrickLink maintenance)')).toMatchObject({ kind: 'wait', retryHelps: true });
    expect(failing('valuate-minifigs', 'HTTP 503', { consecutive_failures: 4 })).toMatchObject({ kind: 'wait', retryHelps: false });
  });

  it('says wait when the Services tab already has the provider blocked', () => {
    expect(failing('valuate-bl-refresh', 'fetch failed', { blocked_services: ['bricklink'] })).toMatchObject({ kind: 'wait', service: 'bricklink' });
  });

  it('retries a one-off D1 blip, but calls three in a row a code problem', () => {
    expect(failing('snapshot-set-values', 'D1_ERROR: overloaded [7429]').kind).toBe('retry');
    const e = 'D1_ERROR: overloaded [7429]';
    expect(failing('snapshot-set-values', e, { recent_errors: [e, e, e] }).kind).toBe('code');
  });

  it('retries a first timeout, but asks for smaller batches when it repeats', () => {
    expect(failing('part-out-compute', 'timed out after 240s')).toMatchObject({ kind: 'retry', retryHelps: true });
    expect(failing('part-out-compute', 'stale: invocation ended before finish was recorded', { consecutive_failures: 3 })).toMatchObject({ kind: 'code' });
  });

  it('says Run now for a job that never got its turn', () => {
    expect(failing('bundle-values', 'not started: earlier jobs in this run used up its time')).toMatchObject({ kind: 'retry', retryHelps: true });
  });

  it('gives missed jobs a Run now recommendation and healthy jobs none', () => {
    expect(adviseJob({ name: 'x', health: 'missed' })).toMatchObject({ kind: 'check', retryHelps: true });
    expect(adviseJob({ name: 'x', health: 'ok' })).toBeNull();
  });

  it('suggests one retry for an unknown error, then a code fix when it repeats', () => {
    expect(failing('db-hygiene', 'something odd').kind).toBe('retry');
    expect(failing('db-hygiene', 'something odd', { recent_errors: ['something odd', 'something odd'] }).kind).toBe('code');
  });
});

describe('serviceFor', () => {
  it('matches service names as words only', () => {
    expect(serviceFor('db-hygiene', 'an exact example')).toBeUndefined();
    expect(serviceFor('x', 'PRICECHARTING_TOKEN rejected')).toBe('pricecharting');
    expect(serviceFor('brickset-enrich', 'oops')).toBe('brickset');
  });
});
