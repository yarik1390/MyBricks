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

test('simultaneous local AI requests remain strictly single-flight', async () => {
  let releaseFirst;
  const firstDone = new Promise(resolve => { releaseFirst = resolve; });
  let active = 0;
  let maxActive = 0;
  const starts = [];

  const first = withInferenceDeadline(async () => {
    starts.push('first');
    active += 1;
    maxActive = Math.max(maxActive, active);
    await firstDone;
    active -= 1;
    return 'first-result';
  }, 2_000);
  const second = withInferenceDeadline(async () => {
    starts.push('second');
    active += 1;
    maxActive = Math.max(maxActive, active);
    active -= 1;
    return 'second-result';
  }, 2_000);

  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(starts, ['first']);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ['first-result', 'second-result']);
  assert.deepEqual(starts, ['first', 'second']);
  assert.equal(maxActive, 1);
});

test('an aborted middle waiter cannot let later work overtake an active request', async () => {
  let releaseFirst;
  const firstDone = new Promise(resolve => { releaseFirst = resolve; });
  let firstActive = false;
  let thirdStartedWhileFirstActive = false;

  const first = withInferenceDeadline(async () => {
    firstActive = true;
    await firstDone;
    firstActive = false;
    return 'first-result';
  }, 2_000);
  const middleController = new AbortController();
  const middle = withInferenceDeadline(() => 'unexpected', 2_000, middleController.signal);
  const third = withInferenceDeadline(() => {
    thirdStartedWhileFirstActive = firstActive;
    return 'third-result';
  }, 2_000);

  middleController.abort();
  await assert.rejects(middle, err => err?.code === 'LOCAL_AI_CANCELLED');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(thirdStartedWhileFirstActive, false);
  releaseFirst();
  assert.equal(await first, 'first-result');
  assert.equal(await third, 'third-result');
  assert.equal(thirdStartedWhileFirstActive, false);
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
