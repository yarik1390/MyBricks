import test from 'node:test';
import assert from 'node:assert/strict';

// A minimal History: entries with state, back/forward and events.
function fakeWindow() {
  const listeners = {};
  const entries = [{ url: '#/', state: null }];
  let i = 0;
  const fire = (name) => (listeners[name] || []).forEach((fn) => fn());
  const history = {
    get state() { return entries[i].state; },
    get length() { return entries.length; },
    pushState(state, _t, url) { entries.splice(i + 1); entries.push({ url, state }); i++; },
    replaceState(state, _t, url) { entries[i] = { url: url ?? entries[i].url, state }; },
    back() { if (i > 0) { i--; fire('popstate'); fire('hashchange'); } },
  };
  const win = {
    history,
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    // A link / `location.hash = …`: a new entry without state, then events.
    followLink(url) { entries.splice(i + 1); entries.push({ url, state: null }); i++; fire('popstate'); fire('hashchange'); },
  };
  return win;
}

test('entries count screens behind them; URL rewrites keep the count', async () => {
  const win = fakeWindow();
  globalThis.history = win.history;
  const { installNavHistory, navDepth, canGoBackInApp } = await import('../lib/nav-history.js');
  installNavHistory(win);
  assert.equal(navDepth(), 0);
  assert.equal(canGoBackInApp(), false);
  win.followLink('#/add');
  assert.equal(navDepth(), 1);
  win.history.pushState(null, '', '#/set/75192-1');
  assert.equal(navDepth(), 2);
  // Tab switches on the set page rewrite the URL with a null state.
  win.history.replaceState(null, '', '#/set/75192-1/history');
  assert.equal(navDepth(), 2);
  win.history.back();
  assert.equal(navDepth(), 1);
  win.history.back();
  assert.equal(navDepth(), 0);
  assert.equal(canGoBackInApp(), false);
  // Extra state survives alongside the depth (the image viewer's marker).
  win.history.pushState({ lightbox: true }, '', '#/');
  assert.deepEqual(win.history.state, { lightbox: true, bvDepth: 1 });
});
