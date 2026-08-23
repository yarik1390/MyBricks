import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TurnstileChallengeError,
  getTurnstileToken,
} from '../lib/turnstile.js';
import {
  registerWithCaptcha,
  requestPasswordReset,
} from '../lib/auth-actions.js';

function createTurnstileHarness({ outcome = 'success' } = {}) {
  const appended = [];
  const removed = [];
  const documentRef = {
    head: {
      appendChild(node) {
        appended.push(node);
        queueMicrotask(() => node.onload?.());
      },
    },
    body: {
      appendChild(node) {
        appended.push(node);
        node.parentNode = this;
      },
      removeChild(node) {
        removed.push(node);
      },
    },
    createElement(tagName) {
      return {
        tagName: tagName.toUpperCase(),
        dataset: {},
        remove() { removed.push(this); },
        setAttribute() {},
      };
    },
    querySelector() { return null; },
  };

  const api = {
    removedWidget: null,
    render(_container, options) {
      queueMicrotask(() => {
        if (outcome === 'success') options.callback('captcha-token');
        if (outcome === 'error') options['error-callback']();
      });
      return 'widget-id';
    },
    remove(widgetId) { this.removedWidget = widgetId; },
  };
  const windowRef = { turnstile: api };
  return { api, appended, documentRef, removed, windowRef };
}

test('getTurnstileToken skips the challenge when no site key is configured', async () => {
  assert.equal(await getTurnstileToken(''), null);
});

test('getTurnstileToken resolves a token and cleans up the widget', async () => {
  const harness = createTurnstileHarness();
  const token = await getTurnstileToken('site-key', {
    documentRef: harness.documentRef,
    windowRef: harness.windowRef,
    timeoutMs: 100,
  });

  assert.equal(token, 'captcha-token');
  assert.equal(harness.api.removedWidget, 'widget-id');
  assert.equal(harness.removed.length, 1);
});

test('getTurnstileToken rejects with an accessible challenge error', async () => {
  const harness = createTurnstileHarness({ outcome: 'error' });
  await assert.rejects(
    getTurnstileToken('site-key', {
      documentRef: harness.documentRef,
      windowRef: harness.windowRef,
      timeoutMs: 100,
    }),
    error => error instanceof TurnstileChallengeError && error.code === 'challenge_failed',
  );
});

test('registerWithCaptcha sends captchaToken in Supabase signUp options', async () => {
  let received;
  const supabase = {
    auth: {
      async signUp(payload) {
        received = payload;
        return { data: { user: { id: 'user-1' } }, error: null };
      },
    },
  };

  await registerWithCaptcha(supabase, 'person@example.com', 'correct horse', 'captcha-token');
  assert.deepEqual(received, {
    email: 'person@example.com',
    password: 'correct horse',
    options: { captchaToken: 'captcha-token' },
  });
});

test('requestPasswordReset uses the safe login hash redirect', async () => {
  let received;
  const supabase = {
    auth: {
      async resetPasswordForEmail(email, options) {
        received = { email, options };
        return { data: {}, error: null };
      },
    },
  };

  await requestPasswordReset(supabase, 'person@example.com', 'https://app.example');
  assert.deepEqual(received, {
    email: 'person@example.com',
    options: { redirectTo: 'https://app.example/#/login' },
  });
});
