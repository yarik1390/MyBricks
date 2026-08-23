import assert from 'node:assert/strict';
import test from 'node:test';

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: key => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(String(key)),
  };
};
globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();
globalThis.window = globalThis;

const { __localAiTestHooks } = await import('../lib/local-ai.js');
const { withInferenceDeadline, reset, setInstanceLoader } = __localAiTestHooks;

test.beforeEach(() => {
  reset();
  setInstanceLoader(async () => ({ close() {} }));
});

test('local AI timeout rejects promptly even when native work never settles', async () => {
  const started = Date.now();
  await assert.rejects(
    withInferenceDeadline(() => new Promise(() => {}), 20),
    err => err?.code === 'LOCAL_AI_TIMEOUT',
  );
  assert.ok(Date.now() - started < 250, 'timeout should not await hung native work');
});

test('queued local AI request honors abort while waiting for cleanup', async () => {
  const first = withInferenceDeadline(() => new Promise(() => {}), 10);
  await assert.rejects(first, err => err?.code === 'LOCAL_AI_TIMEOUT');

  const controller = new AbortController();
  const queued = withInferenceDeadline(() => 'unexpected', 5_000, controller.signal);
  controller.abort();
  await assert.rejects(queued, err => err?.code === 'LOCAL_AI_CANCELLED');
});

test('local AI gate eventually recovers from permanently hung native work', async () => {
  const first = withInferenceDeadline(() => new Promise(() => {}), 10);
  await assert.rejects(first, err => err?.code === 'LOCAL_AI_TIMEOUT');

  const started = Date.now();
  const result = await withInferenceDeadline(() => 'recovered', 2_000);
  assert.equal(result, 'recovered');
  assert.ok(Date.now() - started >= 800, 'replacement should wait for bounded cleanup grace');
});
