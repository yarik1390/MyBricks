export interface AnalyticsEngineDataset {
  writeDataPoint(opts: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export interface Env {
  /** Deployment environment label; tests use `test`. */
  ENVIRONMENT?: string;
  DB: D1Database;
  CACHE_KV?: KVNamespace;
  ANALYTICS?: AnalyticsEngineDataset;
  PHOTO_BUCKET?: R2Bucket;
  OPENAI_API_KEY: string;
  REBRICKABLE_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_JWT_SECRET: string;
  // Supabase service-role key (optional). When set as a Worker secret, account
  // deletion (DELETE /api/me) also removes the Supabase auth identity via the
  // Admin API so the email can't sign back into an empty account. Without it,
  // deletion still purges all D1 data + R2 photos (store-compliant), but the
  // auth stub remains until the key is configured.
  SUPABASE_SERVICE_ROLE_KEY?: string;
  // "1" enables the "Sign in with Apple" button on the login screen. Flip on
  // only AFTER the Apple provider is configured in Supabase (Apple Developer
  // Service ID + key) — required for the iOS App Store build (Guideline 4.8).
  APPLE_SIGNIN_ENABLED?: string;
  // Shared secret set as the Authorization header on the RevenueCat webhook
  // (Dashboard → Integrations → Webhooks). POST /api/revenuecat/webhook flips
  // is_supporter from Play/Apple purchase events. Authoritative entitlement source.
  REVENUECAT_WEBHOOK_AUTH?: string;
  ADMIN_USER_ID: string;
  /** Canonical https origin for links the Worker generates (emails, push,
   *  exports). Defaults to the original Cloudflare Pages origin; set this to
   *  move new links to a custom domain. The legacy origin keeps working for
   *  CORS either way — see lib/app-url.ts. */
  APP_BASE_URL?: string;
  BRICKSET_API_KEY: string;
  BRICKOWL_API_KEY?: string;
  // Apify eBay sold-comps actor. On by default once this secret is configured.
  APIFY_API_TOKEN?: string;
  APIFY_ENABLED?: string;
  EBAY_APP_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  BRICKLINK_CONSUMER_KEY: string;
  BRICKLINK_CONSUMER_SECRET: string;
  BRICKLINK_TOKEN: string;
  BRICKLINK_TOKEN_SECRET: string;
  BRICKECONOMY_API_KEY?: string;
  // ScrapingAnt raw-HTML transport for plain Brickset, BrickEconomy, and LEGO
  // product pages. Keys are Worker secrets; only hashes and monthly call counts
  // are persisted in D1. The plural secret is a comma-separated rotation pool.
  SCRAPINGANT_API_KEY?: string;
  SCRAPINGANT_API_KEYS?: string;
  /** Optional lower test/operator cap; production is always clamped to <=9800. */
  SCRAPINGANT_KEY_CAP?: string;
  // Bright Data Web Unlocker token pool. Tokens are Worker secrets; only hashes
  // and monthly call counts are persisted in D1. One unlock request = one credit.
  BRIGHTDATA_API_TOKEN?: string;
  BRIGHTDATA_API_TOKENS?: string;
  BRIGHTDATA_ZONE?: string;
  /** Optional lower test/operator cap; production is always clamped to <=4900. */
  BRIGHTDATA_KEY_CAP?: string;
  /** Days before a set that HAS BrickEconomy data is re-scraped (default 7).
   *  This is the Firecrawl-credit governor for brickeconomy-enrich — raising it
   *  cuts the burn proportionally. Sets BrickEconomy has no data for ignore it
   *  and stay on a fixed 90-day gate. */
  BRICKECONOMY_REFRESH_DAYS?: string;
  /** Firecrawl credits brickeconomy-enrich must leave for the day's other
   *  consumers (default 3000). It runs 48x a day and reaches the shared ledger
   *  first, so without a floor it can drain the ceiling before the evening
   *  eBay-sold runs. */
  FIRECRAWL_RESERVE_CREDITS?: string;
  // Pricing-source kill switches (see lib/pricing-flags.ts). Default OFF;
  // set to "1" via wrangler [vars] to re-enable once provider access returns.
  EBAY_SOLD_COMPS_ENABLED?: string;
  /** Test-only escape hatch for isolated eBay job tests. Never configure in deployment. */
  EBAY_SOURCE_AUTHORIZED_FOR_TESTS?: string;
  BRICKOWL_ENABLED?: string;
  BRICKINSIGHTS_ENABLED?: string;
  // StockX lowest-ask scrape (Firecrawl). OFF unless STOCKX_ENABLED is truthy.
  STOCKX_ENABLED?: string;
  // UPCitemdb barcode source (2nd source after Brickset). Trial needs no key;
  // UPCITEMDB_USER_KEY switches to the higher-limit v1 endpoint. Default enabled.
  UPCITEMDB_USER_KEY?: string;
  UPCITEMDB_ENABLED?: string;
  GEMINI_API_KEY?: string;
  // Cloudflare AI Gateway (optional). When account + gateway id are set, SERVER-key
  // AI calls route through the gateway for caching, analytics, rate/spend limits.
  // Token is only needed if the gateway has authentication enabled.
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  AI_GATEWAY_TOKEN?: string;
  // OpenRouter API key. When set, the valuation cron's paid fallback routes
  // through OpenRouter (free model first, then cheap paid) via the AI Gateway.
  OPENROUTER_API_KEY?: string;
  // Merge Gateway (https://gateway.merge.dev) — a second multi-provider LLM
  // gateway that runs in parallel with OpenRouter. Key format "mg_...". It is
  // OpenAI-compatible, so it reuses the same client with a different baseURL.
  // Where each workload tries it is admin-tunable — see lib/llm-routing.ts.
  MERGE_GATEWAY_API_KEY?: string;
  // Monthly USD allowance the admin console meters Merge spend against
  // (default 10). Merge publishes no balance API, so remaining credit is
  // derived from the real per-call `usage.cost` it returns, accumulated in the
  // ai_usage ledger. Set a matching HARD budget in the Merge dashboard as the
  // authoritative backstop — that one answers with HTTP 402.
  //
  // Configured as a plain [vars] entry in wrangler.toml, NOT a secret and NOT
  // in the Cloudflare dashboard: `wrangler deploy` sends the full binding list,
  // so a var missing from wrangler.toml is REMOVED on the next deploy.
  MERGE_MONTHLY_BUDGET_USD?: string;
  // Cloudflare Turnstile (optional bot protection for the shared-key photo scan).
  // SITE key is public (sent to the browser via /api/config); SECRET key is
  // server-only. When SECRET is unset, scan verification is skipped (opt-in).
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  // Firebase Admin service-account JSON used by FCM HTTP v1 for native Android
  // notifications. Keep the complete JSON in a Worker secret; never expose it
  // through /api/config or logs.
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  // Firecrawl web-scraping API (lego.com stock, eBay sold comps, Brickset enrichment).
  // On by default once the key is set. Set FIRECRAWL_ENABLED=0 to pause without removing the key.
  FIRECRAWL_API_KEY?: string;
  FIRECRAWL_ENABLED?: string;
  // Per-day Firecrawl CREDIT ceiling override (credits, not scrapes). Raise for
  // the one-time bootstrap; defaults to the api-quota cap otherwise.
  FIRECRAWL_DAILY_CREDITS?: string;
  // Comma-separated list of additional Firecrawl API keys for key rotation.
  // When set, each scrape call picks a random key from FIRECRAWL_API_KEY +
  // FIRECRAWL_API_KEYS; effectively multiplies the daily credit ceiling by the
  // number of keys. FIRECRAWL_DAILY_CREDITS must be set to the TOTAL across all
  // keys (e.g. 10 keys × 30,000 = 300,000) to avoid premature throttling.
  FIRECRAWL_API_KEYS?: string;
  // Per-key REMAINING credit balances, positionally aligned with the key list
  // (FIRECRAWL_API_KEY first, then FIRECRAWL_API_KEYS) — e.g. "19000,650000".
  // Keys are drained in that order, so put the one you want spent first in
  // FIRECRAWL_API_KEY. Counting starts from zero the first time a key is used, so
  // these are "credits left from now", not lifetime plan size. Omitted/zero
  // entries mean "unknown": that key is retired only by Firecrawl's own 402.
  FIRECRAWL_KEY_CREDITS?: string;
  // Discord (or any Discord-compatible) webhook for OPS alerts: dead crons and
  // providers that stopped succeeding. Same secret the d1-cost-watchdog workflow
  // uses. Unset = alerting is a no-op, the daily check still records its findings.
  DISCORD_OPS_WEBHOOK?: string;
  // PriceCharting REST API token (Collector tier, $4.99/month).
  // Enables pc_new_value + pc_complete_value as independent sold-comp sources
  // in the pricing blend. Zero Firecrawl credits — uses PriceCharting's own API.
  PRICECHARTING_TOKEN?: string;
  // Flag: PriceCharting account is on the Legendary tier, unlocking the optional
  // admin bulk CSV-upload path. The per-set /api/product path (loose-price +
  // sales-volume) works on any paid tier regardless of this flag.
  PRICECHARTING_PRO?: string;
  // Second lock protecting the PriceCharting quarantine. Admin source tuning
  // cannot re-enable its jobs until identity review is explicitly approved.
  PRICECHARTING_VERIFIED_ENABLED?: string;
  // pricesAPI.io — live retail + marketplace offers across major retailers
  // (https://api.pricesapi.io/api/v1/products/search). Synchronous cold calls
  // take 30–90s so it is cron-only. Free tier = 1000 calls/month, 6/min PER KEY,
  // so multiple comma-separated keys in PRICESAPI_API_KEYS are pooled (see
  // lib/pricesapi-keys.ts). OFF unless PRICESAPI_ENABLED is truthy AND a key is set.
  PRICESAPI_API_KEY?: string;
  PRICESAPI_API_KEYS?: string;
  // Accepted aliases for the pricesAPI key(s) — some deployments name the secret
  // PRICE_API_KEY / PRICE_API_KEYS. Treated identically to PRICESAPI_API_KEY(S).
  PRICE_API_KEY?: string;
  PRICE_API_KEYS?: string;
  PRICESAPI_ENABLED?: string;
  // ISO country/market code for pricesAPI lookups (default "us"; us/gb/au/de/nl
  // have the deepest retailer coverage).
  PRICESAPI_MARKET?: string;
  // Amazon Associates link-only is the default integration. Creators API is
  // separately gated and its product content must remain in KV for <24 hours.
  AMAZON_PARTNER_TAG_FR_WEB?: string;
  AMAZON_PARTNER_TAG_FR_ANDROID?: string;
  AMAZON_WEB_ENABLED?: string;
  AMAZON_ANDROID_ENABLED?: string;
  AMAZON_DEFAULT_MARKET?: string;
  AMAZON_CREATORS_PUBLIC_KEY?: string;
  AMAZON_CREATORS_PRIVATE_KEY?: string;
  AMAZON_CREATORS_ENABLED?: string;
  // Shadow rollout percentage for v3 reads (0, 10, 50, 100). The state is
  // always computed; this only controls whether it replaces legacy headlines.
  PRICING_V3_READ_PERCENT?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  // Patreon crowdfunding link (set via wrangler secret put PATREON_URL).
  // When set, the Support card on the Me tab shows a "Support on Patreon" button.
  PATREON_URL?: string;
}

export type Variables = {
  userId: string;
  userEmail?: string;
};
