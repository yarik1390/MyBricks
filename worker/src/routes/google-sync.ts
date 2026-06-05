import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Helper to generate secure random token
function generateSecureToken(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

// POST /api/google/auth-init — Start OAuth flow by generating a short-lived code (auth required)
app.post('/auth-init', requireMember, async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const code = generateSecureToken();
  const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5 minutes

  await c.env.DB.prepare(`
    INSERT INTO oauth_sessions (code, user_id, expires_at)
    VALUES (?, ?, ?)
  `).bind(code, userId, expiresAt).run();

  return c.json({ code });
});

// True only when real Google OAuth credentials are configured (not the dummy placeholders).
function googleConfigured(env: Env): boolean {
  return !!(env.GOOGLE_CLIENT_ID && !env.GOOGLE_CLIENT_ID.includes('dummy') &&
            env.GOOGLE_CLIENT_SECRET && !env.GOOGLE_CLIENT_SECRET.includes('dummy'));
}

// GET /api/google/auth — Start OAuth flow using a verified short-lived code
app.get('/auth', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.json({ error: 'Code is required' }, 400);
  if (!googleConfigured(c.env)) {
    return c.json({ error: 'Google Sheets sync is not configured on this deployment' }, 503);
  }

  const session = await c.env.DB.prepare(`
    SELECT user_id, expires_at FROM oauth_sessions WHERE code=?
  `).bind(code).first<{ user_id: string; expires_at: number }>();

  if (!session) {
    return c.json({ error: 'Invalid or expired auth session' }, 400);
  }

  // Single-use delete
  await c.env.DB.prepare('DELETE FROM oauth_sessions WHERE code=?').bind(code).run();

  if (session.expires_at < Math.floor(Date.now() / 1000)) {
    return c.json({ error: 'Auth session expired' }, 400);
  }

  const userId = session.user_id;
  const clientId = c.env.GOOGLE_CLIENT_ID || '1047116805178-dummy.apps.googleusercontent.com';
  const redirectUri = `${new URL(c.req.url).origin}/api/google/oauth`;

  // Generate a secure state nonce
  const state = generateSecureToken();
  const stateExpiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes

  await c.env.DB.prepare(`
    INSERT INTO oauth_states (state, user_id, expires_at)
    VALUES (?, ?, ?)
  `).bind(state, userId, stateExpiresAt).run();

  const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    access_type: 'offline',
    prompt: 'consent',
    state: state,
  });

  return c.redirect(oauthUrl);
});

// GET /api/google/oauth — OAuth callback handler (Public, verified using state nonce)
app.get('/oauth', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    return c.redirect(`${new URL(c.req.url).origin}/#/me?google_sync=error`);
  }

  const stateRecord = await c.env.DB.prepare(`
    SELECT user_id, expires_at FROM oauth_states WHERE state=?
  `).bind(state).first<{ user_id: string; expires_at: number }>();

  if (!stateRecord) {
    console.error('[google-oauth] State nonce not found or reused:', state);
    return c.redirect(`${new URL(c.req.url).origin}/#/me?google_sync=error`);
  }

  // Single-use delete
  await c.env.DB.prepare('DELETE FROM oauth_states WHERE state=?').bind(state).run();

  if (stateRecord.expires_at < Math.floor(Date.now() / 1000)) {
    console.error('[google-oauth] State nonce expired');
    return c.redirect(`${new URL(c.req.url).origin}/#/me?google_sync=error`);
  }

  const userId = stateRecord.user_id;
  const clientId = c.env.GOOGLE_CLIENT_ID || '1047116805178-dummy.apps.googleusercontent.com';
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET || 'dummy-client-secret';
  const redirectUri = `${new URL(c.req.url).origin}/api/google/oauth`;

  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResp.ok) {
      const errTxt = await tokenResp.text();
      console.error('[google-oauth] Exchange code failed:', errTxt);
      return c.redirect(`${new URL(c.req.url).origin}/#/me?google_sync=error`);
    }

    const tokens = await tokenResp.json() as { refresh_token?: string; access_token?: string };
    
    if (tokens.refresh_token) {
      await c.env.DB.prepare(`
        INSERT INTO user_prefs (user_id, google_refresh_token)
        VALUES (?, ?)
        ON CONFLICT (user_id) DO UPDATE SET google_refresh_token = EXCLUDED.google_refresh_token
      `).bind(userId, tokens.refresh_token).run();
    } else {
      console.warn('[google-oauth] No refresh token returned. User may need to revoke consent first.');
    }

    return c.redirect(`${new URL(c.req.url).origin}/#/me?google_sync=success`);
  } catch (err) {
    console.error('[google-oauth] Exception in OAuth exchange:', err);
    return c.redirect(`${new URL(c.req.url).origin}/#/me?google_sync=error`);
  }
});

