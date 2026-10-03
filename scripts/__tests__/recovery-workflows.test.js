import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const read = name => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');

test('Wrangler 3 recovery R2 commands use remote-by-default syntax', () => {
  for (const name of ['backup-d1.yml', 'restore-drill.yml']) {
    const source = read(name);
    const commands = source.replace(/\\\r?\n\s*/g, ' ').match(/npx wrangler@3 r2 object (?:put|get)[^\n]*/g) || [];
    assert.ok(commands.length, `${name} has R2 commands`);
    for (const command of commands) assert.doesNotMatch(command, /--remote|--local/, command);
    // Unlike R2, D1 must still explicitly select the production remote.
    assert.match(source, /d1 execute[^\n]*--remote/);
  }
  assert.match(read('backup-d1.yml'), /cmp --silent "\$\{LOCAL_FILE\}" verify.sql.gz/);
});

test('restore cleanup deletes only this run’s successfully created scratch DB', () => {
  const source = read('restore-drill.yml');
  const cleanup = source.split('      - name: Delete the scratch database')[1]
    .split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
  for (const [database, shouldDelete] of [[null, false], ['brickvault', false], ['brickvault-restore-123-1', true], ['brickvault-restore-124-1', false]]) {
    const env = { ...process.env, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
    delete env.DRILL_DB;
    if (database !== null) env.DRILL_DB = database;
    // Never invoke the real CLI or filesystem deletion in this safety test.
    const result = spawnSync('bash', ['-c', `npx() { printf '%s\\n' "$*"; }; rm() { :; };\n${cleanup}`], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes('d1 delete'), shouldDelete, String(database));
    if (shouldDelete) assert.match(result.stdout, /d1 delete brickvault-restore-123-1 -y/);
  }
});
