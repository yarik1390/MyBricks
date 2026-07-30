# Load testing

`k6-brickvault.js` drives the live read surface. Every request is a GET, so it
cannot mutate a collection.

## Setup

Copy `k6-workflow.yml` to `.github/workflows/load-test.yml` and commit it — the
GitHub App integration cannot push files under `.github/workflows/`. Then run it
from the Actions tab (manual dispatch only, on purpose: it hits production).

Locally: `k6 run load/k6-brickvault.js`

## The two scenarios, and why it matters which you run

The hot endpoints sit behind a colo edge cache. A load test that ignores that
measures Cloudflare's CDN and tells you nothing about your own capacity.

| `SCENARIO` | Question it answers | Peak default |
|---|---|---|
| `cached` | What do real users experience? | 120 req/s |
| `origin` | What can the Worker + D1 actually take? | 20 req/s |

`origin` defeats the cache on every request, so **every request is real D1 work
and real billed rows**. Keep the rate low and the run short.

Cache-busting is per-endpoint, and getting it wrong silently turns an origin run
back into a cache run:

- `/api/sets/search` keys on the request URL — a random query param misses.
- `/api/sets/:setnum` keys on `(set, market)` *internally*, not on the URL — a
  query param does **not** miss it. Only a different set number does. That is why
  the script varies the set number rather than adding a parameter.

## Reading the result

Thresholds fail the run on `http_req_failed > 1%` or `checks < 99%`. Latency bars
are deliberately loose (p95 2s/2.5s) so a slow network doesn't produce a red run
that reads as an application fault.

Watch `edge_cache_hit`. In `cached` it should be high; if it is low, something
made the responses uncacheable and the catalog is hitting D1 on every view.

One check is a correctness assertion rather than a performance one:
**`no entry leak when anonymous`**. Set detail caches its shared half across
users, with the per-user collection row merged in afterwards. If that check ever
fails, an anonymous request came back holding somebody's holdings — stop and
treat it as a data leak, not a flake.

## Don't run it from a proxied sandbox

A run from inside the agent sandbox pinned at ~40 req/s with latency scaling
linearly against concurrency, and zero errors at every level — the signature of
a saturated client, not a saturated server. Use a runner with a direct path.

## Authentication

`TOKEN` (a Supabase access token) is optional; without it the run covers the
public surface, which is most of the traffic. Supabase access tokens expire in an
hour, so it is only worth setting as a short-lived secret right before a run.
