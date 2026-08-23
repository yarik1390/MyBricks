import assert from 'node:assert/strict';
import test from 'node:test';

import { runCancellableAdvisorInference } from '../lib/advisor-local-ai.js';

test('advisor cancellation reaches local Gemma and suppresses late callbacks', async () => {
  let activeController = null;
  let receivedSignal = null;
  let emitPartial;
  let rejectInference;
  const partials = [];
  const pending = runCancellableAdvisorInference({
    prompt: 'question',
    runInference: (_prompt, onPartial, opts) => {
      receivedSignal = opts.signal;
      emitPartial = onPartial;
      return new Promise((_, reject) => { rejectInference = reject; });
    },
    onPartial: partial => partials.push(partial),
    setActiveController: controller => { activeController = controller; },
    clearActiveController: controller => {
      if (activeController === controller) activeController = null;
    },
  });

  assert.equal(receivedSignal, activeController.signal);
  activeController.abort();
  emitPartial('late partial');
  rejectInference(Object.assign(new Error('cancelled'), { code: 'LOCAL_AI_CANCELLED' }));

  assert.equal(await pending, null);
  assert.deepEqual(partials, []);
  assert.equal(activeController, null);
});

test('advisor local inference returns output and clears its active controller', async () => {
  let activeController = null;
  const partials = [];
  const result = await runCancellableAdvisorInference({
    prompt: 'question',
    runInference: async (_prompt, onPartial) => {
      onPartial('partial');
      return 'final';
    },
    onPartial: partial => partials.push(partial),
    setActiveController: controller => { activeController = controller; },
    clearActiveController: controller => {
      if (activeController === controller) activeController = null;
    },
  });

  assert.equal(result, 'final');
  assert.deepEqual(partials, ['partial']);
  assert.equal(activeController, null);
});