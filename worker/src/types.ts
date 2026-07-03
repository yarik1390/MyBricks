export interface AnalyticsEngineDataset {
  writeDataPoint(opts: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export interface Env {
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
  BRICKSET_API_KEY: string;
  BRICKOWL_API_KEY?: string;
  EBAY_APP_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  BRICKLINK_CONSUMER_KEY: string;
  BRICKLINK_CONSUMER_SECRET: string;
  BRICKLINK_TOKEN: string;
  BRICKLINK_TOKEN_SECRET: string;
  BRICKECONOMY_API_KEY?: string;
  // Pricing-source kill switches (see lib/pricing-flags.ts). Default OFF;
  // set to "1" via wrangler [vars] to re-enable once provider access returns.
  EBAY_SOLD_COMPS_ENABLED?: string;
  BRICKOWL_ENABLED?: string;
  BRICKINSIGHTS_ENABLED?: string;
  BRIGHTDATA_API_TOKEN?: string;
  // Comma-separated additional Bright Data tokens, pooled + rotated by remaining
  // monthly budget (free tier = 5000 credits/key/mo). See lib/brightdata-keys.ts.
  BRIGHTDATA_API_TOKENS?: string;
  BRIGHTDATA_ZONE?: string;
  BRIGHTDATA_SOLD_ENABLED?: string;
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
  // Cloudflare Turnstile (optional bot protection for the shared-key photo scan).
  // SITE key is public (sent to the browser via /api/config); SECRET key is
  // server-only. When SECRET is unset, scan verification is skipped (opt-in).
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
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
  // PriceCharting REST API token (Collector tier, $4.99/month).
  // Enables pc_new_value + pc_complete_value as independent sold-comp sources
  // in the pricing blend. Zero Firecrawl credits — uses PriceCharting's own API.
  PRICECHARTING_TOKEN?: string;
  // Flag: PriceCharting account is on the Legendary tier, unlocking the optional
  // admin bulk CSV-upload path. The per-set /api/product path (loose-price +
  // sales-volume) works on any paid tier regardless of this flag.
  PRICECHARTING_PRO?: string;
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
