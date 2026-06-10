export interface Env {
  DB: D1Database;
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
  GEMINI_API_KEY?: string;
}

export type Variables = {
  userId: string;
};
