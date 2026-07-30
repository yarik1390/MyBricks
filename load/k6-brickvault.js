// Brickvault load test (k6). READ-ONLY: every request here is a GET, so this can
// never mutate a live collection. Run it from somewhere with a direct network
// path — a GitHub runner or a VPS. Do NOT read anything into it from a sandbox
// behind a proxy: that measures the proxy, not Cloudflare (a run from inside the
// agent sandbox pinned at ~40 req/s with latency scaling linearly against
// concurrency, the textbook signature of a saturated client).
//
//   k6 run load/k6-brickvault.js
//   BASE_URL=... TOKEN=... SCENARIO=origin k6 run load/k6-brickvault.js
//
// THE THING THAT MAKES THIS TEST HONEST
// ------------------------------------
// The hot endpoints sit behind a colo edge cache, so a naive load test measures
// Cloudflare's CDN and tells you nothing about your Worker or D1. Two scenarios
// separate the two questions:
//
//   cached  (default) "what do real users experience?" — normal traffic, mostly
//                     cache hits. This is the number that matters for UX.
//   origin            "what can the Worker + D1 actually take?" — deliberately
//                     defeats the cache on every request. Run it at a LOWER rate;
//                     every request here is real D1 work and real billed rows.
//
// Cache-busting differs per endpoint, and getting it wrong silently turns an
// origin test back into a cache test:
//   /api/sets/search  keys on the request URL  -> a random query param misses.
//   /api/sets/:setnum keys on (set, market) internally, NOT the URL -> a query
//                     param does NOT miss. Only a different set number does.
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE = __ENV.BASE_URL || 'https://brickvault-api.zhydenko.workers.dev';
const TOKEN = __ENV.TOKEN || '';           // optional: exercises authenticated paths
const SCENARIO = __ENV.SCENARIO || 'cached';

// ITERATIONS per second, not HTTP requests. One iteration is a whole user
// journey: ~5 requests plus ~6s of think time. So the HTTP rate is roughly
// 5x this, and the VUs needed to sustain it are roughly `rate x 6` — a
// journey that takes 6s of wall clock occupies a VU for all 6.
//
// Getting this wrong is not harmless: if maxVUs cannot cover `rate x duration`,
// k6 drops iterations and reports "insufficient VUs", quietly delivering LESS
// load than requested — which looks like a server that coped.
const PEAK_ITER_RATE = Number(__ENV.PEAK_RPS || (SCENARIO === 'origin' ? 10 : 25));
const ITERATION_SECONDS = 8;                       // ~6s think time + slack
// x2 covers the spike stage, x1.5 is headroom for a slow origin stretching
// iterations (which raises VU demand exactly when the server is struggling).
const MAX_VUS = Math.ceil(PEAK_ITER_RATE * 2 * ITERATION_SECONDS * 1.5);

// Fallback only. The real pool is fetched in setup() — see why below.
const SEED_SETS = ['10182-1', '75192-1', '10179-1', '10188-1', '10221-1'];

// How many distinct sets the origin scenario needs to actually MISS the cache.
// Set detail caches on (set, market) for 120s, so a pool of N sets over a run of
// R iterations gives roughly N misses per 120s window and (R - N) hits. The first
// run used 20 hardcoded sets for 1,895 iterations: ~97% of "origin" set-detail
// requests were served from cache, so that number measured the cache AGAIN and
// the origin path was never exercised. A pool on the order of the iteration count
// is what makes the miss rate meaningful.
const ORIGIN_POOL_TARGET = 500;

const cacheHit = new Rate('edge_cache_hit');
const browseLatency = new Trend('browse_latency', true);
const detailLatency = new Trend('detail_latency', true);

const authHeaders = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

export const options = {
  // k6 Trends do not carry p(50) by default — reading it yields NaN, which is
  // how the first run printed "p50 NaNms". Declare the stats we actually print.
  summaryTrendStats: ['med', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    [SCENARIO]: {
      executor: 'ramping-arrival-rate',
      // Arrival-rate, not VU-count: it holds a REQUEST rate and adds VUs to keep
      // up, so a slowing server shows as queued iterations rather than silently
      // reducing offered load — which is exactly what hides a capacity limit.
      startRate: 1,
      timeUnit: '1s',
      // Enough for the sustained stage up front. Allocating lazily meant k6 was
      // still spinning up VUs when the spike stage raised the rate, and dropped
      // iterations it could not start in time — 3-4% in the first runs, despite
      // peak usage sitting well under maxVUs.
      preAllocatedVUs: Math.min(MAX_VUS, Math.ceil(PEAK_ITER_RATE * ITERATION_SECONDS)),
      maxVUs: MAX_VUS,
      stages: [
        { target: Math.max(1, Math.round(PEAK_ITER_RATE * 0.25)), duration: '30s' }, // warm caches
        { target: Math.max(1, Math.round(PEAK_ITER_RATE * 0.5)), duration: '1m' },
        { target: PEAK_ITER_RATE, duration: '2m' },                                  // sustain
        { target: PEAK_ITER_RATE * 2, duration: '30s' },                             // spike
        { target: 0, duration: '30s' },                                              // recover
      ],
      gracefulStop: '30s',
    },
  },
  thresholds: {
    // A FAILED run should mean the app broke, not that the network was slow, so
    // the error-rate bar is tight and the latency bars are deliberately generous.
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    browse_latency: ['p(95)<2000'],
    detail_latency: ['p(95)<2500'],
  },
};

