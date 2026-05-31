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
  BRICKLINK_CONSUMER_KEY: string;
  BRICKLINK_CONSUMER_SECRET: string;
  BRICKLINK_TOKEN: string;
  BRICKLINK_TOKEN_SECRET: string;
}

export type Variables = {
  userId: string;
};
