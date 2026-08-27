import { execFileSync } from 'node:child_process';

export const ANDROID_VERSION_FLOOR = 1140;

export function effectiveVersionCode(commitCount, floor = ANDROID_VERSION_FLOOR) {
  const count = Number(commitCount);
  const minimum = Number(floor);
  if (!Number.isSafeInteger(minimum) || minimum < 1) throw new TypeError('version floor must be a positive integer');
  return Number.isSafeInteger(count) && count > minimum ? count : minimum;
}

export function versionCodeFromGit({ cwd = new URL('..', import.meta.url), floor = ANDROID_VERSION_FLOOR } = {}) {
  try {
    const count = Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd, encoding: 'utf8' }).trim());
    return effectiveVersionCode(count, floor);
  } catch {
    return effectiveVersionCode(0, floor);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(versionCodeFromGit());
