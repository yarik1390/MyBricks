// Regression: an unsolicited OAuth callback must NOT install a session.
//
// Before the fix, any URL fragment carrying access_token= was accepted as a
// session and the visitor's guest vault was then uploaded into that account
// (login CSRF -> data exfiltration). consumeOAuthHash now only honours a
// callback that answers a sign-in transaction this tab recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appSrc = fs.readFileSync(path.join(here, '..', 'app.js'), 'utf8');
const loginSrc = fs.readFileSync(path.join(here, '..', 'views', 'login.js'), 'utf8');
const apiSrc = fs.readFileSync(path.join(here, '..', 'api.js'), 'utf8');

test('consumeOAuthHash rejects a callback with no armed transaction', () => {
  const fn = appSrc.slice(appSrc.indexOf('async function consumeOAuthHash'));
  // The guard must exist BEFORE the session is installed.
  const guardAt = fn.indexOf('bv_pending_signin');
  const installAt = fn.indexOf('saveSession(oauthSess');
  assert.ok(guardAt !== -1, 'consumeOAuthHash must read the pending sign-in transaction');
  assert.ok(installAt !== -1, 'consumeOAuthHash must still install a legitimate session');
  assert.ok(
    guardAt < installAt,
    'the pending-transaction check must run before saveSession() is reached',
  );
  assert.ok(
    /if\s*\(\s*!pending\s*\|\|[^)]*callbackState\s*!==\s*pending\.nonce\s*\)/.test(fn),
    'an unsolicited callback must be discarded when no transaction is armed',
  );
});

