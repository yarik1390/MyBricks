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
```

## 4. Deploy Worker

```bash
npm run deploy
```

## 5. Seeding catalog data

To seed the initial catalog data, you can run the import scripts:

```bash
mkdir data
# Save lego_themes, lego_sets, minifigs as data/themes.json, data/sets.json, data/minifigs.json
npx tsx scripts/seed-d1.ts
npx wrangler d1 execute brickvault --remote --file=seed.sql
```

Or re-run the Rebrickable import via the admin endpoint after deploy.

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
5. Copy your user UUID to `ADMIN_USER_ID`

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
