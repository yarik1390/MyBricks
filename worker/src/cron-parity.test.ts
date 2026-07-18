import { describe, expect, it } from 'vitest';
// Vite's ?raw imports inline the file contents at build time, so this works
// inside the workers pool (no fs access there). tsc has no declarations for
// ?raw specifiers — hence the expect-error markers.
// @ts-expect-error — vite raw import has no type declaration
import wranglerToml from '../wrangler.toml?raw';
// @ts-expect-error — vite raw import has no type declaration
import indexSource from './index.ts?raw';

// Every cron Cloudflare fires must have a handler, or the job silently never
// runs (the exact failure that left pricecharting-enrich orphaned for weeks:
// fully implemented, tested, and never scheduled).
describe('cron parity (wrangler.toml <-> scheduled() switch)', () => {
  const cronsBlock = String(wranglerToml).match(/crons\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
  const crons = [...cronsBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const cases = new Set([...String(indexSource).matchAll(/case '([^']+)':/g)].map((m) => m[1]));

  it('found both lists', () => {
    expect(crons.length).toBeGreaterThan(10);
    expect(cases.size).toBeGreaterThan(10);
  });

  it('every wrangler.toml cron has a matching case in scheduled()', () => {
    const orphaned = crons.filter((cron) => !cases.has(cron));
    expect(orphaned, `crons with no scheduled() case: ${orphaned.join(', ')}`).toEqual([]);
  });

  it('no cron uses numeric Sunday (Cloudflare rejects "0"; use SUN)', () => {
    const numericSunday = crons.filter((cron) => /\s0$/.test(cron) && cron.split(/\s+/).length === 5);
    expect(numericSunday).toEqual([]);
  });
});
