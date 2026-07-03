import { Hono } from 'hono';
import { requireMember } from '../auth';
import { fetchTracked } from '../lib/http';
import { recordIntegrationAttempt } from '../lib/integration-health';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

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
  const expiresAt = Math.floor(Date.now() / 1000) + 300;

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

  await c.env.DB.prepare('DELETE FROM oauth_sessions WHERE code=?').bind(code).run();

  if (session.expires_at < Math.floor(Date.now() / 1000)) {
    return c.json({ error: 'Auth session expired' }, 400);
  }

  const userId = session.user_id;
  const clientId = c.env.GOOGLE_CLIENT_ID || '1047116805178-dummy.apps.googleusercontent.com';
  const redirectUri = `${new URL(c.req.url).origin}/api/google/oauth`;

  const state = generateSecureToken();
  const stateExpiresAt = Math.floor(Date.now() / 1000) + 600;

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
    return c.redirect(`${new URL(c.req.url).origin}/#/me/integrations?google_sync=error`);
  }

  const stateRecord = await c.env.DB.prepare(`
    SELECT user_id, expires_at FROM oauth_states WHERE state=?
  `).bind(state).first<{ user_id: string; expires_at: number }>();

  if (!stateRecord) {
    console.error('[google-oauth] State nonce not found or reused:', state);
    return c.redirect(`${new URL(c.req.url).origin}/#/me/integrations?google_sync=error`);
  }

  await c.env.DB.prepare('DELETE FROM oauth_states WHERE state=?').bind(state).run();

  if (stateRecord.expires_at < Math.floor(Date.now() / 1000)) {
    console.error('[google-oauth] State nonce expired');
    return c.redirect(`${new URL(c.req.url).origin}/#/me/integrations?google_sync=error`);
  }

  const userId = stateRecord.user_id;
  const clientId = c.env.GOOGLE_CLIENT_ID || '1047116805178-dummy.apps.googleusercontent.com';
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET || 'dummy-client-secret';
  const redirectUri = `${new URL(c.req.url).origin}/api/google/oauth`;

  try {
    const tokenResp = await fetchTracked(c.env, 'google', 'https://oauth2.googleapis.com/token', {
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
      return c.redirect(`${new URL(c.req.url).origin}/#/me/integrations?google_sync=error`);
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

    return c.redirect(`${new URL(c.req.url).origin}/#/me/integrations?google_sync=success`);
  } catch (err) {
    console.error('[google-oauth] Exception in OAuth exchange:', err);
    return c.redirect(`${new URL(c.req.url).origin}/#/me/integrations?google_sync=error`);
  }
});

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

const _syncInProgress = new Set<string>();

app.post('/sync', requireMember, async (c) => {
  const userId = c.get('userId');
  const prefs = await c.env.DB.prepare('SELECT google_refresh_token, google_spreadsheet_id FROM user_prefs WHERE user_id=?')
    .bind(userId).first() as { google_refresh_token?: string; google_spreadsheet_id?: string } | null;

  if (!prefs || !prefs.google_refresh_token) {
    return c.json({ error: 'Google Account not connected' }, 400);
  }
  if (_syncInProgress.has(userId)) {
    return c.json({ message: 'Sync already in progress' });
  }

  _syncInProgress.add(userId);
  c.executionCtx.waitUntil(
    runSyncProcess(userId, prefs.google_refresh_token, prefs.google_spreadsheet_id || null, c.env)
      .finally(() => _syncInProgress.delete(userId))
  );

  return c.json({ message: 'Sync started' });
});

app.post('/disconnect', requireMember, async (c) => {
  const userId = c.get('userId');
  await c.env.DB.prepare('UPDATE user_prefs SET google_refresh_token=NULL, google_spreadsheet_id=NULL WHERE user_id=?')
    .bind(userId).run();
  return c.json({ ok: true });
});

