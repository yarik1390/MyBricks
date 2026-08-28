import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const stateJs = readFileSync(new URL('../../public/js/state.js', import.meta.url), 'utf8');
const catalogJs = readFileSync(new URL('../../public/js/views/catalog.js', import.meta.url), 'utf8');
const minifigsJs = readFileSync(new URL('../../public/js/views/minifigs.js', import.meta.url), 'utf8');

function extractMap(source, name) {
  const match = source.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  assert.ok(match, `${name} sort map must remain a statically declared array`);
  return match[1];
}

// Extract the body of a `function foo(...) { ... }` declaration, brace-aware,
// so assertions target exactly the reset/URL logic without false positives
// from other code paths that legitimately mention the old default.
function extractBody(source, funcName) {
  const start = source.indexOf(`function ${funcName}(`);
  assert.ok(start !== -1, `${funcName}() must exist`);
  const open = source.indexOf('{', start);
  assert.ok(open !== -1, `${funcName}() must have a body`);
  let depth = 0;
  let i = open;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  assert.ok(depth === 0, `${funcName}() body must be brace-balanced`);
  return source.slice(open, i + 1);
}

describe('discovery catalog + minifig default sort is year_desc', () => {
  it('initial catalogSort defaults to year_desc (newest) in state.js', () => {
    assert.match(stateJs, /catalogSort:\s*"year_desc"/);
    assert.doesNotMatch(stateJs, /catalogSort:\s*"value_desc"/);
  });

  it('initial figSort defaults to year_desc (newest) in state.js', () => {
    assert.match(stateJs, /figSort:\s*"year_desc"/);
    assert.doesNotMatch(stateJs, /figSort:\s*"rarity_desc"/);
  });

  it('catalog UI sort map exposes the year_desc route', () => {
    const map = extractMap(catalogJs, 'CATALOG_SORTS');
    assert.match(map, /desc:\s*"year_desc"/);
    assert.match(map, /def:\s*"year_desc"/);
  });

  it('minifig UI sort map exposes the year_desc route', () => {
    const map = extractMap(minifigsJs, 'FIG_SORTS');
    assert.match(map, /desc:\s*"year_desc"/);
    assert.match(map, /def:\s*"year_desc"/);
  });

  it('catalog URL sync treats year_desc as the omitted default sort', () => {
    const sync = extractBody(catalogJs, 'syncCatalogURL');
    assert.match(sync, /f\.catalogSort\s*!==\s*'year_desc'/);
    assert.doesNotMatch(sync, /value_desc/);
    assert.match(sync, /p\.set\('sort', f\.catalogSort\)/);
  });

  it('catalog URL read honors an explicit sort param and never hardcodes a default', () => {
    const read = extractBody(catalogJs, 'readCatalogURLParams');
    assert.match(read, /p\.has\('sort'\)/);
    assert.match(read, /f\.catalogSort\s*=\s*p\.get\('sort'\)/);
    assert.doesNotMatch(read, /value_desc/);
  });

  it('catalog query always sends the resolved sort to the backend', () => {
    const query = extractBody(catalogJs, 'catalogQuery');
    assert.match(query, /p\.set\("sort", f\.catalogSort\)/);
  });

  it('catalog clear path restores the year_desc default sort', () => {
    const clear = extractBody(catalogJs, 'clearCatalogFilters');
    assert.match(clear, /catalogSort\s*=\s*"year_desc"/);
    assert.doesNotMatch(clear, /value_desc/);
  });

  it('minifig clear path restores the year_desc default sort', () => {
    const clear = extractBody(minifigsJs, 'clearFigFilters');
    assert.match(clear, /figSort\s*=\s*"year_desc"/);
    assert.doesNotMatch(clear, /figSort\s*=\s*"rarity_desc"/);
  });

  it('minifig filter sheet falls back to the year_desc default sort', () => {
    assert.match(minifigsJs, /f\.figSort\s*\|\|\s*'year_desc'/);
    assert.doesNotMatch(minifigsJs, /figSort\s*\|\|\s*'rarity_desc'/);
  });
});