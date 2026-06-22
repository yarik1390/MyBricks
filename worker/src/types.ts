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
}

export type Variables = {
  userId: string;
  userEmail?: string;
};