async function ensureSheetExists(spreadsheetId: string, title: string, accessToken: string, env: Env): Promise<void> {
  const metaResp = await fetchTracked(env, 'google', `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!metaResp.ok) throw new Error(`Failed to read spreadsheet metadata: ${await metaResp.text()}`);
  const meta = await metaResp.json() as { sheets?: Array<{ properties: { title: string } }> };
  const exists = meta.sheets?.some(s => s.properties.title === title);
  if (exists) return;

  const addResp = await fetchTracked(env, 'google', `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  if (!addResp.ok) throw new Error(`Failed to add sheet "${title}": ${await addResp.text()}`);
}

export async function runSyncProcess(userId: string, refreshToken: string, existingSpreadsheetId: string | null, env: Env) {
  try {
    // 1. Refresh Access Token
    const clientId = env.GOOGLE_CLIENT_ID || '1047116805178-dummy.apps.googleusercontent.com';
    const clientSecret = env.GOOGLE_CLIENT_SECRET || 'dummy-client-secret';

    const tokenResp = await fetchTracked(env, 'google', 'https://oauth2.googleapis.com/token', {
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

    const tokenData = await tokenResp.json() as { access_token?: string };
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new Error('Token refresh returned no access_token');
    }

    // 2. Resolve Spreadsheet
    let spreadsheetId = existingSpreadsheetId;
    if (!spreadsheetId) {
      const createResp = await fetchTracked(env, 'google', 'https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: { title: 'Brickvault Vault' } }),
      });

      if (!createResp.ok) {
        throw new Error(`Failed to create spreadsheet: ${await createResp.text()}`);
      }

      const sheetData = await createResp.json() as { spreadsheetId?: string };
      spreadsheetId = sheetData.spreadsheetId ?? null;
      if (!spreadsheetId) {
        throw new Error('Spreadsheet create returned no spreadsheetId');
      }

      await env.DB.prepare('UPDATE user_prefs SET google_spreadsheet_id=? WHERE user_id=?')
        .bind(spreadsheetId, userId).run();
    }

    // 3. Fetch collection + wishlist in parallel
    type CollectionRow = {
      set_num: string; name: string; year: number; theme: string; pieces: number;
      minifigs: number; condition: string; purchase_price: number; current_value: number;
      quantity: number; added_at: string;
    };
    type WishlistRow = {
      set_num: string; name: string; theme: string; current_value: number;
      target_price: number | null; added_at: string;
    };

    const [collRes, wishRes] = await Promise.all([
      env.DB.prepare(`
        SELECT uc.set_num, ls.name, ls.year, ls.theme, ls.pieces, ls.minifigs,
               uc.condition, uc.purchase_price, ls.current_value, uc.quantity, uc.added_at
        FROM user_collection uc
        JOIN lego_sets ls ON ls.set_num = uc.set_num
        WHERE uc.user_id = ? AND uc.deleted_at IS NULL
        ORDER BY uc.added_at DESC
      `).bind(userId).all() as unknown as { results: CollectionRow[] },

      env.DB.prepare(`
        SELECT uw.set_num, ls.name, ls.theme, ls.current_value, uw.target_price, uw.added_at
        FROM user_wishlist uw
        JOIN lego_sets ls ON ls.set_num = uw.set_num
        WHERE uw.user_id = ?
        ORDER BY ls.current_value DESC
      `).bind(userId).all() as unknown as { results: WishlistRow[] },
    ]);

    // 4. Build Portfolio sheet (Sheet1) — add ROI% formula column
    const collHeader = [
      'Set Number', 'Name', 'Year', 'Theme', 'Pieces', 'Minifigs',
      'Condition', 'Purchase Price', 'Current Value', 'Quantity', 'Date Added', 'ROI %'
    ];

    const collRows = (collRes.results || []).map((item, i) => {
      const rowNum = i + 2; // header is row 1, data starts row 2
      return [
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
        item.added_at || '',
        `=IF(H${rowNum}>0,(I${rowNum}-H${rowNum})/H${rowNum},"")`,
      ];
    });

    // 5. Write Portfolio sheet first — this always succeeds independently of Wishlist.
    const portfolioResp = await fetchTracked(env, 'google', `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [{ range: 'Sheet1!A1', values: [collHeader, ...collRows] }],
      }),
    });
    if (!portfolioResp.ok) {
      throw new Error(`Failed to write Portfolio sheet: ${await portfolioResp.text()}`);
    }

    // 6. Write Wishlist sheet — create it first if needed; failure here doesn't
    //    roll back the already-written Portfolio data.
    try {
      await ensureSheetExists(spreadsheetId, 'Wishlist', accessToken, env);

      const wishHeader = [
        'Set Number', 'Name', 'Theme', 'Current Value', 'Target Price', '% To Target', 'Added'
      ];
      const wishRows = (wishRes.results || []).map((item, i) => {
        const rowNum = i + 2;
        return [
          item.set_num,
          item.name || '',
          item.theme || '',
          item.current_value || 0,
          item.target_price || '',
          item.target_price ? `=IF(E${rowNum}>0,(E${rowNum}-D${rowNum})/D${rowNum},"")` : '',
          item.added_at || '',
        ];
      });

      const wishResp = await fetchTracked(env, 'google', `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: [{ range: 'Wishlist!A1', values: [wishHeader, ...wishRows] }],
        }),
      });
      if (!wishResp.ok) {
        console.error('[google-sync] Failed to write Wishlist sheet:', await wishResp.text());
      }
    } catch (wishErr) {
      console.error('[google-sync] Wishlist sheet error (Portfolio was written successfully):', wishErr);
    }
  } catch (err) {
    await recordIntegrationAttempt(env, 'google', false, err);
    console.error('[google-sync] Error running spreadsheet sync:', err);
  }
}

export { app as googleSyncRoute };