// Build the set pool from the live catalog rather than hardcoding it: it
// guarantees the numbers exist (a made-up one measures the 404 path) and gives
// enough distinct sets to genuinely miss set-detail's cache in origin mode.
export function setup() {
  if (SCENARIO !== 'origin') return { sets: SEED_SETS };
  const sets = [];
  for (let offset = 0; sets.length < ORIGIN_POOL_TARGET && offset < 2000; offset += 100) {
    const res = http.get(`${BASE}/api/sets/search?limit=100&offset=${offset}`, { headers: authHeaders });
    if (res.status !== 200) break;
    let page = [];
    try { page = res.json('sets') || []; } catch { break; }
    if (!page.length) break;
    for (const s of page) if (s && s.set_num) sets.push(s.set_num);
  }
  if (sets.length < 50) {
    // Better to fail loudly than to silently run an "origin" test against cache.
    throw new Error(`origin scenario needs a real set pool; only got ${sets.length}`);
  }
  console.log(`origin pool: ${sets.length} distinct sets`);
  return { sets };
}

function bust() {
  // Unique per iteration AND per VU, so parallel VUs never share a cache entry.
  return `_cb=${__VU}-${__ITER}-${Date.now()}`;
}

export default function (data) {
  const origin = SCENARIO === 'origin';
  const pool = (data && data.sets && data.sets.length) ? data.sets : SEED_SETS;

  group('catalog browse', () => {
    const url = origin
      ? `${BASE}/api/sets/search?limit=24&${bust()}`
      : `${BASE}/api/sets/search?limit=24`;
    const res = http.get(url, { headers: authHeaders, tags: { name: 'search' } });
    browseLatency.add(res.timings.duration);
    check(res, {
      'search 200': (r) => r.status === 200,
      'search returns sets': (r) => {
        try { return Array.isArray(r.json('sets')); } catch { return false; }
      },
    });
    if (res.headers['X-Edge-Cache']) cacheHit.add(res.headers['X-Edge-Cache'] === 'HIT');
  });

  sleep(randomIntBetween(1, 3)); // think time — users read the page

  group('set detail', () => {
    // In origin mode the set must VARY: set detail keys its cache on
    // (set, market), so a query-string buster would be a no-op here.
    const setNum = origin
      ? pool[randomIntBetween(0, pool.length - 1)]
      : pool[0];
    const res = http.get(`${BASE}/api/sets/${setNum}`, { headers: authHeaders, tags: { name: 'detail' } });
    detailLatency.add(res.timings.duration);
    check(res, {
      'detail 200': (r) => r.status === 200,
      'detail has set': (r) => {
        try { return !!r.json('set.set_num'); } catch { return false; }
      },
      // The shared half of this response is cached ACROSS USERS, so an anonymous
      // run must never come back holding somebody's collection row. If this ever
      // fails, stop and treat it as a data leak, not a flaky check.
      'no entry leak when anonymous': (r) => {
        if (TOKEN) return true;
        try { return r.json('entry') === null; } catch { return false; }
      },
    });
  });

  sleep(randomIntBetween(1, 2));

  group('supporting reads', () => {
    const responses = http.batch([
      ['GET', `${BASE}/api/themes`, null, { headers: authHeaders, tags: { name: 'themes' } }],
      ['GET', `${BASE}/api/config`, null, { tags: { name: 'config' } }],
    ]);
    check(responses[0], { 'themes 200': (r) => r.status === 200 });
    check(responses[1], { 'config 200': (r) => r.status === 200 });
  });

  if (TOKEN) {
    group('authenticated', () => {
      const responses = http.batch([
        ['GET', `${BASE}/api/collection`, null, { headers: authHeaders, tags: { name: 'collection' } }],
        ['GET', `${BASE}/api/minifigs?limit=30`, null, { headers: authHeaders, tags: { name: 'minifigs' } }],
      ]);
      check(responses[0], { 'collection 200': (r) => r.status === 200 });
      check(responses[1], { 'minifigs 200': (r) => r.status === 200 });
    });
  }

  sleep(randomIntBetween(1, 3));
}

export function handleSummary(data) {
  const m = data.metrics;
  const get = (name, stat) => (m[name] && m[name].values[stat] != null ? m[name].values[stat] : NaN);
  const line = (label, name) =>
    `  ${label.padEnd(18)} med ${get(name, 'med').toFixed(0).padStart(6)}ms   ` +
    `p95 ${get(name, 'p(95)').toFixed(0).padStart(6)}ms   ` +
    `p99 ${get(name, 'p(99)').toFixed(0).padStart(6)}ms`;
  const hitRate = m.edge_cache_hit ? `${(get('edge_cache_hit', 'rate') * 100).toFixed(1)}%` : 'n/a';
  const summary = [
    '',
    `scenario: ${SCENARIO}   peak: ${PEAK_ITER_RATE} journeys/s (~${PEAK_ITER_RATE * 5} req/s)   ` +
      `maxVUs: ${MAX_VUS}   auth: ${TOKEN ? 'yes' : 'no'}`,
    line('catalog browse', 'browse_latency'),
    line('set detail', 'detail_latency'),
    `  edge cache hit     ${hitRate}`,
    `  failed requests    ${(get('http_req_failed', 'rate') * 100).toFixed(2)}%`,
    `  throughput         ${get('http_reqs', 'rate').toFixed(1)} req/s`,
    `  dropped iterations ${Number.isNaN(get('dropped_iterations', 'count')) ? 0 : get('dropped_iterations', 'count')}` +
      '   <- non-zero means the GENERATOR ran out of VUs, not that the server coped',
    '',
  ].join('\n');
  return { stdout: summary, 'k6-summary.json': JSON.stringify(data, null, 2) };
}
