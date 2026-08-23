import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = readdirSync(new URL('../public/js/__tests__/', import.meta.url))
  .filter(name => name.endsWith('.test.js'))
  .sort()
  .map(name => `public/js/__tests__/${name}`);

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
