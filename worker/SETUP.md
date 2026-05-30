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
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY  # service role key (server-only)
npx wrangler secret put ADMIN_USER_ID        # your Supabase user UUID
```

## 4. Deploy Worker

```bash
npm run deploy
```

## 5. Data migration (from Hatchable)

Export catalog data from Hatchable using `execute_sql` MCP, then:

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

## Environment variables reference

| Variable | Where | Notes |
|---|---|---|
| `OPENAI_API_KEY` | Worker secret | GPT-4o for scan, GPT-4o-mini for valuations |
| `REBRICKABLE_API_KEY` | Worker secret | Optional; enables live search + fallback lookup |
| `SUPABASE_URL` | Worker secret | `https://<project>.supabase.co` |
| `SUPABASE_ANON_KEY` | Worker secret | Public-safe; served to frontend via `/api/config` |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker secret | Server-only JWT verification |
| `ADMIN_USER_ID` | Worker secret | Supabase user UUID for admin endpoints |
