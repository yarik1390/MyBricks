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
const PEAK_RPS = Number(__ENV.PEAK_RPS || (SCENARIO === 'origin' ? 20 : 120));

// A spread of real set numbers, used to defeat set-detail's (set, market) cache
// key. Sets a load test picks at random must exist, or you measure the 404 path.
const SET_POOL = [
  '10182-1', '75192-1', '10179-1', '10188-1', '10221-1', '21309-1', '10214-1',
  '42115-1', '10276-1', '71043-1', '10256-1', '10261-1', '75252-1', '10270-1',
  '21318-1', '10265-1', '76139-1', '10497-1', '10302-1', '10303-1',
];

const cacheHit = new Rate('edge_cache_hit');
const browseLatency = new Trend('browse_latency', true);
const detailLatency = new Trend('detail_latency', true);

const authHeaders = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

export const options = {
  scenarios: {
    [SCENARIO]: {
      executor: 'ramping-arrival-rate',
      // Arrival-rate, not VU-count: it holds a REQUEST rate and adds VUs to keep
      // up, so a slowing server shows as queued iterations rather than silently
      // reducing offered load — which is exactly what hides a capacity limit.
      startRate: 5,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        { target: Math.round(PEAK_RPS * 0.25), duration: '30s' }, // warm caches
        { target: Math.round(PEAK_RPS * 0.5), duration: '1m' },
        { target: PEAK_RPS, duration: '2m' },                     // sustain
        { target: PEAK_RPS * 2, duration: '30s' },                // spike
        { target: 0, duration: '30s' },                           // recover
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

function bust() {
  // Unique per iteration AND per VU, so parallel VUs never share a cache entry.
  return `_cb=${__VU}-${__ITER}-${Date.now()}`;
}

export default function () {
  const origin = SCENARIO === 'origin';

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
      ? SET_POOL[randomIntBetween(0, SET_POOL.length - 1)]
      : SET_POOL[0];
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
    `  ${label.padEnd(18)} p50 ${get(name, 'p(50)').toFixed(0).padStart(6)}ms   ` +
    `p95 ${get(name, 'p(95)').toFixed(0).padStart(6)}ms`;
  const hitRate = m.edge_cache_hit ? `${(get('edge_cache_hit', 'rate') * 100).toFixed(1)}%` : 'n/a';
  const summary = [
    '',
    `scenario: ${SCENARIO}   peak: ${PEAK_RPS} req/s   auth: ${TOKEN ? 'yes' : 'no'}`,
    line('catalog browse', 'browse_latency'),
    line('set detail', 'detail_latency'),
    `  edge cache hit     ${hitRate}`,
    `  failed requests    ${(get('http_req_failed', 'rate') * 100).toFixed(2)}%`,
    `  throughput         ${get('http_reqs', 'rate').toFixed(1)} req/s`,
    '',
  ].join('\n');
  return { stdout: summary, 'k6-summary.json': JSON.stringify(data, null, 2) };
}
