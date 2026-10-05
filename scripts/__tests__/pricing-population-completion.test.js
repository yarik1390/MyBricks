import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { it } from 'node:test';

it('population completion ignores barcode_complete and other substring collisions', () => {
  const source = readFileSync(new URL('../../public/js/views/me-admin.js', import.meta.url), 'utf8');
  const fn = source.match(/function isPopulateEverythingComplete\(run = \{\}\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn);
  const complete = vm.runInNewContext(`${fn}; isPopulateEverythingComplete`);
  for (const error of [
    'method:populate-everything complete:false barcode_complete:true',
    'method:populate-everything barcode_complete:true',
    'method:populate-everything incomplete:true',
    'method:populate-everything complete:trueish',
  ]) assert.equal(complete({ job_type: 'populate_everything', error }), false);
  assert.equal(complete({ job_type: 'populate_everything', error: 'method:populate-everything complete:true barcode_complete:false' }), true);
});
