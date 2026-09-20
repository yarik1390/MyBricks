import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const index = read('worker/src/index.ts');
const config = read('worker/wrangler.toml');
const registry = read('worker/src/lib/process-registry.ts');

test('every literal scheduled dispatcher case has a configured trigger', () => {
  const section = config.split('[triggers]')[1]?.split(/^\[/m)[0];
  assert.ok(section, 'triggers section exists');
  const declared = new Set([...section.matchAll(/"([^"\n]+)"/g)].map(m => m[1]));
  const handled = new Set([...index.matchAll(/case '([^']+\*[^']*)':/g)].map(m => m[1]));
  assert.ok(handled.size > 10, 'recognizes cron dispatcher');
  assert.deepEqual([...handled].filter(cron => !declared.has(cron)), []);
  assert.deepEqual([...declared].filter(cron => !handled.has(cron)), []);
});

test('pricing process metadata agrees with scheduled execution', () => {
  // minute + hour, so a job can move off :00 without the assertion silently
  // matching a different slot (the backfill deliberately runs at 14:45).
  for (const [job, minute, hour] of [
    ['brickpicker-enrich', 0, 17],
    ['pricecharting-enrich', 0, 14],
    ['pricecharting-link-backfill', 45, 14],
  ]) {
    const cron = `${minute} ${hour} * * *`;
    assert.ok(
      index.includes(`case '${cron}': await run('${job}'`),
      `${job} has a literal dispatcher case for ${cron}`,
    );
    const line = registry.split('\n').find(row => row.includes(`'${job}':`));
    assert.ok(line, `${job} is listed in the process registry`);
    assert.ok(
      line.includes(`Daily ${hour}:${String(minute).padStart(2, '0')} UTC`),
      `${job} displayed cadence matches its dispatcher`,
    );
  }
});