test('the transaction is single-use and time-bounded', () => {
  const fn = appSrc.slice(appSrc.indexOf('async function consumeOAuthHash'));
  assert.ok(
    fn.includes('sessionStorage.removeItem("bv_pending_signin")'),
    'the transaction must be consumed so a replayed URL cannot reuse it',
  );
  assert.match(appSrc, /AUTH_TRANSACTION_TTL_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
  assert.ok(
    fn.includes('AUTH_TRANSACTION_TTL_MS'),
    'the transaction must expire so an abandoned sign-in cannot be replayed later',
  );
});

test('an unsolicited callback scrubs the token from the address bar', () => {
  const fn = appSrc.slice(appSrc.indexOf('async function consumeOAuthHash'));
  const rejectBlock = fn.slice(fn.indexOf('if (!pending ||'), fn.indexOf('if (!pending ||') + 500);
  assert.ok(
    rejectBlock.includes('history.replaceState'),
    'the rejected access_token must be removed from history/referrer',
  );
});

test('the legitimate sign-in path arms the transaction it expects back', () => {
  assert.ok(
    loginSrc.includes('sessionStorage.setItem("bv_pending_signin"'),
    'startProviderSignIn must arm the transaction before redirecting',
  );
  const armAt = loginSrc.indexOf('bv_pending_signin');
  const redirectAt = loginSrc.indexOf('location.href = authUrl');
  assert.ok(armAt < redirectAt, 'arm the transaction before navigating to the provider');
  // The email/password path does not use a redirect callback, so it must not
  // depend on the transaction gate. Strip comments first so the check looks at
  // code rather than at prose describing the attack.
  const codeOnly = loginSrc.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
  assert.ok(
    !/access_token\s*[:=]/.test(codeOnly),
    'login.js must not construct an OAuth token itself; only the redirect callback supplies one',
  );
  assert.ok(
    !/bv_pending_signin/.test(codeOnly.split('startProviderSignIn')[0] || ''),
    'no code before the sign-in flow may read or clear the transaction',
  );
});

// Execute the actual callback body, not only assertions about source text.
// The fake token is intentionally not a valid JWT: a callback must reject it
// before saveSession, regardless of which account a real token would name.
test('OAuth callback accepts only the nonce returned to its own redirect', async () => {
  const start = appSrc.indexOf('async function consumeOAuthHash()');
  const body = appSrc.slice(start, appSrc.indexOf('\n}\n', start) + 3);
  const nonce = 'a'.repeat(64);
  async function execute({ storedNonce, queryNonce, fragmentNonce, startedAt = Date.now() }) {
    const values = new Map();
    if (storedNonce) values.set('bv_pending_signin', JSON.stringify({ nonce: storedNonce, startedAt }));
    let saved = 0;
    let migrated = 0;
    const query = queryNonce ? `?auth_state=${queryNonce}` : '';
    const fragment = fragmentNonce ? `&auth_state=${fragmentNonce}` : '';
    const ctx = {
      AUTH_TRANSACTION_TTL_MS: 600_000,
      URL, URLSearchParams, Date,
      location: { href: `https://bricksvault.app/${query}#access_token=FAKE&refresh_token=FAKE${fragment}`, pathname: '/', search: query, hash: `#access_token=FAKE&refresh_token=FAKE${fragment}` },
      history: { replaceState() {} },
      sessionStorage: { getItem: key => values.get(key), removeItem: key => values.delete(key) },
      snapshotGuestVault: () => ({ collection: [{ set_num: 'TEST-1' }] }),
      saveSession: () => { saved++; },
      migrateGuestVault: async () => { migrated++; return { migrated: 0, errors: [] }; },
      toast() {}, tPlural: () => '',
      state: { me: null }, invalidatePortfolio() {},
    };
    vm.createContext(ctx);
    await vm.runInContext(`${body}\nconsumeOAuthHash()`, ctx);
    return { saved, migrated, pending: values.has('bv_pending_signin') };
  }
  assert.deepEqual(await execute({ queryNonce: nonce }), { saved: 0, migrated: 0, pending: false });
  assert.deepEqual(await execute({ storedNonce: nonce }), { saved: 0, migrated: 0, pending: true });
  assert.deepEqual(await execute({ storedNonce: nonce, queryNonce: 'b'.repeat(64) }), { saved: 0, migrated: 0, pending: true });
  assert.deepEqual(await execute({ storedNonce: nonce, queryNonce: nonce, fragmentNonce: 'b'.repeat(64) }), { saved: 0, migrated: 0, pending: true });
  assert.deepEqual(await execute({ storedNonce: nonce, queryNonce: nonce, startedAt: Date.now() + 60_000 }), { saved: 0, migrated: 0, pending: true });
  assert.deepEqual(await execute({ storedNonce: nonce, queryNonce: nonce }), { saved: 1, migrated: 1, pending: false });
});

// Regression: a Supabase password-recovery link carries access_token with
// type=recovery and NO auth_state, so the sign-in transaction gate must not be
// the thing that decides its fate — but it also must not be softened. The grant
// is parked for an explicit set-password step; nothing is installed or migrated.
test('a recovery link is parked for an explicit password set, never installed directly', () => {
  const fn = appSrc.slice(appSrc.indexOf('async function consumeOAuthHash'));
  const at = fn.indexOf("hp.get('type') === 'recovery'");
  assert.ok(at !== -1, 'recovery callbacks must be recognised before the transaction gate');
  const branch = fn.slice(at, at + 700);
  assert.ok(branch.includes('stashRecoveryGrant'), 'the recovery grant must be parked');
  assert.ok(!branch.includes('saveSession('), 'a recovery link must not install a session');
  assert.ok(!branch.includes('migrateGuestVault'), 'no guest vault may be migrated from a recovery link');
  assert.ok(branch.includes('history.replaceState'), 'the token must be stripped from the URL');
});

test('the recovery sheet only installs the session after sbSetPassword succeeds', () => {
  const fn = loginSrc.slice(loginSrc.indexOf('async function openRecoverySheet'));
  assert.ok(fn.length > 0, 'login.js must own the set-password sheet');
  const setAt = fn.indexOf('await sbSetPassword(');
  const installAt = fn.indexOf('installRecoverySession(');
  assert.ok(setAt !== -1 && installAt !== -1, 'both the password set and the session install must exist');
  assert.ok(setAt < installAt, 'the session may only be installed after the password is actually changed');
  assert.ok(fn.includes('clearRecoveryGrant()'), 'the single-use grant must be cleared');
});

// Regression: a deterministic 4xx used to burn the retry budget and then delete
// the queued write with a generic toast. Permanent failures are now quarantined.
test('the outbox quarantines permanent failures and preserves a guest queue on sign-in', () => {
  assert.ok(/PERMANENT_OUTBOX_STATUS\s*=\s*new Set\(/.test(apiSrc), 'permanent statuses must be declared');
  assert.ok(apiSrc.includes('isPermanentOutboxError(error)'), 'drainOutbox must classify failures');
  assert.ok(apiSrc.includes('quarantineOutboxItem(item, error)'), 'failed writes must be quarantined');
  assert.ok(apiSrc.includes('OUTBOX_FAILED_KEY'), 'the quarantine store must be named');
  const saveFn = apiSrc.slice(apiSrc.indexOf('export function saveSession'));
  const body = saveFn.slice(0, saveFn.indexOf('\n}\n'));
  assert.ok(body.includes('migratedFromGuest'), 'a guest queue must survive signing in');
  assert.ok(
    /!migratedFromGuest\) localStorage\.removeItem\(OUTBOX_KEY\)/.test(body),
    'an account switch must still drop the previous owner queue',
  );
});
// A recovery link can be crafted for the ATTACKER's account. If the victim opens
// it and sets a password, they land signed in to that account — so this device's
// pending guest writes must not be replayed into it.
test('an account installed from an emailed link never replays the device outbox', () => {
  const fn = apiSrc.slice(apiSrc.indexOf('export function installRecoverySession'));
  assert.ok(fn.slice(0, 500).includes('dropOutbox: true'), 'the recovery install must drop pending writes');
  assert.ok(
    /if \(opts\.dropOutbox \|\| !migratedFromGuest\) localStorage\.removeItem\(OUTBOX_KEY\)/.test(apiSrc),
    'dropOutbox must force the discard even on a guest->account transition',
  );
});
