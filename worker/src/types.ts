export interface Env {
  DB: D1Database;
  OPENAI_API_KEY: string;
  REBRICKABLE_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_JWT_SECRET: string;
  ADMIN_USER_ID: string;
}

export type Variables = {
  userId: string;
};
