# Cloudflare Worker — Setup

## 1. Create D1 database

```bash
npx wrangler d1 create brickvault
# Copy the database_id into wrangler.toml
```

## 2. Apply schema

```bash
npm run db:init:remote
```

## 3. Set secrets

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put REBRICKABLE_API_KEY
npx wrangler secret put SUPABASE_URL         # e.g. https://xxx.supabase.co
npx wrangler secret put SUPABASE_ANON_KEY    # public anon key from Supabase dashboard
npx wrangler secret put SUPABASE_JWT_SECRET  # JWT secret from Supabase project settings
npx wrangler secret put ADMIN_USER_ID        # your Supabase user UUID
npx wrangler secret put GOOGLE_CLIENT_ID     # optional; Google Sheets sync
npx wrangler secret put GOOGLE_CLIENT_SECRET # optional; Google Sheets sync
npx wrangler secret put EBAY_APP_ID          # optional; eBay production App ID / Client ID
npx wrangler secret put EBAY_CLIENT_SECRET   # optional; matching production Cert ID / Client Secret
npx wrangler secret put GEMINI_API_KEY       # optional; server-side Gemini valuation fallback
npx wrangler secret put RESEND_API_KEY       # optional; email wishlist alerts
npx wrangler secret put VAPID_PUBLIC_KEY     # optional; browser push alerts
npx wrangler secret put VAPID_PRIVATE_KEY    # optional; browser push alerts
npx wrangler secret put VAPID_SUBJECT        # optional; e.g. mailto:you@example.com
```

## 4. Deploy Worker

```bash
npm run deploy
```

## 5. Seeding catalog data (required)

The app is unusable without catalog data — search, scanning, and valuations
all depend on `lego_sets` being populated. Either run the import scripts:

```bash
mkdir data
# Save lego_themes, lego_sets, minifigs as data/themes.json, data/sets.json, data/minifigs.json
npx tsx scripts/seed-d1.ts
npx wrangler d1 execute brickvault --remote --file=seed.sql
```

Or, after deploy, trigger the full population campaign (imports catalog +
minifigs, rebuilds search, backfills barcodes, runs valuations):

```bash
curl -X POST https://<worker-url>/api/admin/populate-everything \
  -H "Authorization: Bearer <admin JWT>"
