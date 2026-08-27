import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { horizontalRailState } from '../lib/horizontal-rail.js';

describe('horizontal rail affordance state', () => {
  it('announces content to the right at the leading edge', () => {
    assert.deepEqual(horizontalRailState({ scrollLeft: 0, scrollWidth: 700, clientWidth: 360 }), {
      canScrollLeft: false,
      canScrollRight: true,
    });
  });

  it('announces both directions in the middle', () => {
    assert.deepEqual(horizontalRailState({ scrollLeft: 120, scrollWidth: 700, clientWidth: 360 }), {
      canScrollLeft: true,
      canScrollRight: true,
    });
  });

  it('allows sub-pixel tolerance at the trailing edge', () => {
    assert.deepEqual(horizontalRailState({ scrollLeft: 339.6, scrollWidth: 700, clientWidth: 360 }), {
      canScrollLeft: true,
      canScrollRight: false,
    });
  });

  it('reports no overflow when every option fits', () => {
    assert.deepEqual(horizontalRailState({ scrollLeft: 0, scrollWidth: 320, clientWidth: 360 }), {
      canScrollLeft: false,
      canScrollRight: false,
    });
  });
});