// POST /api/google/sync — Perform synchronization
app.get('/status', requireMember, async (c) => {
  const userId = c.get('userId');
  const prefs = await c.env.DB.prepare('SELECT google_refresh_token, google_spreadsheet_id FROM user_prefs WHERE user_id=?')
    .bind(userId).first() as { google_refresh_token?: string; google_spreadsheet_id?: string } | null;
  return c.json({
    connected: !!prefs?.google_refresh_token,
    spreadsheet_id: prefs?.google_spreadsheet_id || null,
    configured: googleConfigured(c.env)
  });
});

app.post('/sync', requireMember, async (c) => {
  const userId = c.get('userId');
  const prefs = await c.env.DB.prepare('SELECT google_refresh_token, google_spreadsheet_id FROM user_prefs WHERE user_id=?')
    .bind(userId).first() as { google_refresh_token?: string; google_spreadsheet_id?: string } | null;

  if (!prefs || !prefs.google_refresh_token) {
    return c.json({ error: 'Google Account not connected' }, 400);
  }

  // Execute sync in execution context so it runs in background
  c.executionCtx.waitUntil(
    runSyncProcess(userId, prefs.google_refresh_token, prefs.google_spreadsheet_id || null, c.env)
  );

  return c.json({ message: 'Sync started' });
});

app.post('/disconnect', requireMember, async (c) => {
  const userId = c.get('userId');
  await c.env.DB.prepare('UPDATE user_prefs SET google_refresh_token=NULL, google_spreadsheet_id=NULL WHERE user_id=?')
    .bind(userId).run();
  return c.json({ ok: true });
});

export async function runSyncProcess(userId: string, refreshToken: string, existingSpreadsheetId: string | null, env: Env) {
  try {
    // 1. Refresh Access Token
    const clientId = env.GOOGLE_CLIENT_ID || '1047116805178-dummy.apps.googleusercontent.com';
    const clientSecret = env.GOOGLE_CLIENT_SECRET || 'dummy-client-secret';

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    });

    if (!tokenResp.ok) {
      throw new Error(`Token refresh failed: ${await tokenResp.text()}`);
    }

    const tokenData = await tokenResp.json() as { access_token: string };
    const accessToken = tokenData.access_token;

    // 2. Resolve Spreadsheet
    let spreadsheetId = existingSpreadsheetId;
    if (!spreadsheetId) {
      // Create new sheet
      const createResp = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: { title: 'MyBricks Vault' },
        }),
      });

      if (!createResp.ok) {
        throw new Error(`Failed to create spreadsheet: ${await createResp.text()}`);
      }

      const sheetData = await createResp.json() as { spreadsheetId: string };
      spreadsheetId = sheetData.spreadsheetId;

      // Save spreadsheet ID to database
      await env.DB.prepare('UPDATE user_prefs SET google_spreadsheet_id=? WHERE user_id=?')
        .bind(spreadsheetId, userId).run();
    }

    // 3. Fetch Collection Items
    type SyncResult = {
      set_num: string; name: string; year: number; theme: string; pieces: number;
      minifigs: number; condition: string; purchase_price: number; current_value: number;
      quantity: number; added_at: string;
    };
    const { results } = await env.DB.prepare(`
      SELECT 
        uc.set_num, ls.name, ls.year, ls.theme, ls.pieces, ls.minifigs,
        uc.condition, uc.purchase_price, ls.current_value, uc.quantity, uc.added_at
      FROM user_collection uc
      JOIN lego_sets ls ON ls.set_num = uc.set_num
      WHERE uc.user_id = ? AND uc.deleted_at IS NULL
      ORDER BY uc.added_at DESC
    `).bind(userId).all() as unknown as { results: SyncResult[] };

    // 4. Assemble Spreadsheet payload
    const header = [
      'Set Number', 'Name', 'Year', 'Theme', 'Pieces', 'Minifigs',
      'Condition', 'Purchase Price', 'Current Value', 'Quantity', 'Date Added'
    ];

    const rows = (results || []).map(item => [
      item.set_num,
      item.name || '',
      item.year || '',
      item.theme || '',
      item.pieces || 0,
      item.minifigs || 0,
      item.condition || 'new',
      item.purchase_price || 0,
      item.current_value || 0,
      item.quantity || 1,
      item.added_at || ''
    ]);

    const values = [header, ...rows];

    // 5. Write to Sheet (Overwrite Sheet1!A1:K)
    const updateResp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    });

    if (!updateResp.ok) {
      throw new Error(`Failed to update sheet values: ${await updateResp.text()}`);
    }

    console.log(`[google-sync] Collection synced successfully for user ${userId}`);
  } catch (err) {
    console.error('[google-sync] Error running spreadsheet sync:', err);
  }
}

export { app as googleSyncRoute };
