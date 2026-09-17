import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function harness() {
  const listeners = {};
  let backs = 0;
  const context = {
    document: { addEventListener(name, fn, options) {
      assert.equal(options.passive, name !== 'touchmove', 'only recognized movement may suppress native input');
      listeners[name] = fn;
    } },
    overlayOpen: () => false,
    history: { length: 3, back() { backs++; } },
  };
  vm.runInNewContext(source.slice(source.indexOf('function setupGestures()'), source.indexOf('// Hide the advisor FAB')) + '\nsetupGestures();', context);
  return { fire(name, touches = [], changedTouches = touches) {
    listeners[name]({ touches, changedTouches, preventDefault() { assert.fail('must not suppress native input'); } });
  }, backs: () => backs };
}
const finger = (x, y = 100, identifier = 1) => ({ clientX: x, clientY: y, identifier });
test('edge swipe uses matching finger and clears completed state', () => {
  const h = harness();
  h.fire('touchstart', [finger(0)]);
  h.fire('touchend', [], [finger(100)]);
  assert.equal(h.backs(), 1);
  h.fire('touchend', [], [finger(150)]);
  assert.equal(h.backs(), 1);
});
test('edge tap and vertical drag do not navigate or suppress defaults', () => {
  const h = harness();
  h.fire('touchstart', [finger(10)]);
  h.fire('touchend', [], [finger(10)]);
  h.fire('touchstart', [finger(10)]);
  h.fire('touchmove', [finger(15, 160)]);
  h.fire('touchend', [], [finger(100, 200)]);
  assert.equal(h.backs(), 0);
});
test('cancelled, multi-touch and mismatched-finger sequences cannot navigate', () => {
  const h = harness();
  h.fire('touchstart', [finger(10)]);
  h.fire('touchcancel');
  h.fire('touchend', [], [finger(100)]);
  h.fire('touchstart', [finger(10)]);
  h.fire('touchstart', [finger(10), finger(50, 100, 2)]);
  h.fire('touchend', [finger(50, 100, 2)], [finger(100)]);
  h.fire('touchend', [], [finger(150, 100, 2)]);
  h.fire('touchstart', [finger(10)]);
  h.fire('touchend', [], [finger(100, 100, 2)]);
  assert.equal(h.backs(), 0);
});