# Poll progress: GET /api/admin/import-status
# Re-invoke until the response reports complete:true — each call advances one slice.
```

The CI deploy workflow also attempts a small warning-only campaign after each
deploy. A provider/data failure is logged as a GitHub Actions warning so the
Worker and Pages deploy can stay green; rerun **Populate everything** from the
Me tab after fixing the reported provider issue.

## 6. Deploy Pages

```bash
npx wrangler pages deploy ../public --project-name brickvault
```

Configure a custom domain in the Cloudflare dashboard and add a Worker Route for
`yourdomain.com/api/*` pointing to the `brickvault-api` Worker.

## 7. Supabase setup

1. Create a project at supabase.com
2. Enable Email auth (Auth > Providers > Email)
3. Set `SITE_URL` in Auth settings to your Pages domain
4. Create your admin account via the Supabase Auth dashboard
5. Copy your user UUID to `ADMIN_USER_ID`. Find it in the Supabase dashboard
   under **Authentication → Users** — the `UID` column for your account (a
   UUID like `1c2f...-...`). Alternatively, sign in to the app and decode the
   `sub` claim of your JWT at jwt.io.

## 8. Google Sheets OAuth setup

Google Sheets actions stay disabled until both OAuth secrets are present.

1. Create an OAuth client in Google Cloud Console.
2. Add the production redirect URI:

```text
https://brickvault-api.<your-worker-subdomain>.workers.dev/api/google/oauth
```

3. For local Worker development, add:

```text
http://127.0.0.1:8787/api/google/oauth
```

4. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as GitHub Actions secrets. The deploy workflow uploads them to Worker secrets.

## 9. Optional alerts and AI fallback

These features stay disabled with precise setup messages until their secrets
are present:

- `GEMINI_API_KEY` enables server-side Gemini fallback valuations. User BYOK
  Gemini keys still work without this secret.
- `RESEND_API_KEY` enables email wishlist alerts.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` enable browser
  push alerts. `VAPID_SUBJECT` should usually be a `mailto:` contact.

## Local development

```bash
cd worker
npm ci
cp .dev.vars.example .dev.vars      # fill in at least the Supabase values
npx wrangler d1 execute brickvault --local --file=schema.sql
npx wrangler dev                    # API at http://127.0.0.1:8787
```

Serve the frontend from the repo root (any static server, e.g.
`npx serve public`) and point it at the local Worker via `public/env.js`.

Run the checks before pushing:

```bash
npm run typecheck && npm test               # worker/
node --test public/js/__tests__/pure.test.js  # repo root
```

## Search index recovery

If catalog search starts failing or returns a `search_degraded: true` flag,
the FTS5 index is corrupted. The Worker auto-repairs it in the background on
the first degraded query; to force it manually:

```bash
curl -X POST https://<worker-url>/api/admin/repair-search-index \
  -H "Authorization: Bearer <admin JWT>"
```

## Environment variables reference

| Variable | Where | Notes |
|---|---|---|
| `OPENAI_API_KEY` | Worker secret | GPT-4o for scan, GPT-4o-mini for valuations |
| `REBRICKABLE_API_KEY` | Worker secret | Optional; enables live search + fallback lookup |
| `SUPABASE_URL` | Worker secret | `https://<project>.supabase.co` |
| `SUPABASE_ANON_KEY` | Worker secret | Public-safe; served to frontend via `/api/config` |
| `SUPABASE_JWT_SECRET` | Worker secret | Server-only JWT verification |
| `ADMIN_USER_ID` | Worker secret | Supabase user UUID for admin endpoints |
| `GOOGLE_CLIENT_ID` | Worker secret / GitHub secret | Required with `GOOGLE_CLIENT_SECRET` for Google Sheets sync |
| `GOOGLE_CLIENT_SECRET` | Worker secret / GitHub secret | Required with `GOOGLE_CLIENT_ID` for Google Sheets sync |
| `GEMINI_API_KEY` | Worker secret / GitHub secret | Optional server-side Gemini fallback; BYOK browser keys still work without it |
| `RESEND_API_KEY` | Worker secret / GitHub secret | Optional email wishlist alerts |
| `VAPID_PUBLIC_KEY` | Worker secret / GitHub secret | Optional browser push alerts |
| `VAPID_PRIVATE_KEY` | Worker secret / GitHub secret | Optional browser push alerts |
| `VAPID_SUBJECT` | Worker secret / GitHub secret | Optional Web Push subject, usually `mailto:you@example.com` |
| `BRICKSET_API_KEY` | Worker secret / GitHub secret | Optional catalog details and UPC barcode backfill |
| `BRICKLINK_CONSUMER_KEY` | Worker secret / GitHub secret | Optional BrickLink valuation OAuth |
| `BRICKLINK_CONSUMER_SECRET` | Worker secret / GitHub secret | Optional BrickLink valuation OAuth |
| `BRICKLINK_TOKEN` | Worker secret / GitHub secret | Optional BrickLink valuation OAuth |
| `BRICKLINK_TOKEN_SECRET` | Worker secret / GitHub secret | Optional BrickLink valuation OAuth |
| `EBAY_APP_ID` | Worker secret / GitHub secret | Production eBay App ID / Client ID. Required with `EBAY_CLIENT_SECRET` for eBay US/USD sold comps |
| `EBAY_CLIENT_SECRET` | Worker secret / GitHub secret | Matching production Cert ID / Client Secret. The keyset must also be approved for limited-release Marketplace Insights sold-comps access |
| `BRICKECONOMY_API_KEY` | Worker secret / GitHub secret | Optional primary valuation source |
| `BRICKOWL_API_KEY` | Worker secret / GitHub secret | Optional UPC fallback |
| `ADMIN_JWT` | GitHub secret | Optional fallback only; CI now mints a one-hour admin smoke token from `SUPABASE_JWT_SECRET` and `ADMIN_USER_ID` |
