import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { coverTransform, quadToViewRect, screenQuadToViewRect, cornerOffsets, defaultFrame } from '../lib/scan-geometry.js';

describe('scan geometry', () => {
  it('computes an object-fit: cover transform', () => {
    // 1280×720 landscape frame in a 400×800 portrait view: height drives the scale.
    const t = coverTransform(1280, 720, 400, 800);
    assert.equal(t.scale, 800 / 720);
    assert.ok(t.dx < 0, 'wide frame overflows horizontally');
    assert.equal(t.dy, 0);
  });

  it('maps a barcode quad to a padded view rect', () => {
    const quad = [{ x: 540, y: 300 }, { x: 740, y: 300 }, { x: 740, y: 400 }, { x: 540, y: 400 }];
    const r = quadToViewRect(quad, 1280, 720, 400, 800, 10);
    const { scale, dx } = coverTransform(1280, 720, 400, 800);
    assert.equal(Math.round(r.left), Math.round(540 * scale + dx - 10));
    assert.equal(Math.round(r.width), Math.round(200 * scale + 20));
    assert.equal(Math.round(r.height), Math.round(100 * scale + 20));
  });

  it('clamps to the view and rejects degenerate quads', () => {
    const r = quadToViewRect([{ x: -50, y: -50 }, { x: 5000, y: 5000 }], 1280, 720, 400, 800);
    assert.deepEqual([r.left, r.top, r.width, r.height], [0, 0, 400, 800]);
    assert.equal(quadToViewRect([{ x: 10, y: 10 }], 1280, 720, 400, 800), null);
    assert.equal(quadToViewRect([{ x: 1, y: 1 }, { x: 2, y: 2 }], 1280, 720, 400, 800, 0), null);
    assert.equal(quadToViewRect([{ x: 'a', y: 1 }, { x: 5, y: 5 }], 1280, 720, 400, 800), null);
    assert.equal(quadToViewRect(null, 1280, 720, 400, 800), null);
    assert.equal(quadToViewRect([{ x: 1, y: 1 }, { x: 90, y: 90 }], 0, 720, 400, 800), null);
  });

  it('divides native device-pixel points by the pixel ratio', () => {
    const r = screenQuadToViewRect([{ x: 300, y: 600 }, { x: 600, y: 600 }, { x: 600, y: 800 }, { x: 300, y: 800 }], 400, 800, 3, 0);
    assert.deepEqual([r.left, r.top, r.width, Math.round(r.height)], [100, 200, 100, 67]);
  });

  it('moves each bracket corner without resizing it', () => {
    const from = { left: 50, top: 100, width: 300, height: 180 };
    const to = { left: 120, top: 220, width: 160, height: 90 };
    assert.deepEqual(cornerOffsets(from, to), {
      tl: { x: 70, y: 120 }, tr: { x: -70, y: 120 },
      bl: { x: 70, y: 30 }, br: { x: -70, y: 30 },
    });
    assert.equal(cornerOffsets(null, to), null);
  });

  it('frames barcodes wide and photos tall, centred', () => {
    const b = defaultFrame(412, 915, 'barcode');
    const p = defaultFrame(412, 915, 'image');
    assert.ok(b.width > b.height);
    assert.ok(p.height > p.width * 0.9);
    assert.equal(b.left * 2 + b.width, 412);
  });
});
