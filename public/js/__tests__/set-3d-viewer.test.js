import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setViewerCopy, supportsSet3dViewer, viewerQuality } from '../components/set-3d-viewer.js';

describe('set 3D viewer capability and presentation', () => {
  it('only advertises the viewer when a WebGL context can be created', () => {
    const supported = {
      WebGLRenderingContext: class {},
      document: { createElement: () => ({ getContext: kind => kind === 'webgl' ? {} : null }) },
    };
    const unavailable = {
      WebGLRenderingContext: class {},
      document: { createElement: () => ({ getContext: () => null }) },
    };
    assert.equal(supportsSet3dViewer(supported), true);
    assert.equal(supportsSet3dViewer(unavailable), false);
    assert.equal(supportsSet3dViewer({}), false);
  });

  it('caps rendering cost on memory-constrained devices', () => {
    const lowEnd = {
      navigator: { deviceMemory: 2, hardwareConcurrency: 2 },
      devicePixelRatio: 3,
      matchMedia: () => ({ matches: true }),
    };
    assert.deepEqual(viewerQuality(lowEnd), {
      antialias: false,
      pixelRatio: 1,
      reducedMotion: true,
    });

    const capable = {
      navigator: { deviceMemory: 8, hardwareConcurrency: 8 },
      devicePixelRatio: 3,
      matchMedia: () => ({ matches: false }),
    };
    assert.deepEqual(viewerQuality(capable), {
      antialias: true,
      pixelRatio: 1.5,
      reducedMotion: false,
    });
  });

  it('labels the generated geometry as an illustrative preview', () => {
    const copy = setViewerCopy({ set_num: '31120-1', name: 'Medieval Castle' });
    assert.match(copy.title, /3D preview of Medieval Castle/);
    assert.match(copy.description, /illustrative preview/);
    assert.match(copy.description, /not the official LEGO building model/);
  });
});
